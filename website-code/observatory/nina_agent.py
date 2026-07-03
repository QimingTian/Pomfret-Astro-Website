#!/usr/bin/env python3
"""
Minimal NINA polling agent for Windows observatory PC.

This version supports a simple workflow:
  - Your website always publishes a complete sequence JSON at one fixed URL.
  - Agent downloads that JSON on a polling interval.
  - If content changed since last download, agent starts NINA with that JSON.

Usage:
  1) Copy this file to the observatory PC.
  2) Edit the CONFIG section below (paths only — no secrets in git).
  3) Set Windows environment variables (same names as Vercel where noted):
       IMAGING_QUEUE_SECRET, POMFRET_CRON_SECRET (same as CRON_SECRET),
       R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET,
       PDU_USER, PDU_PASSWORD (Digital Loggers PDU at 192.168.121.5).
  4) Run: python nina_agent.py
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
import os
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlparse
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
_nina_seq = urlparse(SEQUENCE_JSON_URL)
RECONCILE_QUEUE_URL = (
    f"{_nina_seq.scheme}://{_nina_seq.netloc}/api/imaging/reconcile-queue-schedule"
    if _nina_seq.scheme and _nina_seq.netloc
    else ""
)
AGENT_PULSE_URL = (
    f"{_nina_seq.scheme}://{_nina_seq.netloc}/api/imaging/agent-pulse"
    if _nina_seq.scheme and _nina_seq.netloc
    else ""
)
ESTOP_DELIVERY_URL = (
    f"{_nina_seq.scheme}://{_nina_seq.netloc}/api/imaging/emergency-stop/delivery"
    if _nina_seq.scheme and _nina_seq.netloc
    else ""
)
AGENT_EVENTS_URL = (
    f"{_nina_seq.scheme}://{_nina_seq.netloc}/api/imaging/agent-events"
    if _nina_seq.scheme and _nina_seq.netloc
    else ""
)
# Server returns 410 — poll-only saves Vercel Fluid hours on Hobby.
AGENT_EVENTS_SSE_ENABLED = False
# Vercel Hobby cannot run sub-daily crons; agent used to trigger reconcile on poll cadence.
# Reconcile is now pushed via agent-events SSE (or fallback poll below).
RECONCILE_EVERY_N_POLLS = 0
# Optional override. Otherwise: env POMFRET_CRON_SECRET (same as Vercel CRON_SECRET), then TOKEN.
RECONCILE_BEARER = ""

# Optional bearer for nina-sequence / uploads. Required for production pomfretastro.org URLs.
TOKEN = ""

POLL_SECONDS = 45
FALLBACK_POLL_SECONDS = 300
SSE_CONNECTED_WAIT_SECONDS = 60
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
RUNNING_PULSE_INTERVAL_SECONDS = 30
# While NINA is running, poll for Emergency STOP sequence at this interval.
ESTOP_POLL_SECONDS = 5

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
# Install dependency on observatory PC once: pip install boto3
# Credentials: Windows env R2_* (same values as Vercel). Never commit secrets here.
R2_ENABLED = True
R2_ACCOUNT_ID = ""
R2_ACCESS_KEY_ID = ""
R2_SECRET_ACCESS_KEY = ""
R2_BUCKET = ""
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
# Stacking defaults for light frames. Tuned for robust outlier rejection and level matching.
# - Rejection: winsorized sigma clipping (low=4 high=3)
# - Normalization: additive + scaling (recommended for light frames)
# - Output normalization: map stacked output into normalized range for easier downstream preview/stretch.
SIRIL_STACK_REJ = "winsorized 4 3"
SIRIL_STACK_NORM = "addscale"
SIRIL_STACK_OUTPUT_NORM = True
# If True, still pass -bias during light calibration even when -dark is provided.
# Most master-dark workflows already include the bias pedestal; keep this False to avoid double subtraction.
SIRIL_LIGHT_INCLUDE_BIAS_WHEN_DARK = False

# -------- Digital Loggers PDU (mount + camera power) --------
# Credentials: Windows env PDU_USER, PDU_PASSWORD (never commit secrets).
PDU_ENABLED = True
PDU_BASE_URL = "http://192.168.121.5"
# Outlet 1 = Scope (mount), 2 = Camera on Pomfret observatory PDU.
PDU_OUTLETS = (1, 2)
# Seconds to wait after turning outlets ON before starting NINA (cold boot).
PDU_WARMUP_SECONDS = 60


def log(message: str) -> None:
    now = time.strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{now}] {message}", flush=True)


def queue_bearer_token() -> str:
    """Bearer for nina-sequence / uploads. Prefer Windows env IMAGING_QUEUE_SECRET; never commit secrets."""
    return (TOKEN.strip() or os.environ.get("IMAGING_QUEUE_SECRET", "").strip())


def build_headers() -> Dict[str, str]:
    headers: Dict[str, str] = {"Accept": "application/json"}
    bearer = queue_bearer_token()
    if bearer:
        headers["Authorization"] = f"Bearer {bearer}"
    return headers


def pdu_credentials() -> tuple[str, str]:
    user = os.environ.get("PDU_USER", "").strip()
    password = os.environ.get("PDU_PASSWORD", "").strip()
    return user, password


def pdu_configured() -> bool:
    if not PDU_ENABLED:
        return False
    user, password = pdu_credentials()
    return bool(user and password and str(PDU_BASE_URL).strip())


def pdu_request(path: str) -> None:
    """GET a Digital Loggers PDU path (e.g. outlet?1=ON) with HTTP Basic auth."""
    user, password = pdu_credentials()
    base = str(PDU_BASE_URL).rstrip("/")
    url = f"{base}/{path.lstrip('/')}"
    cred = base64.b64encode(f"{user}:{password}".encode("ascii")).decode("ascii")
    req = urllib.request.Request(url, headers={"Authorization": f"Basic {cred}"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        resp.read()


def pdu_set_outlets(state: str, outlets: tuple[int, ...] = PDU_OUTLETS) -> bool:
    """Turn PDU outlets ON or OFF. Returns True if all requests succeeded."""
    state = state.upper()
    if state not in ("ON", "OFF"):
        raise ValueError(f"invalid PDU state: {state}")
    ok = True
    for outlet in outlets:
        try:
            pdu_request(f"outlet?{outlet}={state}")
            log(f"PDU outlet {outlet} -> {state}")
        except Exception as ex:
            ok = False
            log(f"PDU outlet {outlet} {state} failed: {ex}")
    return ok


def power_on_observatory_equipment() -> bool:
    """Turn on mount + camera outlets before NINA. Returns True if PDU control ran."""
    if not pdu_configured():
        if PDU_ENABLED:
            log("PDU enabled but PDU_USER / PDU_PASSWORD not set; skipping power ON.")
        return False
    log(f"PDU: turning ON outlets {PDU_OUTLETS} at {PDU_BASE_URL}")
    if not pdu_set_outlets("ON"):
        log("PDU: one or more outlets failed to turn ON.")
    warmup = max(0, int(PDU_WARMUP_SECONDS))
    if warmup > 0:
        log(f"PDU: waiting {warmup}s for equipment boot before NINA.")
        time.sleep(warmup)
    return True


def power_off_observatory_equipment() -> None:
    """Turn off mount + camera outlets after NINA exits."""
    if not pdu_configured():
        return
    log(f"PDU: turning OFF outlets {PDU_OUTLETS} at {PDU_BASE_URL}")
    pdu_set_outlets("OFF")


def reconcile_queue_bearer_token() -> str:
    return (RECONCILE_BEARER or os.environ.get("POMFRET_CRON_SECRET") or TOKEN or "").strip()


def reconcile_queue_headers() -> Dict[str, str]:
    headers: Dict[str, str] = {"Accept": "application/json"}
    bearer = reconcile_queue_bearer_token()
    if bearer:
        headers["Authorization"] = f"Bearer {bearer}"
    return headers


def _r2_env(name: str, inline: str) -> str:
    return (inline.strip() or os.environ.get(name, "").strip())


def r2_account_id() -> str:
    return _r2_env("R2_ACCOUNT_ID", R2_ACCOUNT_ID)


def r2_access_key_id() -> str:
    return _r2_env("R2_ACCESS_KEY_ID", R2_ACCESS_KEY_ID)


def r2_secret_access_key() -> str:
    return _r2_env("R2_SECRET_ACCESS_KEY", R2_SECRET_ACCESS_KEY)


def r2_bucket_name() -> str:
    return _r2_env("R2_BUCKET", R2_BUCKET)


def r2_public_base_url() -> str:
    return _r2_env("R2_PUBLIC_BASE_URL", R2_PUBLIC_BASE_URL)


def r2_object_prefix() -> str:
    prefix = _r2_env("R2_PREFIX", R2_PREFIX)
    return prefix or "imaging"


def r2_credentials_configured() -> bool:
    return bool(r2_account_id() and r2_access_key_id() and r2_secret_access_key() and r2_bucket_name())

def try_reconcile_queue_schedule() -> None:
    url = str(RECONCILE_QUEUE_URL).strip()
    if not url:
        return
    try:
        req = urllib.request.Request(url, headers=reconcile_queue_headers(), method="GET")
        with urllib.request.urlopen(req, timeout=120) as resp:
            raw = resp.read().decode("utf-8", errors="replace").strip()
        log(f"Queue schedule reconcile HTTP {resp.status}: {raw[:300]}")
    except urllib.error.HTTPError as ex:
        body = ex.read().decode("utf-8", errors="replace").strip() if ex.fp else ""
        log(f"Queue schedule reconcile HTTP {ex.code}: {body[:300]}")
    except Exception as ex:
        log(f"Queue schedule reconcile failed: {ex}")


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

def report_agent_pulse(nina_running: bool) -> bool:
    url = str(AGENT_PULSE_URL).strip()
    if not url:
        return False
    try:
        post_json(url, {"ninaRunning": nina_running})
        return True
    except urllib.error.HTTPError as ex:
        body = ex.read().decode("utf-8", errors="replace").strip() if ex.fp else ""
        log(f"Agent pulse HTTP {ex.code}: {body[:300]}")
    except Exception as ex:
        log(f"Agent pulse failed: {ex}")
    return False


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


def is_estop_sequence_content(content: bytes) -> bool:
    try:
        payload = json.loads(content.decode("utf-8"))
    except Exception:
        return False
    if not isinstance(payload, dict):
        return False
    pomfret = payload.get("PomfretAstro")
    return isinstance(pomfret, dict) and pomfret.get("SessionType") == "estop"


def poll_emergency_stop_sequence() -> Optional[bytes]:
    url = str(ESTOP_DELIVERY_URL or SEQUENCE_JSON_URL).strip()
    if not url:
        return None
    try:
        content = download_bytes(url)
    except urllib.error.HTTPError as ex:
        if ex.code in (204, 404, 409):
            return None
        return None
    except Exception as ex:
        log(f"Emergency STOP poll failed: {ex}")
        return None
    if is_estop_sequence_content(content):
        return content
    return None


_sse_lock = threading.Lock()
_sse_last_connected_at: float = 0.0
_wake_estop = threading.Event()
_wake_sequence = threading.Event()
_wake_reconcile = threading.Event()

_last_reconcile_mono = 0.0
RECONCILE_INTERVAL_SEC = 360.0


def _agent_sse_connected_recently() -> bool:
    with _sse_lock:
        if _sse_last_connected_at <= 0:
            return False
        return (time.monotonic() - _sse_last_connected_at) <= SSE_CONNECTED_WAIT_SECONDS


def _mark_agent_sse_connected() -> None:
    global _sse_last_connected_at
    with _sse_lock:
        _sse_last_connected_at = time.monotonic()


def _handle_agent_sse_payload(raw: str) -> None:
    try:
        payload = json.loads(raw)
    except Exception:
        return
    if not isinstance(payload, dict):
        return
    event_type = payload.get("type")
    if event_type == "estop":
        _wake_estop.set()
    elif event_type == "poll_sequence":
        _wake_sequence.set()
    elif event_type == "reconcile":
        _wake_reconcile.set()
    if event_type in ("connected", "estop", "poll_sequence", "reconcile", "ping"):
        _mark_agent_sse_connected()


def agent_events_reader_loop() -> None:
    if not AGENT_EVENTS_SSE_ENABLED:
        log("Agent events SSE disabled; using nina-sequence polling only.")
        return
    url = str(AGENT_EVENTS_URL).strip()
    if not url:
        log("AGENT_EVENTS_URL not configured; using fallback polling only.")
        return
    while True:
        try:
            req = urllib.request.Request(url, headers=build_headers(), method="GET")
            with urllib.request.urlopen(req, timeout=330) as resp:
                _mark_agent_sse_connected()
                log("Agent events SSE connected.")
                for raw_line in resp:
                    line = raw_line.decode("utf-8", errors="replace").strip()
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data:
                        _handle_agent_sse_payload(data)
        except urllib.error.HTTPError as ex:
            if ex.code == 410:
                log("Agent events SSE disabled by server (410); using poll-only mode.")
                return
            log(f"Agent events SSE disconnected: HTTP {ex.code}")
        except Exception as ex:
            log(f"Agent events SSE disconnected: {ex}")
        time.sleep(5)


def _wait_agent_wake(timeout_sec: float) -> Optional[str]:
    deadline = time.monotonic() + max(0.1, timeout_sec)
    while time.monotonic() < deadline:
        if _wake_estop.is_set():
            _wake_estop.clear()
            return "estop"
        if _wake_sequence.is_set():
            _wake_sequence.clear()
            return "poll_sequence"
        if _wake_reconcile.is_set():
            _wake_reconcile.clear()
            return "reconcile"
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        _wake_estop.wait(timeout=min(1.0, remaining))
    return None


def sleep_between_polls() -> Optional[str]:
    global _last_reconcile_mono
    if _agent_sse_connected_recently():
        timeout = float(SSE_CONNECTED_WAIT_SECONDS)
        now_mono = time.monotonic()
        if now_mono - _last_reconcile_mono >= RECONCILE_INTERVAL_SEC:
            _last_reconcile_mono = now_mono
            try_reconcile_queue_schedule()
    else:
        timeout = float(FALLBACK_POLL_SECONDS)
    wake = _wait_agent_wake(timeout)
    if wake == "reconcile":
        try_reconcile_queue_schedule()
        return "reconcile"
    if wake is None and not _agent_sse_connected_recently():
        try_reconcile_queue_schedule()
        return "reconcile"
    n = int(RECONCILE_EVERY_N_POLLS)
    if n > 0 and str(RECONCILE_QUEUE_URL).strip():
        # Legacy reconcile-on-poll (disabled when RECONCILE_EVERY_N_POLLS = 0).
        pass
    return wake


def kill_nina_process(process: Optional[subprocess.Popen[bytes]] = None) -> None:
    if process is not None and process.poll() is None:
        log("Terminating tracked NINA process for Emergency STOP…")
        process.terminate()
        try:
            process.wait(timeout=15)
        except subprocess.TimeoutExpired:
            process.kill()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                pass
    if is_nina_running():
        log("Force-killing NINA.exe via taskkill for Emergency STOP…")
        subprocess.run(
            ["taskkill", "/F", "/IM", "NINA.exe"],
            capture_output=True,
            text=True,
            check=False,
        )


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
    host = (_nina_seq.hostname or "").lower()
    is_production_host = host.endswith("pomfretastro.org")
    if is_production_host and not queue_bearer_token():
        raise ValueError(
            "Production SEQUENCE_JSON_URL requires a bearer token (same as Vercel IMAGING_QUEUE_SECRET). "
            "Set Windows env IMAGING_QUEUE_SECRET on this PC — do not commit secrets into this file."
        )
    if RECONCILE_EVERY_N_POLLS > 0 and not str(RECONCILE_QUEUE_URL).strip():
        raise ValueError("RECONCILE_QUEUE_URL is empty (check SEQUENCE_JSON_URL).")
    if RECONCILE_EVERY_N_POLLS > 0 and str(RECONCILE_QUEUE_URL).strip() and not reconcile_queue_bearer_token():
        log(
            "Queue reconcile is enabled but no bearer token: set Windows env POMFRET_CRON_SECRET "
            "(same as Vercel CRON_SECRET), or RECONCILE_BEARER / TOKEN, if the host returns 401."
        )
    nina_exe = Path(NINA_INSTALL_DIR) / "NINA.exe"
    if not nina_exe.exists():
        raise ValueError(f"NINA.exe not found: {nina_exe}")
    if not Path(NINA_OUTPUT_DIR).exists():
        raise ValueError(f"NINA_OUTPUT_DIR not found: {NINA_OUTPUT_DIR}")
    if R2_ENABLED and boto3 is None:
        raise ValueError("R2_ENABLED is True but boto3 is not installed. Run: pip install boto3")
    if R2_ENABLED and not r2_credentials_configured():
        raise ValueError(
            "R2_ENABLED is True but R2 credentials are missing. Set Windows env "
            "R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET "
            "(same values as Vercel) — do not commit secrets into this file."
        )
    if SIRIL_ENABLED and not Path(SIRIL_CALIBRATION_DIR).exists():
        raise ValueError(f"SIRIL_CALIBRATION_DIR not found: {SIRIL_CALIBRATION_DIR}")
    if PDU_ENABLED and not pdu_configured():
        log(
            "PDU_ENABLED is True but PDU_USER / PDU_PASSWORD are missing; "
            "power control will be skipped until env vars are set."
        )


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
            pomfret = payload.get("PomfretAstro")
            if isinstance(pomfret, dict):
                session_type = pomfret.get("SessionType")
                queue_id = pomfret.get("QueueId")
                if session_type == "estop" and queue_id not in (None, ""):
                    return f"estop:{queue_id}"
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
    account_id = r2_account_id()
    endpoint = f"https://{account_id}.r2.cloudflarestorage.com"
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=r2_access_key_id(),
        aws_secret_access_key=r2_secret_access_key(),
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
        object_key = f"{r2_object_prefix()}/{run_id}/{str(relative).replace('\\', '/')}"
        bucket = r2_bucket_name()
        client.upload_file(str(path), bucket, object_key)
        uploaded += 1
        uploaded_files.append(
            {
                "fileName": path.name,
                "objectKey": object_key,
                "sizeBytes": path.stat().st_size,
            }
        )
        public_base = r2_public_base_url()
        if public_base:
            public_url = f"{public_base.rstrip('/')}/{object_key}"
            log(f"Uploaded: {path.name} -> {public_url}")
        else:
            log(f"Uploaded: {path.name} -> s3://{bucket}/{object_key}")
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
        "bucket": r2_bucket_name(),
        "prefix": r2_object_prefix(),
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


def _stage_calibration_master_in_lights(
    lights_dir: Path, master: Optional[Path], label: str
) -> tuple[Optional[Path], Optional[str]]:
    """
    Copy calibration master into lights_dir and return Siril token without extension.
    Siril's calibrate options are more reliable with local basenames (e.g. Master_Bias).
    """
    if master is None:
        return None, None
    try:
        staged = lights_dir / master.name
        if staged.resolve() != master.resolve():
            shutil.copy2(master, staged)
        return staged, staged.stem
    except Exception as ex:
        log(f"Could not stage {label} master '{master}': {ex}")
        return None, None


def _siril_cli_path_str(path: Path) -> str:
    """Siril accepts forward slashes on Windows."""
    return path.resolve().as_posix()


def _find_siril_stack_output_master(lights_dir: Path, work_dir: Path, run_id: str) -> Optional[Path]:
    """Resolve stacked FITS: explicit -out name, then Siril default ``<sequence>_stacked.fit``."""
    for name in (f"{run_id}_master.fit", f"{run_id}_master.fits"):
        p = lights_dir / name
        if p.is_file():
            return p
    for name in ("r_pp_light_stacked.fit", "r_pp_light_stacked.fits"):
        p = lights_dir / name
        if p.is_file():
            return p
    for root in (lights_dir, work_dir):
        try:
            for pat in ("*_stacked.fit", "*_stacked.fits"):
                matches = [p for p in root.glob(pat) if p.is_file()]
                if matches:
                    matches.sort(key=lambda x: x.stat().st_mtime, reverse=True)
                    return matches[0]
        except OSError:
            pass
    return None


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

    script_lines = ["requires 1.4.0", f'cd "{lights_dir}"', "convert light", "calibrate light -prefix=pp_"]
    bias_master, dark_master, flat_master = _resolve_calibration_masters(session_filter)
    _bias_staged, bias_token = _stage_calibration_master_in_lights(lights_dir, bias_master, "bias")
    _dark_staged, dark_token = _stage_calibration_master_in_lights(lights_dir, dark_master, "dark")
    _flat_staged, flat_token = _stage_calibration_master_in_lights(lights_dir, flat_master, "flat")
    if dark_token:
        script_lines[-1] += f" -dark={dark_token}"
    else:
        log("No Master_Dark found; Siril calibration will skip dark.")
    include_bias = bias_token is not None and (dark_token is None or SIRIL_LIGHT_INCLUDE_BIAS_WHEN_DARK)
    if include_bias:
        script_lines[-1] += f" -bias={bias_token}"
    elif bias_token is None:
        log("No Master_Bias found; Siril calibration will skip bias.")
    else:
        log("Skipping Master_Bias in light calibration because Master_Dark is present (avoid double subtraction).")
    if flat_token:
        script_lines[-1] += f" -flat={flat_token}"
    else:
        if session_filter:
            log(f"No flat master found for filter '{session_filter}'; calibration will skip flat.")
        else:
            log("No session filter metadata present; calibration will skip flat.")
    out_master = lights_dir / f"{run_id}_master.fit"
    out_arg = _siril_cli_path_str(out_master)
    rej = (SIRIL_STACK_REJ or "winsorized 4 3").strip()
    norm = (SIRIL_STACK_NORM or "addscale").strip().lower()
    if norm not in {"add", "mul", "addscale", "mulscale", "none"}:
        log(f"Unknown SIRIL_STACK_NORM '{SIRIL_STACK_NORM}', falling back to addscale.")
        norm = "addscale"
    stack_cmd = f"stack r_pp_light rej {rej}"
    if norm != "none":
        stack_cmd += f" -norm={norm}"
    if SIRIL_STACK_OUTPUT_NORM:
        stack_cmd += " -output_norm"
    stack_cmd += f" -out={out_arg}"
    script_lines.extend(
        [
            "register pp_light",
            # `stack seq rej` must include a rejection type (e.g. winsorized 4 3 / none).
            stack_cmd,
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

    output_master = _find_siril_stack_output_master(lights_dir, work_dir, run_id)
    if output_master is None:
        log("Siril completed but master file was not produced.")
        try:
            names = sorted(p.name for p in lights_dir.iterdir() if p.is_file())
            log(f"Siril lights_dir files ({len(names)}): {names[:40]}{'…' if len(names) > 40 else ''}")
        except OSError as ex:
            log(f"Could not list lights_dir: {ex}")
        if result.stdout:
            log(f"Siril stdout:\n{result.stdout[-4000:]}")
        if result.stderr:
            log(f"Siril stderr:\n{result.stderr[-4000:]}")
        return None
    if output_master.name != f"{run_id}_master.fit":
        log(f"Using Siril stack output {output_master.name} (expected {run_id}_master.fit).")
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
) -> Optional[bytes]:
    """
    Block until NINA exits. Poll for Emergency STOP every ESTOP_POLL_SECONDS.
    Returns ESTOP sequence bytes when imaging must be interrupted; otherwise None.
    """
    log("NINA started; agent will pause URL polling until NINA exits.")
    rolling_snapshot = dict(baseline_snapshot)
    last_running_pulse_at = 0.0
    last_estop_poll_at = 0.0
    while True:
        code = process.poll()
        if code is not None:
            log(f"NINA exited with code {code}. Resuming URL polling.")
            return None
        now_monotonic = time.monotonic()
        if now_monotonic - last_estop_poll_at >= ESTOP_POLL_SECONDS:
            estop_content = poll_emergency_stop_sequence()
            last_estop_poll_at = now_monotonic
            if estop_content is not None:
                log("Emergency STOP sequence received — killing NINA to run ESTOP.")
                kill_nina_process(process)
                return estop_content
        if now_monotonic - last_running_pulse_at >= RUNNING_PULSE_INTERVAL_SECONDS:
            report_agent_pulse(True)
            last_running_pulse_at = now_monotonic
        if PREVIEW_ENABLED and session_id and output_mode != OUTPUT_MODE_NONE:
            changed = find_new_or_updated_files(rolling_snapshot, output_root)
            if changed:
                try_push_live_preview(session_id, run_id, changed, jobs_dir)
                for path in changed:
                    try:
                        rolling_snapshot[str(path)] = path.stat().st_mtime_ns
                    except OSError:
                        pass
        time.sleep(RUNNING_CHECK_SECONDS)


def handle_sequence_launch(
    content: bytes,
    jobs_dir: Path,
    sequence_path: Path,
    output_root: Path,
    postprocess_queue: "queue.Queue[dict]",
) -> Optional[bytes]:
    """
    Write sequence JSON, launch NINA, wait for exit.
    Returns ESTOP bytes when interrupted; otherwise queues post-process and returns None.
    """
    sequence_path.write_bytes(content)
    write_last_fingerprint(jobs_dir, sequence_fingerprint(content))
    is_estop = is_estop_sequence_content(content)
    session_id, output_mode, session_filter = extract_sequence_metadata(content)
    if session_id:
        run_id = sanitize_for_key(session_id)
        if is_estop:
            log(f"Emergency STOP sequence ({session_id}); skipping PDU and post-process.")
        else:
            log(f"Using session id for R2 folder: {run_id}")
    else:
        run_id = sanitize_for_key(sequence_fingerprint(content))
        if not is_estop:
            log("Session id not found in JSON, using fingerprint for R2 folder.")
    before_snapshot = snapshot_output_files(output_root)
    pdu_powered = False
    estop_content: Optional[bytes] = None
    try:
        if not is_estop:
            pdu_powered = power_on_observatory_equipment()
        nina_process = start_nina(sequence_path)
        report_agent_pulse(True)
        if is_estop:
            wait_for_nina_exit(nina_process)
        else:
            estop_content = wait_for_nina_and_stream_previews(
                nina_process,
                session_id=session_id,
                output_mode=output_mode,
                run_id=run_id,
                output_root=output_root,
                jobs_dir=jobs_dir,
                baseline_snapshot=before_snapshot,
            )
    finally:
        if pdu_powered:
            power_off_observatory_equipment()
    report_agent_pulse(False)
    if estop_content is not None:
        # ESTOP kills NINA mid-session; still upload frames captured before interrupt.
        if not is_estop:
            new_files = find_new_or_updated_files(before_snapshot, output_root)
            if new_files and output_mode != OUTPUT_MODE_NONE:
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
                    f"Emergency STOP interrupted imaging; queued partial upload for {run_id} "
                    f"({len(new_files)} file(s)); pending jobs: {postprocess_queue.qsize()}."
                )
        return estop_content
    if is_estop:
        return None
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
    return None


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
    threading.Thread(target=agent_events_reader_loop, name="agent-events-sse", daemon=True).start()

    log("Agent started.")
    last_pulsed_nina_running: Optional[bool] = None

    while True:
        try:
            if SKIP_WHEN_NINA_RUNNING and is_nina_running():
                estop_content = poll_emergency_stop_sequence()
                if estop_content is not None:
                    log("Emergency STOP armed while NINA is running — killing NINA and launching ESTOP.")
                    kill_nina_process()
                    launch_content = estop_content
                    while launch_content is not None:
                        log(
                            "Launching Emergency STOP sequence."
                            if is_estop_sequence_content(launch_content)
                            else "Relaunching after Emergency STOP interrupt."
                        )
                        launch_content = handle_sequence_launch(
                            launch_content,
                            jobs_dir,
                            sequence_path,
                            output_root,
                            postprocess_queue,
                        )
                    sleep_between_polls()
                    continue
                if report_agent_pulse(True):
                    last_pulsed_nina_running = True
                log("NINA is already running. Skipping this poll.")
                sleep_between_polls()
                continue
            if last_pulsed_nina_running is not False and report_agent_pulse(False):
                last_pulsed_nina_running = False

            try:
                content = download_bytes(SEQUENCE_JSON_URL)
            except urllib.error.HTTPError as ex:
                if ex.code == 404:
                    log("No sequence available yet (HTTP 404).")
                    sleep_between_polls()
                    continue
                if ex.code == 409:
                    detail = ""
                    try:
                        body = ex.read().decode("utf-8", errors="replace").strip()
                        if body:
                            detail = f" — {body[:500]}"
                    except Exception:
                        pass
                    log(f"Sequence not ready yet (HTTP 409, server-side gate not met){detail}.")
                    sleep_between_polls()
                    continue
                raise

            current_fingerprint = sequence_fingerprint(content)
            session_id, output_mode, session_filter = extract_sequence_metadata(content)
            last_fingerprint = read_last_fingerprint(jobs_dir)
            if current_fingerprint == last_fingerprint:
                if is_nina_running():
                    sleep_between_polls()
                    continue
                if last_fingerprint and sequence_path.is_file():
                    log("Sequence unchanged since last download and NINA is not running; re-launching.")
                    content = sequence_path.read_bytes()
                    session_id, output_mode, session_filter = extract_sequence_metadata(content)
                else:
                    sleep_between_polls()
                    continue
            else:
                log("New sequence content detected, downloading and launching.")
                sequence_path.write_bytes(content)
                write_last_fingerprint(jobs_dir, current_fingerprint)
            launch_content: bytes = content
            while launch_content is not None:
                if is_estop_sequence_content(launch_content):
                    log("Launching Emergency STOP sequence.")
                launch_content = handle_sequence_launch(
                    launch_content,
                    jobs_dir,
                    sequence_path,
                    output_root,
                    postprocess_queue,
                )
                if launch_content is not None and not is_estop_sequence_content(launch_content):
                    log("Imaging interrupted for Emergency STOP; launching ESTOP sequence immediately.")

        except Exception as ex:
            log(f"Error: {ex}")
            traceback.print_exc()

        sleep_between_polls()


def main() -> None:
    validate_config()
    run_loop()


if __name__ == "__main__":
    main()
