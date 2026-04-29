#!/usr/bin/env python3
"""
Minimal NINA polling agent for Windows observatory PC.

This version supports a simple workflow:
  - Your website always publishes a complete sequence JSON at one fixed URL.
  - Agent downloads that JSON on a polling interval.
  - If content changed since last download, agent starts NINA with that JSON.

Usage:
  1) Copy this file to the observatory PC.
  2) Edit the CONFIG section below.
  3) Run: python nina_agent.py
"""

from __future__ import annotations

import hashlib
import base64
import json
import queue
import shutil
import subprocess
import threading
import time
import traceback
import zipfile
import urllib.error
import urllib.request
from pathlib import Path
from typing import Dict, Optional

try:
    import boto3
except ImportError:
    boto3 = None

try:
    from PIL import Image, ImageOps
except ImportError:
    Image = None
    ImageOps = None

try:
    import numpy as np
except ImportError:
    np = None

try:
    from astropy.io import fits
except ImportError:
    fits = None

if Image is not None:
    try:
        RESAMPLE_LANCZOS = Image.Resampling.LANCZOS  # Pillow >= 9
    except AttributeError:
        RESAMPLE_LANCZOS = Image.LANCZOS
else:
    RESAMPLE_LANCZOS = None


# =========================
# CONFIG (edit these values)
# =========================
SEQUENCE_JSON_URL = "https://www.pomfretastro.org/api/imaging/nina-sequence"
# Optional bearer token. Leave empty "" if your URL is public or signed.
TOKEN = ""

POLL_SECONDS = 45
JOBS_DIR = r"C:\Users\Observatory\Downloads\NinaJobs"
LOCAL_SEQUENCE_FILENAME = "latest_sequence.json"
NINA_INSTALL_DIR = r"C:\Program Files\N.I.N.A. - Nighttime Imaging 'N' Astronomy"

# Optional args, for example:
# NINA_EXTRA_ARGS = ["--profileid", "YOUR_PROFILE_GUID", "--exitaftersequence"]
NINA_EXTRA_ARGS: list[str] = ["--exitaftersequence"]

# If True, do not start a new job when NINA.exe is already running.
SKIP_WHEN_NINA_RUNNING = True

# Poll interval while waiting for started NINA process to exit.
RUNNING_CHECK_SECONDS = 15

# NINA image output root folder (scan recursively after each run).
NINA_OUTPUT_DIR = r"C:\Users\Observatory\Documents\N.I.N.A"

# Upload image and common processing outputs.
UPLOAD_EXTENSIONS = {
    ".fits",
    ".fit",
    ".xisf",
    ".tif",
    ".tiff",
    ".jpg",
    ".jpeg",
    ".png",
}

# Candidate keys used to map files to one observing session.
SESSION_ID_KEYS = ("sessionId", "session_id", "sessionID")
OUTPUT_MODE_RAW_ZIP = "raw_zip"
OUTPUT_MODE_STACKED_MASTER = "stacked_master"
OUTPUT_MODE_NONE = "none"

# -------- R2 upload config (optional, but recommended) --------
# Install dependency on observatory PC once:
#   pip install boto3
R2_ENABLED = True
R2_ACCOUNT_ID = "44118b098fcf2269947320e88db2afff"
R2_ACCESS_KEY_ID = "8394dbcc36f456ab49196d0a78324aa2"
R2_SECRET_ACCESS_KEY = "242780ebae3887812ed01887fab8d1dac4a1b172e6c1fe3032dce176eb4c7d28"
R2_BUCKET = "pomfretolmstedobservatory"
R2_PUBLIC_BASE_URL = ""  # e.g. "https://files.pomfretastro.org"
R2_PREFIX = "imaging"

# Notify backend after each upload batch so website can map queueId -> objectKey.
# Backend endpoint: POST /api/imaging/session-files
# Uses Authorization header from TOKEN (Bearer) if TOKEN is set.
UPLOAD_REPORT_URL = "https://www.pomfretastro.org/api/imaging/session-files"

