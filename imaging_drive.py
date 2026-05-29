"""
Google Drive uploads tied to camera mode: auto (every frame), half_hour, hour (scheduled).
"""

from __future__ import annotations

import threading
import time
import traceback
from datetime import datetime, timedelta
from typing import Any, Dict, Literal, Optional

IMAGING_FOLDER_AUTO = 'Auto'
IMAGING_FOLDER_HALF_HOUR = 'Half Hour'
IMAGING_FOLDER_HOUR = 'Hour'
IMAGING_FILE_FORMAT = 'TIFF'

DriveMode = Literal['off', 'auto', 'half_hour', 'hour']
AUTO_LIKE_MODES = frozenset({'auto', 'half_hour', 'hour'})

_imaging_lock = threading.Lock()
_state = {
    'mode': 'off',
    'thread': None,
    'last_error': None,
    'last_upload_iso': None,
    'last_upload_filename': None,
    'upload_count': 0,
    'drive_folder_id': None,
    'drive_folder_name': None,
}


def _observatory_now() -> datetime:
    try:
        from zoneinfo import ZoneInfo

        return datetime.now(ZoneInfo('America/New_York'))
    except Exception:
        return datetime.now()


def _folder_name_for_mode(mode: DriveMode) -> str:
    if mode == 'auto':
        return IMAGING_FOLDER_AUTO
    if mode == 'half_hour':
        return IMAGING_FOLDER_HALF_HOUR
    return IMAGING_FOLDER_HOUR


def _resolve_folder_id(folder_name: str) -> str:
    import google_drive_upload as gdrive

    root_id = gdrive.sequence_root_folder_id()
    return gdrive.get_or_create_folder(root_id, folder_name)


def _upload_tiff(folder_name: str, filename: str, img) -> None:
    import google_drive_upload as gdrive

    folder_id = _resolve_folder_id(folder_name)
    data, mime_type, ext = gdrive.encode_image(img, IMAGING_FILE_FORMAT)
    if not filename.lower().endswith(f'.{ext}'):
        filename = f'{filename}.{ext}'
    gdrive.upload_bytes(folder_id, filename, data, mime_type)
    with _imaging_lock:
        _state['drive_folder_id'] = folder_id
        _state['drive_folder_name'] = folder_name
        _state['last_error'] = None
        _state['last_upload_iso'] = datetime.now().astimezone().isoformat()
        _state['last_upload_filename'] = filename
        _state['upload_count'] = int(_state.get('upload_count', 0)) + 1
    print(f"[Imaging] Uploaded → {folder_name}/{filename}")


def _record_error(msg: str) -> None:
    with _imaging_lock:
        _state['last_error'] = msg
    print(f"[Imaging] Error: {msg}")


def _scheduler_alive() -> bool:
    with _imaging_lock:
        thread = _state.get('thread')
    return bool(thread and thread.is_alive())


def status_payload() -> Dict[str, Any]:
    """Diagnostics for /status (scheduler health, last upload, errors)."""
    with _imaging_lock:
        mode = _state.get('mode', 'off')
        thread = _state.get('thread')
        scheduler_running = bool(thread and thread.is_alive())
        return {
            'mode': mode,
            'schedulerRunning': scheduler_running,
            'uploadCount': int(_state.get('upload_count', 0)),
            'lastUploadIso': _state.get('last_upload_iso'),
            'lastUploadFilename': _state.get('last_upload_filename'),
            'lastError': _state.get('last_error'),
            'driveFolderName': _state.get('drive_folder_name'),
            'driveFolderId': _state.get('drive_folder_id'),
        }


def _join_scheduler_thread() -> None:
    with _imaging_lock:
        thread = _state.get('thread')
    if thread and thread.is_alive():
        thread.join(timeout=5.0)
    with _imaging_lock:
        _state['thread'] = None


def sync_from_camera_mode(mode: str) -> None:
    """Start/stop schedulers and reset state when camera mode changes."""
    import google_drive_upload as gdrive

    mode = (mode or 'off').lower().replace('-', '_')
    if mode not in AUTO_LIKE_MODES:
        mode = 'off'

    with _imaging_lock:
        if _state.get('mode') == mode and mode in ('half_hour', 'hour') and _scheduler_alive():
            return

    with _imaging_lock:
        if _state['mode'] in ('half_hour', 'hour'):
            _state['mode'] = 'off'
    _join_scheduler_thread()

    with _imaging_lock:
        _state['mode'] = mode
        if mode == 'off':
            _state['drive_folder_id'] = None
            _state['drive_folder_name'] = None
            return

        if not gdrive.drive_configured():
            _state['last_error'] = 'Google Drive is not configured on the Pi'
            print(f"[Imaging] Cannot start {mode}: Drive not configured")
            return

        folder_name = _folder_name_for_mode(mode)
        try:
            folder_id = _resolve_folder_id(folder_name)
            _state['drive_folder_id'] = folder_id
            _state['drive_folder_name'] = folder_name
            _state['last_error'] = None
        except Exception as e:
            _state['last_error'] = str(e)
            print(f"[Imaging] Cannot start {mode}: folder setup failed: {e}")
            return

        if mode in ('half_hour', 'hour'):
            _state['thread'] = threading.Thread(
                target=_scheduler_loop, args=(mode,), daemon=True, name=f'imaging-{mode}'
            )
            _state['thread'].start()
            print(f"[Imaging] Scheduler started ({mode})")