# -------- Live preview config (scheme A) --------
# Generate/upload one latest JPEG preview for each session when possible.
PREVIEW_ENABLED = True
PREVIEW_MAX_WIDTH = 1280
PREVIEW_JPEG_QUALITY = 72
PREVIEW_EXTENSIONS = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".fit", ".fits"}
# API receives latest preview and keeps it until replaced.
PREVIEW_UPLOAD_URL = "https://www.pomfretastro.org/api/imaging/preview"

# -------- Siril stacking config --------
# Set to True to enable stacked master output when output mode is "stacked_master".
SIRIL_ENABLED = True
# Use siril-cli path on observatory PC.
SIRIL_CLI_PATH = r"C:\Program Files\Siril\bin\siril-cli.exe"
# Directory containing masters named like:
#   Master_Dark.fit, Master_Bias.fit, Master_L_Flat.fit, Master_H_Flat.fit, ...
SIRIL_CALIBRATION_DIR = r"C:\Users\Observatory\Documents\SirilCalibration"
# Temporary working root used for per-session stacking jobs.
SIRIL_WORK_ROOT = r"C:\Users\Observatory\Downloads\SirilWork"
# Max time for one stack run.
SIRIL_TIMEOUT_SECONDS = 60 * 60


def log(message: str) -> None:
    now = time.strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{now}] {message}", flush=True)


def build_headers() -> Dict[str, str]:
    headers: Dict[str, str] = {"Accept": "application/json"}
    if TOKEN.strip():
        headers["Authorization"] = f"Bearer {TOKEN}"
    return headers


def download_bytes(url: str) -> bytes:
    req = urllib.request.Request(url, headers=build_headers(), method="GET")
    with urllib.request.urlopen(req, timeout=300) as resp:
        return resp.read()


def post_json(url: str, payload: dict) -> Optional[dict]:
    data = json.dumps(payload).encode("utf-8")
    headers = build_headers()
    headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=120) as resp:
        raw = resp.read().decode("utf-8").strip()
        if not raw:
            return None
        return json.loads(raw)


def is_nina_running() -> bool:
    # Windows tasklist check
    try:
        result = subprocess.run(
            ["tasklist", "/FI", "IMAGENAME eq NINA.exe"],
            capture_output=True,
            text=True,
            check=False,
        )
        output = (result.stdout or "") + (result.stderr or "")
        return "NINA.exe" in output
    except Exception:
        return False


def start_nina(sequence_path: Path) -> subprocess.Popen[bytes]:
    nina_exe = str(Path(NINA_INSTALL_DIR) / "NINA.exe")
    args = [nina_exe, "--sequencefile", str(sequence_path), "--runsequence", *NINA_EXTRA_ARGS]
    log(f"Starting NINA with sequence: {sequence_path}")
    return subprocess.Popen(args, cwd=str(Path(NINA_INSTALL_DIR)))


def wait_for_nina_exit(process: subprocess.Popen[bytes]) -> None:
    log("NINA started; agent will pause URL polling until NINA exits.")
    while True:
        code = process.poll()
        if code is not None:
            log(f"NINA exited with code {code}. Resuming URL polling.")
            return
        time.sleep(RUNNING_CHECK_SECONDS)


def validate_config() -> None:
    if "your-domain.com" in SEQUENCE_JSON_URL:
        raise ValueError("Please set SEQUENCE_JSON_URL.")
    nina_exe = Path(NINA_INSTALL_DIR) / "NINA.exe"
    if not nina_exe.exists():
        raise ValueError(f"NINA.exe not found: {nina_exe}")
    if not Path(NINA_OUTPUT_DIR).exists():
        raise ValueError(f"NINA_OUTPUT_DIR not found: {NINA_OUTPUT_DIR}")
    if R2_ENABLED and boto3 is None:
        raise ValueError("R2_ENABLED is True but boto3 is not installed. Run: pip install boto3")
    if SIRIL_ENABLED and not Path(SIRIL_CALIBRATION_DIR).exists():
        raise ValueError(f"SIRIL_CALIBRATION_DIR not found: {SIRIL_CALIBRATION_DIR}")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def state_file_path(jobs_dir: Path) -> Path:
    return jobs_dir / ".last_sequence_fingerprint"


def read_last_fingerprint(jobs_dir: Path) -> str:
    state_path = state_file_path(jobs_dir)
    if state_path.exists():
        return state_path.read_text(encoding="utf-8").strip()
    return ""


def write_last_fingerprint(jobs_dir: Path, value: str) -> None:
    state_file_path(jobs_dir).write_text(value, encoding="utf-8")


def sequence_fingerprint(content: bytes) -> str:
    """
    Prefer stable task identifiers from JSON to avoid relaunching
    when only volatile fields (e.g. generated timestamp) changed.
    Falls back to full-content SHA256 when no known identifier exists.
    """
    try:
        payload = json.loads(content.decode("utf-8"))
        if isinstance(payload, dict):
            for key in ("jobId", "requestId", "sequenceId", "id", "version"):
                value = payload.get(key)
                if value not in (None, ""):
                    return f"{key}:{value}"
    except Exception:
        pass
    return f"sha256:{sha256_bytes(content)}"


def extract_sequence_metadata(content: bytes) -> tuple[Optional[str], str, Optional[str]]:
    """
    Returns (session_id, output_mode, filter_name) from downloaded JSON metadata.
    output_mode defaults to raw_zip when missing or invalid.
    """
    try:
        payload = json.loads(content.decode("utf-8"))
    except Exception:
        return None, OUTPUT_MODE_RAW_ZIP, None

    if not isinstance(payload, dict):
        return None, OUTPUT_MODE_RAW_ZIP, None

    output_mode = OUTPUT_MODE_RAW_ZIP
    filter_name: Optional[str] = None
    # Preferred: custom metadata injected by Pomfret API.
    pomfret = payload.get("PomfretAstro")
    if isinstance(pomfret, dict):
        mode = pomfret.get("OutputMode")
        if mode == OUTPUT_MODE_STACKED_MASTER:
            output_mode = OUTPUT_MODE_STACKED_MASTER
        elif mode == OUTPUT_MODE_NONE:
            output_mode = OUTPUT_MODE_NONE
        raw_filter = pomfret.get("FilterName")
        if isinstance(raw_filter, str) and raw_filter.strip():
            filter_name = raw_filter.strip()
        queue_id = pomfret.get("QueueId")
        if queue_id not in (None, ""):
            return str(queue_id), output_mode, filter_name

    # Backward-compatible fallback keys.
    for key in SESSION_ID_KEYS:
        value = payload.get(key)
        if value not in (None, ""):
            return str(value), output_mode, filter_name
    return None, output_mode, filter_name


def snapshot_output_files(root_dir: Path) -> Dict[str, int]:
    snapshot: Dict[str, int] = {}
    if not root_dir.exists():
        return snapshot
    for p in root_dir.rglob("*"):
        if not p.is_file():
            continue
        if p.suffix.lower() not in UPLOAD_EXTENSIONS:
            continue
        try:
            snapshot[str(p)] = p.stat().st_mtime_ns
        except OSError:
            continue
    return snapshot


def find_new_or_updated_files(before: Dict[str, int], root_dir: Path) -> list[Path]:
    results: list[Path] = []
    for p in root_dir.rglob("*"):
        if not p.is_file():
            continue
        if p.suffix.lower() not in UPLOAD_EXTENSIONS:
            continue
        key = str(p)
        try:
            mtime = p.stat().st_mtime_ns
        except OSError:
            continue
        if key not in before or mtime > before[key]:
            results.append(p)
    results.sort(key=lambda x: str(x))
    return results


def sanitize_for_key(value: str) -> str:
    return "".join(c if c.isalnum() or c in ("-", "_", ".") else "_" for c in value)


def create_r2_client():
    endpoint = f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=R2_ACCESS_KEY_ID,
        aws_secret_access_key=R2_SECRET_ACCESS_KEY,
        region_name="auto",
    )


def upload_files_to_r2(files: list[Path], run_id: str, output_root: Path) -> list[dict]:
    if not R2_ENABLED:
        log("R2 upload disabled. Skipping upload phase.")
        return []
    if not files:
        log("No new output files found for upload.")
        return []

    client = create_r2_client()
    uploaded_files: list[dict] = []
    uploaded = 0
    for path in files:
        try:
            relative = path.relative_to(output_root)
        except ValueError:
            relative = Path(path.name)
        object_key = f"{R2_PREFIX}/{run_id}/{str(relative).replace('\\', '/')}"
        client.upload_file(str(path), R2_BUCKET, object_key)
        uploaded += 1
        uploaded_files.append(
            {
                "fileName": path.name,
                "objectKey": object_key,
                "sizeBytes": path.stat().st_size,
            }
        )
        if R2_PUBLIC_BASE_URL.strip():
            public_url = f"{R2_PUBLIC_BASE_URL.rstrip('/')}/{object_key}"
            log(f"Uploaded: {path.name} -> {public_url}")
        else:
            log(f"Uploaded: {path.name} -> s3://{R2_BUCKET}/{object_key}")
    log(f"Upload phase complete. Uploaded {uploaded} files.")
    return uploaded_files