def ensure_scheduler_running() -> None:
    """Restart half_hour/hour scheduler if camera mode expects it but the thread died."""
    import camera_service as cam

    cam_mode = (cam.camera_state.get('mode') or 'off').lower().replace('-', '_')
    if cam_mode not in ('half_hour', 'hour'):
        return
    if not cam.auto_state.get('active'):
        return
    if _scheduler_should_run(cam_mode) and _scheduler_alive():
        return
    print(f"[Imaging] Scheduler missing for {cam_mode}; restarting")
    sync_from_camera_mode(cam_mode)


def after_auto_capture(img, camera_mode: str) -> None:
    """Upload frame when camera mode is auto (every capture)."""
    if (camera_mode or 'off') != 'auto':
        return
    try:
        now = _observatory_now()
        filename = now.strftime('%Y-%m-%d_%H%M%S')
        _upload_tiff(IMAGING_FOLDER_AUTO, filename, img.copy())
    except Exception as e:
        _record_error(str(e))


def _filename_for_half_hour_slot(slot: datetime) -> str:
    return slot.strftime('%Y-%m-%d_%H%M')


def _filename_for_hour_slot(slot: datetime) -> str:
    return slot.strftime('%Y-%m-%d_%H00')


def _seconds_until_next_half_hour(now: datetime) -> float:
    """Seconds until the next ET :00/:30 boundary (fires immediately if just past one)."""
    base = now.replace(microsecond=0)
    slot_min = 0 if base.minute < 30 else 30
    slot_start = base.replace(minute=slot_min, second=0, microsecond=0)
    elapsed = (base - slot_start).total_seconds()
    if 0 <= elapsed <= 90:
        return 0.5
    if base.minute < 30:
        next_boundary = base.replace(minute=30, second=0, microsecond=0)
    else:
        next_boundary = (base.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1))
    return max(0.5, (next_boundary - base).total_seconds())


def _seconds_until_next_hour(now: datetime) -> float:
    base = now.replace(microsecond=0)
    hour_start = base.replace(minute=0, second=0, microsecond=0)
    elapsed = (base - hour_start).total_seconds()
    if 0 <= elapsed <= 90:
        return 0.5
    next_boundary = hour_start + timedelta(hours=1)
    return max(0.5, (next_boundary - base).total_seconds())


def _half_hour_slot_at_trigger(now: datetime) -> datetime:
    n = now.replace(second=0, microsecond=0)
    if n.minute >= 30:
        return n.replace(minute=30)
    return n.replace(minute=0)


def _hour_slot_at_trigger(now: datetime) -> datetime:
    return now.replace(minute=0, second=0, microsecond=0)


def _latest_auto_image():
    import camera_service as cam

    with cam.frame_lock:
        frame = cam.camera_state.get('current_frame')
        if frame is None:
            return None
        return frame.copy()


def _upload_scheduled(mode: DriveMode) -> None:
    import camera_service as cam

    if not cam.auto_state.get('active'):
        return
    if not _scheduler_should_run(mode):
        return
    img = _latest_auto_image()
    if img is None:
        _record_error('No auto frame available yet')
        return
    now = _observatory_now()
    if mode == 'half_hour':
        slot = _half_hour_slot_at_trigger(now)
        folder = IMAGING_FOLDER_HALF_HOUR
        filename = _filename_for_half_hour_slot(slot)
    else:
        slot = _hour_slot_at_trigger(now)
        folder = IMAGING_FOLDER_HOUR
        filename = _filename_for_hour_slot(slot)
    try:
        _upload_tiff(folder, filename, img)
        print(f"[Imaging] {mode} slot {slot.strftime('%Y-%m-%d %H:%M')} → {filename}")
    except Exception as e:
        _record_error(str(e))


def _scheduler_should_run(expected: DriveMode) -> bool:
    with _imaging_lock:
        return _state.get('mode') == expected


def _scheduler_loop(mode: DriveMode) -> None:
    while True:
        try:
            if not _scheduler_should_run(mode):
                print(f"[Imaging] Scheduler stopped ({mode})")
                return
            now = _observatory_now()
            if mode == 'half_hour':
                wait_s = _seconds_until_next_half_hour(now)
            else:
                wait_s = _seconds_until_next_hour(now)
            end = time.time() + wait_s
            while time.time() < end:
                if not _scheduler_should_run(mode):
                    print(f"[Imaging] Scheduler stopped ({mode})")
                    return
                time.sleep(min(1.0, end - time.time()))
            _upload_scheduled(mode)
        except Exception as e:
            _record_error(f'scheduler {mode}: {e}')
            traceback.print_exc()
            time.sleep(5.0)