def pick_preview_source(files: list[Path]) -> Optional[Path]:
    candidates: list[Path] = []
    for p in files:
        if p.suffix.lower() in PREVIEW_EXTENSIONS:
            candidates.append(p)
    if not candidates:
        return None
    candidates.sort(key=lambda p: p.stat().st_mtime_ns, reverse=True)
    return candidates[0]


def build_preview_image(source: Path, run_id: str, jobs_dir: Path) -> Optional[Path]:
    if Image is None or ImageOps is None:
        log("Pillow not installed; skipping preview generation. Run: pip install pillow")
        return None
    preview_path = jobs_dir / f"{run_id}_preview.jpg"
    if source.suffix.lower() in {".fit", ".fits"}:
        return build_preview_from_fits(source, preview_path)
    try:
        with Image.open(source) as img:
            oriented = ImageOps.exif_transpose(img)
            rgb = oriented.convert("RGB")
            if rgb.width > PREVIEW_MAX_WIDTH and PREVIEW_MAX_WIDTH > 0:
                scale = PREVIEW_MAX_WIDTH / float(rgb.width)
                new_size = (PREVIEW_MAX_WIDTH, max(1, int(rgb.height * scale)))
                rgb = rgb.resize(new_size, RESAMPLE_LANCZOS)
            rgb.save(preview_path, format="JPEG", quality=PREVIEW_JPEG_QUALITY, optimize=True)
            log(f"Preview generated from {source.name}: {preview_path.name}")
            return preview_path
    except Exception as ex:
        log(f"Failed to build preview from {source.name}: {ex}")
        return None


def build_preview_from_fits(source: Path, preview_path: Path) -> Optional[Path]:
    if fits is None or np is None or Image is None:
        log("FITS preview requires astropy + numpy + pillow. Run: pip install astropy numpy pillow")
        return None
    try:
        with fits.open(source, memmap=False) as hdul:
            frame = None
            for hdu in hdul:
                data = getattr(hdu, "data", None)
                if data is None:
                    continue
                arr = np.asarray(data)
                if arr.size == 0:
                    continue
                frame = arr
                break
            if frame is None:
                log(f"FITS preview skipped; no image data in {source.name}")
                return None
    except Exception as ex:
        log(f"Failed reading FITS {source.name}: {ex}")
        return None

    try:
        frame = np.squeeze(frame)
        if frame.ndim > 2:
            frame = frame[0]
        frame = frame.astype(np.float32, copy=False)
        finite = np.isfinite(frame)
        if not np.any(finite):
            log(f"FITS preview skipped; all pixels invalid in {source.name}")
            return None
        valid = frame[finite]
        lo = float(np.percentile(valid, 1.0))
        hi = float(np.percentile(valid, 99.5))
        if not np.isfinite(lo) or not np.isfinite(hi) or hi <= lo:
            lo = float(np.min(valid))
            hi = float(np.max(valid))
            if hi <= lo:
                hi = lo + 1.0
        stretched = np.clip((frame - lo) / (hi - lo), 0.0, 1.0)
        img_u8 = np.asarray(stretched * 255.0, dtype=np.uint8)
        image = Image.fromarray(img_u8, mode="L").convert("RGB")
        if image.width > PREVIEW_MAX_WIDTH and PREVIEW_MAX_WIDTH > 0:
            scale = PREVIEW_MAX_WIDTH / float(image.width)
            new_size = (PREVIEW_MAX_WIDTH, max(1, int(image.height * scale)))
            image = image.resize(new_size, RESAMPLE_LANCZOS)
        image.save(preview_path, format="JPEG", quality=PREVIEW_JPEG_QUALITY, optimize=True)
        log(f"Preview generated from FITS {source.name}: {preview_path.name}")
        return preview_path
    except Exception as ex:
        log(f"Failed converting FITS preview from {source.name}: {ex}")
        return None


def report_uploaded_files(session_id: str, files: list[dict]) -> None:
    if not UPLOAD_REPORT_URL.strip():
        log("UPLOAD_REPORT_URL not set. Skipping upload report callback.")
        return
    payload = {
        "queueId": session_id,
        "bucket": R2_BUCKET,
        "prefix": R2_PREFIX,
        "files": files,
    }
    post_json(UPLOAD_REPORT_URL, payload)
    log(f"Reported {len(files)} files to backend for queueId {session_id}.")


def upload_preview_to_api(session_id: str, preview_path: Path) -> bool:
    if not PREVIEW_UPLOAD_URL.strip():
        return False
    try:
        data_base64 = base64.b64encode(preview_path.read_bytes()).decode("ascii")
    except Exception as ex:
        log(f"Preview read failed: {ex}")
        return False
    payload = {
        "queueId": session_id,
        "imageId": session_id,
        "contentType": "image/jpeg",
        "dataBase64": data_base64,
    }
    try:
        post_json(PREVIEW_UPLOAD_URL, payload)
    except Exception as ex:
        log(f"Preview API upload failed: {ex}")
        return False
    log(f"Uploaded latest preview via API for session {session_id}.")
    return True


def try_push_live_preview(session_id: Optional[str], run_id: str, files: list[Path], jobs_dir: Path) -> None:
    if not PREVIEW_ENABLED or not session_id or not files:
        return
    source = pick_preview_source(files)
    if not source:
        return
    preview_path = build_preview_image(source, run_id, jobs_dir)
    if not preview_path:
        return
    try:
        upload_preview_to_api(session_id, preview_path)
    finally:
        try:
            preview_path.unlink(missing_ok=True)
        except OSError:
            pass


def make_zip_for_session(files: list[Path], run_id: str, jobs_dir: Path, output_root: Path) -> Optional[Path]:
    if not files:
        return None
    zip_path = jobs_dir / f"{run_id}.zip"
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for path in files:
            try:
                rel = path.relative_to(output_root).as_posix()
            except ValueError:
                rel = path.name
            zf.write(path, arcname=f"{run_id}/{rel}")
    log(f"Packed {len(files)} output file(s) into {zip_path.name}.")
    return zip_path


def _normalize_filter_name(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    token = "".join(ch for ch in value.upper() if ch.isalnum())
    return token or None


def _pick_master_by_stem(calib_dir: Path, stem: str) -> Optional[Path]:
    if not calib_dir.exists():
        return None
    candidates = [p for p in calib_dir.iterdir() if p.is_file() and p.stem.upper() == stem.upper()]
    if not candidates:
        return None
    preferred_ext = {".fit": 0, ".fits": 1, ".xisf": 2}
    candidates.sort(key=lambda p: preferred_ext.get(p.suffix.lower(), 99))
    return candidates[0]


def _resolve_calibration_masters(session_filter: Optional[str]) -> tuple[Optional[Path], Optional[Path], Optional[Path]]:
    calib_dir = Path(SIRIL_CALIBRATION_DIR)
    bias = _pick_master_by_stem(calib_dir, "Master_Bias")
    dark = _pick_master_by_stem(calib_dir, "Master_Dark")
    flat: Optional[Path] = None
    filter_token = _normalize_filter_name(session_filter)
    if filter_token:
        flat = _pick_master_by_stem(calib_dir, f"Master_{filter_token}_Flat")
    if flat is None:
        # Optional generic fallback for a shared flat file.
        flat = _pick_master_by_stem(calib_dir, "Master_Flat")
    return bias, dark, flat


def stack_master_with_siril(files: list[Path], run_id: str, jobs_dir: Path, session_filter: Optional[str]) -> Optional[Path]:
    if not SIRIL_ENABLED:
        log("Siril is disabled; cannot build stacked master.")
        return None
    siril_cli = Path(SIRIL_CLI_PATH)
    if not siril_cli.exists():
        log(f"Siril CLI not found: {siril_cli}")
        return None
    if not files:
        return None

    accepted = [p for p in files if p.suffix.lower() in {".fit", ".fits", ".xisf"}]
    if not accepted:
        log("No FIT/FITS/XISF files found for Siril stacking; skipping stack.")
        return None

    work_root = Path(SIRIL_WORK_ROOT)
    work_dir = work_root / f"stack_{run_id}_{int(time.time())}"
    lights_dir = work_dir / "lights"
    work_dir.mkdir(parents=True, exist_ok=True)
    lights_dir.mkdir(parents=True, exist_ok=True)

    for src in accepted:
        dst = lights_dir / src.name
        if dst.exists():
            dst = lights_dir / f"{src.stem}_{hashlib.md5(str(src).encode('utf-8')).hexdigest()[:8]}{src.suffix}"
        shutil.copy2(src, dst)

    script_lines = [f'cd "{lights_dir}"', "convert light", "calibrate light -prefix=pp_"]
    bias_master, dark_master, flat_master = _resolve_calibration_masters(session_filter)
    if bias_master:
        script_lines[-1] += f' -bias="{bias_master}"'
    else:
        log("No Master_Bias found; Siril calibration will skip bias.")
    if dark_master:
        script_lines[-1] += f' -dark="{dark_master}"'
    else:
        log("No Master_Dark found; Siril calibration will skip dark.")
    if flat_master:
        script_lines[-1] += f' -flat="{flat_master}"'
    else:
        if session_filter:
            log(f"No flat master found for filter '{session_filter}'; calibration will skip flat.")
        else:
            log("No session filter metadata present; calibration will skip flat.")
    script_lines.extend(
        [
            "register pp_light",
            f'stack r_pp_light rej -out="{run_id}_master.fit"',
            "close",
        ]
    )

    script_path = work_dir / "stack.ssf"
    script_path.write_text("\n".join(script_lines) + "\n", encoding="utf-8")
    log(f"Running Siril stacking script: {script_path}")
    result = subprocess.run(
        [str(siril_cli), "-s", str(script_path)],
        capture_output=True,
        text=True,
        check=False,
        timeout=SIRIL_TIMEOUT_SECONDS,
    )
    if result.returncode != 0:
        log(f"Siril stack failed (code {result.returncode}).")
        if result.stdout:
            log(f"Siril stdout:\n{result.stdout[-2000:]}")
        if result.stderr:
            log(f"Siril stderr:\n{result.stderr[-2000:]}")
        return None

    output_master = lights_dir / f"{run_id}_master.fit"
    if not output_master.exists():
        log("Siril completed but master file was not produced.")
        return None
    final_master = jobs_dir / f"{run_id}_master.fit"
    shutil.copy2(output_master, final_master)
    log(f"Siril master created: {final_master}")
    return final_master


def process_finished_session(job: dict) -> None:
    session_id = job["session_id"]
    run_id = job["run_id"]
    output_mode = job["output_mode"]
    session_filter = job.get("session_filter")
    new_files = job["new_files"]
    jobs_dir = Path(job["jobs_dir"])
    output_root = Path(job["output_root"])

    uploaded_files: list[dict] = []
    temp_outputs: list[Path] = []
    try:
        if output_mode == OUTPUT_MODE_NONE:
            log("Output mode is 'none'; skipping all uploads and ending session.")
            return
        if not new_files:
            log("No new output files after NINA; skipping upload.")
            return
        if not R2_ENABLED:
            log("R2 upload disabled; skipping post-processing upload.")
            return

        if output_mode == OUTPUT_MODE_STACKED_MASTER:
            master = stack_master_with_siril(new_files, run_id, jobs_dir, session_filter)
            if master:
                temp_outputs.append(master)
                uploaded_files = upload_files_to_r2([master], run_id, jobs_dir)
            else:
                log("Falling back to raw zip upload because Siril stack was unavailable/failed.")

        if not uploaded_files:
            zip_path = make_zip_for_session(new_files, run_id, jobs_dir, output_root)
            if zip_path:
                temp_outputs.append(zip_path)
                uploaded_files = upload_files_to_r2([zip_path], run_id, jobs_dir)

        if session_id and uploaded_files:
            report_uploaded_files(session_id, uploaded_files)
    finally:
        for p in temp_outputs:
            try:
                p.unlink(missing_ok=True)
            except OSError:
                pass


def wait_for_nina_and_stream_previews(
    process: subprocess.Popen[bytes],
    session_id: Optional[str],
    output_mode: str,
    run_id: str,
    output_root: Path,
    jobs_dir: Path,
    baseline_snapshot: Dict[str, int],
) -> None:
    log("NINA started; agent will pause URL polling until NINA exits.")
    rolling_snapshot = dict(baseline_snapshot)
    while True:
        code = process.poll()
        if code is not None:
            log(f"NINA exited with code {code}. Resuming URL polling.")
            return
        if PREVIEW_ENABLED and session_id:
            changed = find_new_or_updated_files(rolling_snapshot, output_root)
            if changed:
                try_push_live_preview(session_id, run_id, changed, jobs_dir)
                for path in changed:
                    try:
                        rolling_snapshot[str(path)] = path.stat().st_mtime_ns
                    except OSError:
                        pass
        time.sleep(RUNNING_CHECK_SECONDS)


def run_loop() -> None:
    jobs_dir = Path(JOBS_DIR)
    jobs_dir.mkdir(parents=True, exist_ok=True)
    sequence_path = jobs_dir / LOCAL_SEQUENCE_FILENAME
    output_root = Path(NINA_OUTPUT_DIR)
    postprocess_queue: queue.Queue[dict] = queue.Queue()

    def postprocess_worker() -> None:
        while True:
            job = postprocess_queue.get()
            try:
                process_finished_session(job)
            except Exception as ex:
                log(f"Post-process worker error: {ex}")
                traceback.print_exc()
            finally:
                postprocess_queue.task_done()

    threading.Thread(target=postprocess_worker, name="postprocess-worker", daemon=True).start()

    log("Agent started.")
    while True:
        try:
            if SKIP_WHEN_NINA_RUNNING and is_nina_running():
                log("NINA is already running. Skipping this poll.")
                time.sleep(POLL_SECONDS)
                continue

            try:
                content = download_bytes(SEQUENCE_JSON_URL)
            except urllib.error.HTTPError as ex:
                if ex.code == 404:
                    log("No sequence available yet (HTTP 404).")
                    time.sleep(POLL_SECONDS)
                    continue
                if ex.code == 409:
                    log("Sequence not ready yet (HTTP 409, server-side gate not met).")
                    time.sleep(POLL_SECONDS)
                    continue
                raise

            current_fingerprint = sequence_fingerprint(content)
            session_id, output_mode, session_filter = extract_sequence_metadata(content)
            last_fingerprint = read_last_fingerprint(jobs_dir)
            if current_fingerprint == last_fingerprint:
                time.sleep(POLL_SECONDS)
                continue

            log("New sequence content detected, downloading and launching.")
            sequence_path.write_bytes(content)
            write_last_fingerprint(jobs_dir, current_fingerprint)
            before_snapshot = snapshot_output_files(output_root)
            if session_id:
                run_id = sanitize_for_key(session_id)
                log(f"Using session id for R2 folder: {run_id}")
            else:
                run_id = sanitize_for_key(current_fingerprint)
                log("Session id not found in JSON, using fingerprint for R2 folder.")
            nina_process = start_nina(sequence_path)
            wait_for_nina_and_stream_previews(
                nina_process,
                session_id=session_id,
                output_mode=output_mode,
                run_id=run_id,
                output_root=output_root,
                jobs_dir=jobs_dir,
                baseline_snapshot=before_snapshot,
            )
            new_files = find_new_or_updated_files(before_snapshot, output_root)
            postprocess_queue.put(
                {
                    "session_id": session_id,
                    "run_id": run_id,
                    "output_mode": output_mode,
                    "session_filter": session_filter,
                    "new_files": new_files,
                    "jobs_dir": str(jobs_dir),
                    "output_root": str(output_root),
                }
            )
            log(
                f"Queued post-processing for {run_id} ({output_mode}); pending jobs: {postprocess_queue.qsize()}."
            )

        except Exception as ex:
            log(f"Error: {ex}")
            traceback.print_exc()

        time.sleep(POLL_SECONDS)


def main() -> None:
    validate_config()
    run_loop()


if __name__ == "__main__":
    main()
