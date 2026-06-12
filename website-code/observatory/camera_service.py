#!/usr/bin/env python3
"""
ASI Camera Service for Raspberry Pi (Linux)
HTTP API: camera connect/settings/mode, MJPEG stream, auto capture, sequence upload to Google Drive.

System Requirements:
- Raspberry Pi (Raspberry Pi OS / Debian-based Linux)
- USB 3.0 interface for ASI camera (USB 2.0 also works but slower)
- ASI Camera SDK for Linux
- Python 3 with Flask, NumPy, Pillow
- libusb-1.0 (via apt)
"""

from flask import Flask, Response, jsonify, send_file, request
from flask_cors import CORS
import ctypes
import numpy as np
from PIL import Image
import io
import time
import threading
import os
import platform
from datetime import datetime, timezone
import json

import auto_exposure as auto_exp
import auto_white_balance as auto_wb
import imaging_drive
import observatory_solar as obs_solar
import asc_cloud_ai

app = Flask(__name__)
CORS(
    app,
    resources={
        r"/*": {
            "origins": [
                "https://www.pomfretastro.org",
                "https://pomfretastro.org",
                "http://localhost:3000",
                "http://127.0.0.1:3000",
            ]
        }
    },
)

# Load ASI Camera library
asi_lib = None

# Detect system architecture and build library paths
def get_library_paths():
    """Detect system architecture and return appropriate SDK library paths"""
    machine = platform.machine().lower()
    base_path = os.path.dirname(os.path.abspath(__file__))
    sdk_base = os.path.join(base_path, 'ASI_linux_mac_SDK_V1.40', 'lib')
    
    paths = []
    
    # Try to detect Raspberry Pi architecture
    if 'arm' in machine or 'aarch64' in machine:
        # Check for 64-bit ARM (Raspberry Pi 3/4/5 64-bit)
        if 'aarch64' in machine or 'arm64' in machine:
            paths.append(os.path.join(sdk_base, 'armv8', 'libASICamera2.so'))
            paths.append(os.path.join(sdk_base, 'armv8', 'libASICamera2.so.1.40'))
        # Check for 32-bit ARM
        elif 'armv7' in machine or 'armv7l' in machine:
            paths.append(os.path.join(sdk_base, 'armv7', 'libASICamera2.so'))
            paths.append(os.path.join(sdk_base, 'armv7', 'libASICamera2.so.1.40'))
        # Fallback to armv6 for older Pi
        else:
            paths.append(os.path.join(sdk_base, 'armv6', 'libASICamera2.so'))
            paths.append(os.path.join(sdk_base, 'armv6', 'libASICamera2.so.1.40'))
    # x86_64 (Intel/AMD 64-bit)
    elif 'x86_64' in machine or 'amd64' in machine:
        paths.append(os.path.join(sdk_base, 'x64', 'libASICamera2.so'))
        paths.append(os.path.join(sdk_base, 'x64', 'libASICamera2.so.1.40'))
    # x86 (32-bit)
    elif 'i386' in machine or 'i686' in machine:
        paths.append(os.path.join(sdk_base, 'x86', 'libASICamera2.so'))
        paths.append(os.path.join(sdk_base, 'x86', 'libASICamera2.so.1.40'))
    
    # Also try common installation paths
    common_paths = [
        '/usr/local/lib/libASICamera2.so',
        '/usr/lib/libASICamera2.so',
        '/opt/ASI_linux_mac_SDK_V1.40/lib/armv8/libASICamera2.so',
        '/opt/ASI_linux_mac_SDK_V1.40/lib/armv7/libASICamera2.so',
        '/opt/ASI_linux_mac_SDK_V1.40/lib/armv6/libASICamera2.so',
    ]
    
    # Add common paths to the list
    paths.extend(common_paths)
    
    return paths

lib_paths = get_library_paths()

print(f"Detected architecture: {platform.machine()}")
print(f"Trying to load ASI Camera library from {len(lib_paths)} possible paths...")

for lib_path in lib_paths:
    if not os.path.exists(lib_path):
        continue
    try:
        print(f"Trying to load: {lib_path}")
        asi_lib = ctypes.CDLL(lib_path)
        print(f"Successfully loaded: {lib_path}")
        break
    except Exception as e:
        print(f"Failed to load {lib_path}: {e}")

if asi_lib is None:
    print("ERROR: Could not load ASI Camera library")
    print("Please ensure:")
    print("1. ASI Camera SDK is installed")
    print("2. Library path is correct in camera_service.py")
    print("3. udev rules are installed: sudo cp ASI_linux_mac_SDK_V1.40/lib/asi.rules /etc/udev/rules.d/")
    print("4. Camera is connected and udev rules are reloaded: sudo udevadm control --reload-rules")

# ctypes layout for ASIGetControlCaps (must match ASICamera2.h)
class ASI_CONTROL_CAPS(ctypes.Structure):
    _fields_ = [
        ("Name", ctypes.c_char * 64),
        ("Description", ctypes.c_char * 128),
        ("MaxValue", ctypes.c_long),
        ("MinValue", ctypes.c_long),
        ("DefaultValue", ctypes.c_long),
        ("IsAutoSupported", ctypes.c_int),
        ("IsWritable", ctypes.c_int),
        ("ControlType", ctypes.c_int),
        ("Unused", ctypes.c_char * 32),
    ]


def _configure_asi_lib_ctypes():
    """Set argtypes/restype for SDK calls used via ctypes (avoids segfaults)."""
    if asi_lib is None:
        return
    asi_lib.ASIGetNumOfControls.argtypes = [ctypes.c_int, ctypes.POINTER(ctypes.c_int)]
    asi_lib.ASIGetNumOfControls.restype = ctypes.c_int
    asi_lib.ASIGetControlCaps.argtypes = [
        ctypes.c_int,
        ctypes.c_int,
        ctypes.POINTER(ASI_CONTROL_CAPS),
    ]
    asi_lib.ASIGetControlCaps.restype = ctypes.c_int


_configure_asi_lib_ctypes()

# ASI Camera constants (from ASICamera2.h)
ASI_SUCCESS = 0
ASI_FALSE = 0
ASI_TRUE = 1

# Image types
ASI_IMG_RAW8 = 0
ASI_IMG_RGB24 = 1
ASI_IMG_RAW16 = 2
ASI_IMG_Y8 = 3

# Error codes
ASI_ERROR_TIMEOUT = 11

# Control types (IMPORTANT: Order from header file)
ASI_GAIN = 0
ASI_EXPOSURE = 1
ASI_GAMMA = 2
ASI_WB_R = 3
ASI_WB_B = 4
ASI_BANDWIDTHOVERLOAD = 6

# Camera state
camera_state = {
    'connected': False,
    'streaming': False,
    'camera_id': -1,
    'width': 1280,
    'height': 960,
    'exposure': 1000000,  # microseconds - for photo capture only
    'exposure_min_us': auto_exp.PHOTO_EXP_MIN_US,
    'exposure_max_us': auto_exp.PHOTO_EXP_MAX_US,
    'video_exposure': 100000,  # microseconds - max exposure for video streaming (controls frame rate)
    'gain': 50,
    'gain_min': 0,
    'gain_max': 500,  # ASI662MC default; updated from SDK on connect
    'gamma': 50,  # Gamma (default, range 1-100, recommended 50 for linear output)
    'wb_r': 50,  # White balance red channel (default, range 0-100)
    'wb_b': 50,  # White balance blue channel (default, range 0-100)
    'wb_auto': False,  # Always manual WB from admin UI (wb_r / wb_b)
    'image_format': ASI_IMG_RGB24,  # Default to RGB24
    'current_frame': None,
    'error': None,
    # Wall time of last successful video frame (UTC ISO), for web UI "last updated" polling
    'stream_last_frame_iso': None,
    # off | stream | auto — auto runs on the Pi even when no browser is connected
    'mode': 'off',
    'last_auto_frame_iso': None,
}

# Sequence capture state (uploads to Google Drive — no local files)
sequence_state = {
    'active': False,
    'drive_folder_id': None,
    'drive_folder_name': None,
    'total_count': 0,
    'current_count': 0,
    'file_format': 'JPEG',  # JPEG, PNG, or TIFF
    'interval': 0,  # Interval between photos in seconds (0 = fast mode, >0 = time-lapse mode)
    'last_error': None,
    'thread': None,
}

# Server-side auto mode (periodic photo capture for Weather / public view)
AUTO_DEFAULT_INTERVAL_S = 60
AUTO_LIKE_MODES = frozenset({'auto', 'half_hour', 'hour'})
VALID_CAMERA_MODES = frozenset({'off', 'stream', 'auto', 'half_hour', 'hour'})
auto_state = {
    'active': False,
    'interval': AUTO_DEFAULT_INTERVAL_S,
    'thread': None,
    'wake': threading.Event(),  # settings change → capture now + restart interval
    'last_brightness_mean': None,
    'last_mean_r': None,
    'last_mean_g': None,
    'last_mean_b': None,
    'last_auto_exp_action': None,
    'last_auto_wb_action': None,
    'last_exp_delta_us': 0,
    'last_wb_r_delta': 0,
    'last_wb_b_delta': 0,
    'last_auto_daytime': None,
    'last_auto_target_gain': None,
}
auto_capture_lock = threading.Lock()
frame_lock = threading.Lock()
MODE_PERSIST_FILE = os.path.expanduser('~/.allsky_camera_mode.json')


def _persist_mode(mode, interval=None):
    try:
        payload = {'mode': mode}
        if interval is not None:
            payload['interval'] = interval
        with open(MODE_PERSIST_FILE, 'w') as f:
            json.dump(payload, f)
    except OSError as e:
        print(f"[Mode] Could not persist mode: {e}")


def _load_persisted_mode():
    try:
        if os.path.isfile(MODE_PERSIST_FILE):
            with open(MODE_PERSIST_FILE, 'r') as f:
                data = json.load(f)
            mode = data.get('mode', 'off')
            interval = int(data.get('interval', AUTO_DEFAULT_INTERVAL_S))
            if mode in VALID_CAMERA_MODES:
                return mode, max(10, interval)
    except (OSError, json.JSONDecodeError, TypeError, ValueError) as e:
        print(f"[Mode] Could not load persisted mode: {e}")
    return 'off', AUTO_DEFAULT_INTERVAL_S


def _apply_manual_white_balance():
    """Apply manual WB_R / WB_B from camera_state (color cameras only)."""
    camera_state['wb_auto'] = False
    if not camera.is_open or not camera.is_color_cam or asi_lib is None:
        return
    wb_r = int(camera_state.get('wb_r', 50))
    wb_b = int(camera_state.get('wb_b', 50))
    asi_lib.ASISetControlValue(camera.camera_id, ASI_WB_R, wb_r, ASI_FALSE)
    asi_lib.ASISetControlValue(camera.camera_id, ASI_WB_B, wb_b, ASI_FALSE)


def _request_auto_cycle_restart():
    """Settings changed in auto mode: capture immediately, then start a fresh interval."""
    auto_state['wake'].set()


def _wait_auto_interval():
    """Wait until interval elapses or settings request an immediate capture."""
    interval = auto_state.get('interval', AUTO_DEFAULT_INTERVAL_S)
    deadline = time.monotonic() + interval
    while auto_state['active'] and camera_state['connected']:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return
        if auto_state['wake'].wait(timeout=min(1.0, remaining)):
            auto_state['wake'].clear()
            print("[Auto] Interval restarted after settings change")
            return


def _apply_auto_mode_scheduled_gain(now=None):
    """Auto mode only: scheduled gain by solar phase (0 / 80 / 150)."""
    if not auto_state['active']:
        return
    if now is None:
        now = datetime.now(timezone.utc)
    daytime = obs_solar.is_auto_mode_daytime(now)
    target = obs_solar.auto_mode_target_gain(now)
    auto_state['last_auto_daytime'] = daytime
    auto_state['last_auto_target_gain'] = target
    if camera_state['gain'] != target:
        prev = camera_state['gain']
        camera_state['gain'] = target
        print(f"[AutoGain] gain {prev} → {target}")


def _apply_auto_exposure_from_frame(img):
    """After auto capture: auto WB + exposure from frame stats (no HTTP, no wake)."""
    if img is None or not auto_state['active']:
        return
    _apply_auto_mode_scheduled_gain()
    target_gain = obs_solar.auto_mode_target_gain()
    camera_state['gain'] = target_gain

    stats = auto_exp.compute_brightness_mean(img)
    mean_rgb = stats['mean_rgb']
    auto_state['last_brightness_mean'] = mean_rgb
    auto_state['last_mean_r'] = stats['mean_r']
    auto_state['last_mean_g'] = stats['mean_g']
    auto_state['last_mean_b'] = stats['mean_b']

    exp_before_us = int(camera_state['exposure'])
    wb_r_before = int(camera_state.get('wb_r', auto_wb.AUTO_WB_R_START))
    wb_b_before = int(camera_state.get('wb_b', auto_wb.AUTO_WB_B_START))

    wb_adj = auto_wb.decide_auto_white_balance_adjustment(
        mean_r=stats['mean_r'],
        mean_g=stats['mean_g'],
        mean_b=stats['mean_b'],
        wb_r=camera_state.get('wb_r', auto_wb.AUTO_WB_R_START),
        wb_b=camera_state.get('wb_b', auto_wb.AUTO_WB_B_START),
        clip_white_pct=stats['clip_white_pct'],
        valid_pixel_frac=stats.get('valid_pixel_frac', 1.0),
    )
    if wb_adj is None:
        auto_state['last_auto_wb_action'] = 'hold'
        print(
            f"[AutoWB] hold R={stats['mean_r']:.1f} G={stats['mean_g']:.1f} B={stats['mean_b']:.1f} "
            f"wb_r={camera_state.get('wb_r')} wb_b={camera_state.get('wb_b')}"
        )
    else:
        camera_state['wb_r'] = wb_adj['wb_r']
        camera_state['wb_b'] = wb_adj['wb_b']
        _apply_manual_white_balance()
        auto_state['last_auto_wb_action'] = wb_adj['action']
        print(
            f"[AutoWB] {wb_adj['action']}: {wb_adj['reason']} → "
            f"wb_r={wb_adj['wb_r']} wb_b={wb_adj['wb_b']}"
        )

    adjustment = auto_exp.decide_auto_exposure_adjustment(
        mean_rgb=mean_rgb,
        clip_white_pct=stats['clip_white_pct'],
        exposure_us=camera_state['exposure'],
        gain=target_gain,
        gain_min=target_gain,
        gain_max=target_gain,
        exposure_min_us=camera_state.get('exposure_min_us', auto_exp.PHOTO_EXP_MIN_US),
        exposure_max_us=camera_state.get('exposure_max_us', auto_exp.PHOTO_EXP_MAX_US),
    )
    if adjustment is None:
        auto_state['last_auto_exp_action'] = 'hold'
        print(
            f"[AutoExp] hold mean={mean_rgb:.1f} "
            f"exp={camera_state['exposure']/1e6:.4f}s gain={camera_state['gain']}"
        )
    else:
        camera_state['exposure'] = adjustment['exposure_us']
        camera_state['gain'] = target_gain
        auto_state['last_auto_exp_action'] = adjustment['action']
        print(
            f"[AutoExp] {adjustment['action']}: {adjustment['reason']} → "
            f"exp={adjustment['exposure_us']/1e6:.4f}s gain={adjustment['gain']}"
        )

    auto_state['last_exp_delta_us'] = int(camera_state['exposure']) - exp_before_us
    auto_state['last_wb_r_delta'] = int(camera_state.get('wb_r', wb_r_before)) - wb_r_before
    auto_state['last_wb_b_delta'] = int(camera_state.get('wb_b', wb_b_before)) - wb_b_before


def _capture_photo_to_memory():
    """Capture a still (photo exposure) and store in camera_state['current_frame']. Returns PIL Image or None."""
    if not camera_state['connected'] or not camera.is_open:
        return None
    if sequence_state['active']:
        print("[Auto] Skipping capture — sequence active")
        return None

    with auto_capture_lock:
        was_streaming = camera.streaming
        try:
            if was_streaming:
                camera.stop_stream()
                time.sleep(0.5)

            photo_format = camera_state['image_format']
            width = camera_state['width']
            height = camera_state['height']
            format_applied = False

            # Public auto frames are always RGB24 (RAW stills look green without demosaic).
            if photo_format != ASI_IMG_RGB24:
                asi_lib.ASISetROIFormat(camera.camera_id, width, height, 1, ASI_IMG_RGB24)
                time.sleep(0.2)
                format_applied = photo_format != ASI_IMG_RGB24

            # Hardware is RGB24; capture_snapshot must decode RGB24 (not stale image_format).
            camera_state['_snapshot_as_rgb24'] = True
            try:
                img = camera.capture_snapshot()
            finally:
                camera_state['_snapshot_as_rgb24'] = False
            if format_applied:
                asi_lib.ASISetROIFormat(camera.camera_id, width, height, 1, ASI_IMG_RGB24)
                time.sleep(0.2)

            if img:
                with frame_lock:
                    camera_state['current_frame'] = img
                    camera_state['last_auto_frame_iso'] = datetime.now(timezone.utc).isoformat()
                print(f"[Auto] Frame captured at {camera_state['last_auto_frame_iso']}")
                return img
            return None
        except Exception as e:
            print(f"[Auto] Capture error: {e}")
            import traceback
            traceback.print_exc()
            return None
        finally:
            if was_streaming and camera_state.get('mode') != 'auto':
                try:
                    camera.start_stream()
                except Exception:
                    pass


def auto_capture_loop():
    """Background thread: capture, wait interval, repeat; wake resets wait after settings."""
    print("[Auto] Loop started")
    while auto_state['active'] and camera_state['connected']:
        _apply_auto_mode_scheduled_gain()
        img = _capture_photo_to_memory()
        if img is not None:
            _apply_auto_exposure_from_frame(img)
            if camera_state.get('mode') in AUTO_LIKE_MODES:
                asc_cloud_ai.analyze_and_store(img)
            imaging_drive.after_auto_capture(img, camera_state.get('mode', 'off'))
        if not auto_state['active']:
            break
        _wait_auto_interval()
    print("[Auto] Loop stopped")


def stop_auto_mode():
    """Stop server-side auto capture."""
    auto_state['active'] = False
    auto_state['wake'].set()
    if auto_state.get('thread') and auto_state['thread'].is_alive():
        auto_state['thread'].join(timeout=5.0)
    auto_state['thread'] = None
    auto_state['wake'].clear()
    if camera_state.get('mode') in AUTO_LIKE_MODES:
        camera_state['mode'] = 'off'
    imaging_drive.sync_from_camera_mode('off')


def start_auto_mode(interval=None, drive_mode='auto'):
    """Start server-side auto capture (stops video stream). drive_mode: auto, half_hour, or hour."""
    drive_mode = (drive_mode or 'auto').lower()
    if drive_mode not in AUTO_LIKE_MODES:
        drive_mode = 'auto'
    if interval is not None:
        auto_state['interval'] = max(10, int(interval))
    if camera.streaming:
        camera.stop_stream()
        time.sleep(0.3)
    stop_auto_mode()
    auto_state['active'] = True
    auto_state['wake'].clear()
    camera_state['mode'] = drive_mode
    camera_state['streaming'] = False
    camera_state['stream_last_frame_iso'] = None
    _persist_mode(drive_mode, auto_state['interval'])
    imaging_drive.sync_from_camera_mode(drive_mode)
    camera_state['exposure'] = obs_solar.AUTO_MODE_START_EXPOSURE_US
    camera_state['wb_r'] = auto_wb.AUTO_WB_R_START
    camera_state['wb_b'] = auto_wb.AUTO_WB_B_START
    auto_exp.reset_auto_exposure()
    print(f"[Auto] Start exposure reset to {camera_state['exposure'] / 1e6:.3f} s")
    print(f"[Auto] Start white balance wb_r={camera_state['wb_r']} wb_b={camera_state['wb_b']}")
    _apply_manual_white_balance()
    _apply_auto_mode_scheduled_gain()
    auto_state['thread'] = threading.Thread(target=auto_capture_loop, daemon=True)
    auto_state['thread'].start()
    return True


def apply_camera_mode(mode, interval=None):
    """Set operating mode: off, stream, auto, half_hour, or hour."""
    mode = (mode or 'off').lower().replace('-', '_')
    if mode not in VALID_CAMERA_MODES:
        return False, f'Invalid mode: {mode}'

    if mode in AUTO_LIKE_MODES:
        if not camera_state['connected'] or not camera.is_open:
            return False, 'Camera not connected'
        start_auto_mode(interval, drive_mode=mode)
        labels = {
            'auto': 'Auto (every frame → Drive)',
            'half_hour': 'Half Hour (auto capture, save on :00/:30 ET)',
            'hour': 'Hour (auto capture, save each hour ET)',
        }
        return True, f'{labels.get(mode, mode)} started'

    stop_auto_mode()
    if mode == 'stream':
        if not camera_state['connected'] or not camera.is_open:
            return False, 'Camera not connected'
        if camera.start_stream():
            camera_state['mode'] = 'stream'
            _persist_mode('stream')
            return True, 'Stream started'
        return False, camera_state.get('error') or 'Failed to start stream'

    camera.stop_stream()
    camera_state['mode'] = 'off'
    _persist_mode('off')
    return True, 'Camera idle'


class ASICamera:
    def __init__(self):
        self.camera_id = -1
        self.is_open = False
        self.streaming = False
        self.frame_buffer = None
        self.capture_thread = None
        self.is_color_cam = False  # Store whether camera is color camera
        
    def connect(self):
        """Connect to the first available ASI camera"""
        if asi_lib is None:
            camera_state['error'] = "ASI library not loaded"
            return False
            
        try:
            # Get number of connected cameras
            num_cameras = asi_lib.ASIGetNumOfConnectedCameras()
            print(f"Found {num_cameras} camera(s)")
            
            if num_cameras == 0:
                camera_state['error'] = "No cameras found"
                return False
            
            # Get camera info
            class ASI_CAMERA_INFO(ctypes.Structure):
                _fields_ = [
                    ("Name", ctypes.c_char * 64),
                    ("CameraID", ctypes.c_int),
                    ("MaxHeight", ctypes.c_long),
                    ("MaxWidth", ctypes.c_long),
                    ("IsColorCam", ctypes.c_int),
                    ("BayerPattern", ctypes.c_int),
                    ("SupportedBins", ctypes.c_int * 16),
                    ("SupportedVideoFormat", ctypes.c_int * 8),
                    ("PixelSize", ctypes.c_double),
                    ("MechanicalShutter", ctypes.c_int),
                    ("ST4Port", ctypes.c_int),
                    ("IsCoolerCam", ctypes.c_int),
                    ("IsUSB3Host", ctypes.c_int),
                    ("IsUSB3Camera", ctypes.c_int),
                    ("ElecPerADU", ctypes.c_float),
                    ("BitDepth", ctypes.c_int),
                    ("IsTriggerCam", ctypes.c_int),
                ]
            
            camera_info = ASI_CAMERA_INFO()
            result = asi_lib.ASIGetCameraProperty(ctypes.byref(camera_info), 0)
            
            if result != ASI_SUCCESS:
                camera_state['error'] = f"Failed to get camera properties: {result}"
                return False
            
            self.camera_id = camera_info.CameraID
            self.is_color_cam = bool(camera_info.IsColorCam)  # Store color camera status
            camera_state['camera_id'] = self.camera_id
            camera_state['width'] = camera_info.MaxWidth
            camera_state['height'] = camera_info.MaxHeight
            
            print(f"Camera: {camera_info.Name.decode('utf-8')}")
            print(f"Resolution: {camera_info.MaxWidth} x {camera_info.MaxHeight}")
            print(f"Color: {'Yes' if camera_info.IsColorCam else 'No'}")
            
            # Open camera
            result = asi_lib.ASIOpenCamera(self.camera_id)
            if result != ASI_SUCCESS:
                camera_state['error'] = f"Failed to open camera: {result}"
                return False
            
            # Initialize camera
            result = asi_lib.ASIInitCamera(self.camera_id)
            if result != ASI_SUCCESS:
                camera_state['error'] = f"Failed to initialize camera: {result}"
                asi_lib.ASICloseCamera(self.camera_id)
                return False
            
            self.is_open = True

            gain_range = _get_control_range(self.camera_id, ASI_GAIN)
            if gain_range:
                camera_state['gain_min'], camera_state['gain_max'] = gain_range
                print(f"Gain range: {gain_range[0]} – {gain_range[1]}")

            exp_range = _get_control_range(self.camera_id, ASI_EXPOSURE)
            if exp_range:
                camera_state['exposure_min_us'] = max(auto_exp.PHOTO_EXP_MIN_US, int(exp_range[0]))
                camera_state['exposure_max_us'] = min(auto_exp.PHOTO_EXP_MAX_US, int(exp_range[1]))
                print(
                    f"Exposure range: {camera_state['exposure_min_us']} – "
                    f"{camera_state['exposure_max_us']} μs"
                )
            
            # Set ROI format (full frame, use current format setting)
            result = asi_lib.ASISetROIFormat(
                self.camera_id,
                camera_info.MaxWidth,
                camera_info.MaxHeight,
                1,  # bin
                camera_state['image_format']
            )
            
            if result != ASI_SUCCESS:
                print(f"Warning: Failed to set ROI format: {result}")
            
            # Disable auto gain and auto exposure first (they might lock the values)
            asi_lib.ASISetControlValue(self.camera_id, ASI_GAIN, 0, ASI_TRUE)  # Turn OFF auto gain
            asi_lib.ASISetControlValue(self.camera_id, ASI_EXPOSURE, 0, ASI_TRUE)  # Turn OFF auto exposure
            time.sleep(0.1)
            
            # Set bandwidth
            asi_lib.ASISetControlValue(self.camera_id, ASI_BANDWIDTHOVERLOAD, 40, ASI_FALSE)
            
            # Set initial gain
            result_gain = asi_lib.ASISetControlValue(self.camera_id, ASI_GAIN, camera_state['gain'], ASI_FALSE)
            
            # Set initial gamma
            result_gamma = asi_lib.ASISetControlValue(self.camera_id, ASI_GAMMA, camera_state['gamma'], ASI_FALSE)
            
            if camera_info.IsColorCam:
                result_wb_r = asi_lib.ASISetControlValue(
                    self.camera_id, ASI_WB_R, camera_state['wb_r'], ASI_FALSE
                )
                result_wb_b = asi_lib.ASISetControlValue(
                    self.camera_id, ASI_WB_B, camera_state['wb_b'], ASI_FALSE
                )
            else:
                result_wb_r = None
                result_wb_b = None
            
            # Verify settings
            actual_gain = ctypes.c_long(0)
            auto_gain = ctypes.c_int(0)
            asi_lib.ASIGetControlValue(self.camera_id, ASI_GAIN, ctypes.byref(actual_gain), ctypes.byref(auto_gain))
            
            print(f"Initial settings:")
            print(f"  Gain: {camera_state['gain']} → actual: {actual_gain.value} (result: {result_gain})")
            print(f"  Gamma: {camera_state['gamma']} (result: {result_gamma})")
            print(f"  Exposure (for photo): {camera_state['exposure']} μs ({camera_state['exposure']/1000000:.3f} s)")
            if camera_info.IsColorCam:
                print(
                    f"  White Balance R: {camera_state['wb_r']} (result: {result_wb_r}), "
                    f"B: {camera_state['wb_b']} (result: {result_wb_b})"
                )
            
            camera_state['connected'] = True
            camera_state['error'] = None
            return True
            
        except Exception as e:
            camera_state['error'] = str(e)
            print(f"Error connecting to camera: {e}")
            return False
    
    def disconnect(self):
        """Disconnect from camera"""
        stop_auto_mode()
        self.stop_stream()
        if self.is_open and self.camera_id >= 0:
            asi_lib.ASICloseCamera(self.camera_id)
            self.is_open = False
        camera_state['connected'] = False
        camera_state['streaming'] = False
        camera_state['stream_last_frame_iso'] = None
        camera_state['mode'] = 'off'
        camera_state['last_auto_frame_iso'] = None

    def start_stream(self):
        """Start video streaming"""
        if not self.is_open:
            return False

        stop_auto_mode()

        # Enable auto exposure for video mode, but limit max exposure time
        # This allows the camera to adjust exposure automatically while respecting the max limit
        video_exposure = camera_state['video_exposure']  # microseconds
        gain = camera_state['gain']
        
        # Set gain first (must be set before starting video capture)
        result_gain = asi_lib.ASISetControlValue(self.camera_id, ASI_GAIN, gain, ASI_FALSE)
        
        # Set gamma
        gamma = camera_state.get('gamma', 50)
        result_gamma = asi_lib.ASISetControlValue(self.camera_id, ASI_GAMMA, gamma, ASI_FALSE)
        
        if self.is_color_cam:
            wb_r = camera_state.get('wb_r', 50)
            wb_b = camera_state.get('wb_b', 50)
            result_wb_r = asi_lib.ASISetControlValue(self.camera_id, ASI_WB_R, wb_r, ASI_FALSE)
            result_wb_b = asi_lib.ASISetControlValue(self.camera_id, ASI_WB_B, wb_b, ASI_FALSE)
        else:
            result_wb_r = None
            result_wb_b = None
        
        # Set manual exposure for video mode (we're in manual mode, so ASI_AUTO_MAX_EXP is not needed)
        result_manual = asi_lib.ASISetControlValue(self.camera_id, ASI_EXPOSURE, video_exposure, ASI_FALSE)
        
        # Try auto exposure for video mode (may not work well with gain on Linux)
        # Commented out for now - using manual exposure instead
        # result_auto = asi_lib.ASISetControlValue(self.camera_id, ASI_EXPOSURE, 0, ASI_TRUE)
        
        # Verify gain was set
        actual_gain = ctypes.c_long(0)
        auto_gain = ctypes.c_int(0)
        asi_lib.ASIGetControlValue(self.camera_id, ASI_GAIN, ctypes.byref(actual_gain), ctypes.byref(auto_gain))
        
        # Verify exposure was set
        actual_exp = ctypes.c_long(0)
        auto_exp = ctypes.c_int(0)
        asi_lib.ASIGetControlValue(self.camera_id, ASI_EXPOSURE, ctypes.byref(actual_exp), ctypes.byref(auto_exp))
        
        print(f"[start_stream] Set gain to {gain} (result: {result_gain}, actual: {actual_gain.value})")
        print(f"[start_stream] Set gamma to {gamma} (result: {result_gamma})")
        if self.is_color_cam:
            wb_r = camera_state.get('wb_r', 50)
            wb_b = camera_state.get('wb_b', 50)
            print(
                f"[start_stream] Manual white balance R: {wb_r} (result: {result_wb_r}), "
                f"B: {wb_b} (result: {result_wb_b})"
            )
        print(f"[start_stream] Set video exposure to {video_exposure} μs ({video_exposure/1000:.1f} ms)")
        print(f"[start_stream] Manual exposure result: {result_manual}, actual: {actual_exp.value} μs, auto: {auto_exp.value}")
        
        print(f"[start_stream] Starting video capture")
        
        # A leftover still exposure (e.g. a long auto-mode frame that outlived
        # stop_auto_mode's 5s join) makes ASIStartVideoCapture fail with
        # 15 (ASI_ERROR_EXPOSURE_IN_PROGRESS); cancel it first.
        exp_status = ctypes.c_int(0)
        asi_lib.ASIGetExpStatus(self.camera_id, ctypes.byref(exp_status))
        if exp_status.value != 0:
            print(f"[start_stream] Still exposure in progress (status {exp_status.value}); stopping it")
            asi_lib.ASIStopExposure(self.camera_id)
            time.sleep(0.5)
        
        result = asi_lib.ASIStartVideoCapture(self.camera_id)
        if result == 15:  # ASI_ERROR_EXPOSURE_IN_PROGRESS — cancel and retry once
            print("[start_stream] Video capture blocked by in-progress exposure; retrying after stop")
            asi_lib.ASIStopExposure(self.camera_id)
            time.sleep(0.5)
            result = asi_lib.ASIStartVideoCapture(self.camera_id)
        if result != ASI_SUCCESS:
            camera_state['error'] = f"Failed to start video capture: {result}"
            return False
        
        # Stream is running; drop any stale fault from earlier failed attempts.
        camera_state['error'] = None
        self.streaming = True
        camera_state['streaming'] = True
        camera_state['stream_last_frame_iso'] = None
        
        # Start capture thread
        self.capture_thread = threading.Thread(target=self._capture_loop, daemon=True)
        self.capture_thread.start()
        
        return True
    
    def stop_stream(self):
        """Stop video streaming - simplified like asicap, just call SDK"""
        self.streaming = False
        camera_state['streaming'] = False
        camera_state['stream_last_frame_iso'] = None
        
        if self.capture_thread:
            self.capture_thread.join(timeout=2.0)
        
        if self.is_open and self.camera_id >= 0:
            print("[stop_stream] Stopping video capture...")
            result = asi_lib.ASIStopVideoCapture(self.camera_id)
            if result != ASI_SUCCESS:
                print(f"[stop_stream] ASIStopVideoCapture returned: {result}")
            else:
                print("[stop_stream] Video capture stopped successfully")
    
    def _capture_loop(self):
        """Continuous capture loop for streaming"""
        width = camera_state['width']
        height = camera_state['height']
        buffer_size = width * height * 3  # RGB24
        buffer = (ctypes.c_ubyte * buffer_size)()
        consecutive_errors = 0
        
        while self.streaming and self.is_open:
            # Calculate timeout based on video exposure time
            # SDK recommends: exposure*2+500ms. Block in short slices so other SDK
            # calls (status/settings control reads) are not starved while a
            # multi-second exposure accumulates.
            video_exposure_ms = camera_state['video_exposure'] / 1000.0  # Convert to ms
            timeout_ms = int(video_exposure_ms * 2 + 500)
            timeout_ms = max(100, min(timeout_ms, 2000))
            
            drop_frames = ctypes.c_int(0)
            result = asi_lib.ASIGetVideoData(
                self.camera_id,
                ctypes.byref(buffer),
                buffer_size,
                timeout_ms,
                ctypes.byref(drop_frames)
            )
            
            if result == ASI_SUCCESS:
                consecutive_errors = 0  # Reset error counter
                # Convert to numpy array — ASI SDK "RGB24" is actually BGR byte order
                img_array = np.frombuffer(buffer, dtype=np.uint8)
                img_array = img_array.reshape((height, width, 3))
                img_array = img_array[:, :, ::-1]  # BGR -> RGB
                
                # Convert to PIL Image
                img = Image.fromarray(img_array, mode='RGB')
                self.frame_buffer = img
                camera_state['current_frame'] = img
                camera_state['stream_last_frame_iso'] = datetime.now(timezone.utc).isoformat()
            elif result != ASI_ERROR_TIMEOUT:  # timeout is normal while an exposure accumulates
                consecutive_errors += 1
                # Only print error if it persists
                if consecutive_errors == 1 or consecutive_errors % 10 == 0:
                    print(f"Error getting video data: {result} (consecutive: {consecutive_errors})")
            
            # Pace polling: tight for video-rate exposures, relaxed for long ones so
            # HTTP handlers can use the SDK between our blocking reads.
            time.sleep(0.001 if video_exposure_ms <= 2000 else 0.25)
    
    def capture_snapshot(self):
        """Capture a single snapshot"""
        if not self.is_open:
            print("[capture_snapshot] Camera not open")
            return None
        
        # Ensure video capture is stopped (if it was running)
        if self.streaming:
            print("[capture_snapshot] Warning: Camera is streaming, stopping...")
            self.stop_stream()
            time.sleep(0.5)
        
        # Simplified approach like asicap: just stop video if needed, then start exposure
        # Don't wait for IDLE state - let SDK handle it
        
        # If streaming, stop it first
        if self.streaming:
            print("[capture_snapshot] Stopping stream before snapshot...")
            self.stop_stream()
            time.sleep(0.1)  # Brief pause for SDK to process
        
        # Set exposure, gain, gamma, and white balance for still capture
        exposure = camera_state['exposure']
        gain_val = camera_state['gain']
        gamma = camera_state.get('gamma', 50)

        asi_lib.ASISetControlValue(self.camera_id, ASI_EXPOSURE, exposure, ASI_FALSE)
        asi_lib.ASISetControlValue(self.camera_id, ASI_GAIN, gain_val, ASI_FALSE)
        asi_lib.ASISetControlValue(self.camera_id, ASI_GAMMA, gamma, ASI_FALSE)

        if self.is_color_cam:
            wb_r = camera_state.get('wb_r', 50)
            wb_b = camera_state.get('wb_b', 50)
            asi_lib.ASISetControlValue(self.camera_id, ASI_WB_R, wb_r, ASI_FALSE)
            asi_lib.ASISetControlValue(self.camera_id, ASI_WB_B, wb_b, ASI_FALSE)

        print(
            f"[capture_snapshot] Starting exposure: {exposure} μs, gain: {gain_val}, gamma: {gamma}"
        )
        
        # Start exposure - SDK will return error if video mode is still active
        result = asi_lib.ASIStartExposure(self.camera_id, 0)  # 0 = not dark frame
        
        if result != ASI_SUCCESS:
            error_names = {
                14: "ASI_ERROR_VIDEO_MODE_ACTIVE",
                15: "ASI_ERROR_EXPOSURE_IN_PROGRESS",
            }
            error_name = error_names.get(result, f"ERROR_{result}")
            print(f"[capture_snapshot] Failed to start exposure: {result} ({error_name})")
            # If video mode is still active, try stopping again
            if result == 14:  # ASI_ERROR_VIDEO_MODE_ACTIVE
                print("[capture_snapshot] Video mode still active, stopping again...")
                asi_lib.ASIStopVideoCapture(self.camera_id)
                time.sleep(0.2)
                result = asi_lib.ASIStartExposure(self.camera_id, 0)
                if result != ASI_SUCCESS:
                    print(f"[capture_snapshot] Still failed after retry: {result}")
                    return None
            else:
                return None
        
        # Wait for exposure to complete
        exp_status_names = {
            0: "ASI_EXP_IDLE",
            1: "ASI_EXP_WORKING",
            2: "ASI_EXP_SUCCESS",
            3: "ASI_EXP_FAILED",
        }
        status = ctypes.c_int(0)
        timeout = 0
        max_timeout = (exposure // 1000) + 5000  # ms

        while timeout < max_timeout:
            asi_lib.ASIGetExpStatus(self.camera_id, ctypes.byref(status))
            if status.value == 2:  # ASI_EXP_SUCCESS
                break
            if status.value == 3:  # ASI_EXP_FAILED - don't wait, fail immediately
                status_name = exp_status_names.get(status.value, f"UNKNOWN_{status.value}")
                print(f"[capture_snapshot] Exposure failed with status: {status.value} ({status_name}) at timeout: {timeout}ms")
                return None
            time.sleep(0.1)
            timeout += 100

        if status.value != 2:
            status_name = exp_status_names.get(status.value, f"UNKNOWN_{status.value}")
            print(f"[capture_snapshot] Exposure failed with status: {status.value} ({status_name}) after {timeout}ms")
            return None
        
        # Get image data based on format
        width = camera_state['width']
        height = camera_state['height']
        img_format = (
            ASI_IMG_RGB24
            if camera_state.get('_snapshot_as_rgb24')
            else camera_state['image_format']
        )

        # Calculate buffer size based on format
        if img_format == ASI_IMG_RGB24:
            buffer_size = width * height * 3
            buffer = (ctypes.c_ubyte * buffer_size)()
        elif img_format == ASI_IMG_RAW8 or img_format == ASI_IMG_Y8:
            buffer_size = width * height
            buffer = (ctypes.c_ubyte * buffer_size)()
        elif img_format == ASI_IMG_RAW16:
            buffer_size = width * height * 2
            buffer = (ctypes.c_ubyte * buffer_size)()  # Use byte buffer, will convert to uint16 later
        else:
            print(f"[capture_snapshot] Unsupported image format: {img_format}")
            return None

        result = asi_lib.ASIGetDataAfterExp(self.camera_id, ctypes.byref(buffer), buffer_size)
        
        if result != ASI_SUCCESS:
            error_names = {
                1: "ASI_ERROR_INVALID_INDEX",
                2: "ASI_ERROR_INVALID_ID", 
                3: "ASI_ERROR_INVALID_CONTROL_TYPE",
                4: "ASI_ERROR_CAMERA_CLOSED",
                5: "ASI_ERROR_CAMERA_REMOVED",
                11: "ASI_ERROR_TIMEOUT",
                13: "ASI_ERROR_BUFFER_TOO_SMALL",
                16: "ASI_ERROR_GENERAL_ERROR"
            }
            error_name = error_names.get(result, f"UNKNOWN_ERROR_{result}")
            print(f"[capture_snapshot] Failed to get image data: {result} ({error_name})")
            print(f"[capture_snapshot] Buffer size requested: {buffer_size}, format: {img_format}, width: {width}, height: {height}")
            # Check exposure status
            status_check = ctypes.c_int(0)
            asi_lib.ASIGetExpStatus(self.camera_id, ctypes.byref(status_check))
            status_names = {0: "ASI_EXP_IDLE", 1: "ASI_EXP_WORKING", 2: "ASI_EXP_SUCCESS", 3: "ASI_EXP_FAILED"}
            status_name = status_names.get(status_check.value, f"UNKNOWN_{status_check.value}")
            print(f"[capture_snapshot] Exposure status when getting data: {status_check.value} ({status_name})")
            return None

        # Convert to PIL Image based on format
        if img_format == ASI_IMG_RGB24:
            img_array = np.frombuffer(buffer, dtype=np.uint8)
            img_array = img_array.reshape((height, width, 3))
            img_array = img_array[:, :, ::-1]  # BGR -> RGB
            img = Image.fromarray(img_array, 'RGB')
        elif img_format == ASI_IMG_Y8:
            img_array = np.frombuffer(buffer, dtype=np.uint8)
            img_array = img_array.reshape((height, width))
            img = Image.fromarray(img_array, 'L')  # Grayscale
        elif img_format == ASI_IMG_RAW8:
            # RAW8: Simple debayering (Bayer pattern to RGB)
            # For now, convert to grayscale for display, but save as RAW data
            img_array = np.frombuffer(buffer, dtype=np.uint8)
            img_array = img_array.reshape((height, width))
            # Simple debayering: treat as grayscale for now
            # TODO: Implement proper Bayer demosaicing
            img = Image.fromarray(img_array, 'L')
        elif img_format == ASI_IMG_RAW16:
            # RAW16: Convert byte buffer to uint16 array (little-endian)
            img_array = np.frombuffer(buffer, dtype=np.uint8)
            # Reshape to pairs and convert to uint16
            img_array_pairs = img_array.reshape((height * width, 2))
            img_array_16bit = img_array_pairs[:, 0].astype(np.uint16) | (img_array_pairs[:, 1].astype(np.uint16) << 8)
            img_array_16bit = img_array_16bit.reshape((height, width))
            # Scale to 8-bit for display (use upper 8 bits)
            img_array_8bit = (img_array_16bit >> 8).astype(np.uint8)
            img = Image.fromarray(img_array_8bit, 'L')
        else:
            print(f"[capture_snapshot] Unsupported format: {img_format}")
            return None

        return img

def sequence_capture_loop():
    """Background thread: capture stills and upload each frame to Google Drive (in-memory only)."""
    import google_drive_upload as gdrive

    drive_folder_id = sequence_state['drive_folder_id']

    while sequence_state['active']:
        try:
            if sequence_state['current_count'] >= sequence_state['total_count']:
                sequence_state['active'] = False
                print(f"[Sequence] Completed {sequence_state['current_count']}/{sequence_state['total_count']} photos")
                break
            
            # Capture photo
            was_streaming = camera.streaming
            if was_streaming:
                camera.stop_stream()
                time.sleep(1.0)
                
                # Ensure camera is idle
                status = ctypes.c_int(0)
                asi_lib.ASIGetExpStatus(camera.camera_id, ctypes.byref(status))
                if status.value != 0:
                    asi_lib.ASIStopExposure(camera.camera_id)
                    time.sleep(0.5)
            
            # Apply format if needed
            photo_format = camera_state['image_format']
            width = camera_state['width']
            height = camera_state['height']
            format_applied = False
            
            if photo_format != ASI_IMG_RGB24:
                asi_lib.ASISetROIFormat(camera.camera_id, width, height, 1, photo_format)
                format_applied = True
            
            # Capture
            img = camera.capture_snapshot()
            
            # Restore format if needed
            if was_streaming and format_applied:
                asi_lib.ASISetROIFormat(camera.camera_id, width, height, 1, ASI_IMG_RGB24)
                time.sleep(0.3)
            
            if was_streaming:
                camera.start_stream()
            
            if img:
                sequence_state['current_count'] += 1
                count = sequence_state['current_count']
                total = sequence_state['total_count']

                date_formatter = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
                gain = camera_state['gain']
                exposure = camera_state['exposure'] / 1000000.0

                try:
                    data, mime_type, ext = gdrive.encode_image(img, sequence_state['file_format'])
                    filename = (
                        f"{date_formatter}_seq{count:04d}of{total:04d}"
                        f"_gain{gain}_exp{exposure:.3f}s.{ext}"
                    )
                    gdrive.upload_bytes(drive_folder_id, filename, data, mime_type)
                    sequence_state['last_error'] = None
                    print(f"[Sequence] Uploaded {count}/{total}: {filename}")
                except Exception as upload_err:
                    sequence_state['last_error'] = str(upload_err)
                    print(f"[Sequence] Upload failed {count}/{total}: {upload_err}")
            else:
                print(
                    f"[Sequence] Failed to capture photo "
                    f"{sequence_state['current_count'] + 1}/{sequence_state['total_count']}"
                )
            
            # Wait between photos
            interval = sequence_state.get('interval', 0)  # Get interval (0 = fast mode)
            if interval > 0:
                # Time-lapse mode: use fixed interval
                wait_time = interval
                print(f"[Sequence] Waiting {wait_time} seconds until next photo (time-lapse mode)")
            else:
                # Fast mode: at least exposure time + some buffer
                exposure_ms = camera_state['exposure'] / 1000.0
                wait_time = max(exposure_ms / 1000.0 + 0.5, 1.0)  # At least 1 second between photos
                print(f"[Sequence] Waiting {wait_time:.2f} seconds until next photo (fast mode)")
            time.sleep(wait_time)
            
        except Exception as e:
            print(f"[Sequence] Error during capture: {e}")
            import traceback
            traceback.print_exc()
            time.sleep(1.0)
    
    print(f"[Sequence] Sequence capture stopped")
    sequence_state['active'] = False

def _get_control_range(camera_id, control_type):
    """Return (min, max) for an ASI control from SDK caps, or None."""
    if asi_lib is None:
        return None

    num_controls = ctypes.c_int(0)
    result = asi_lib.ASIGetNumOfControls(camera_id, ctypes.byref(num_controls))
    if result != ASI_SUCCESS:
        return None

    num = num_controls.value
    if num <= 0 or num > 128:
        return None

    for i in range(num):
        caps = ASI_CONTROL_CAPS()
        if asi_lib.ASIGetControlCaps(camera_id, i, ctypes.byref(caps)) != ASI_SUCCESS:
            continue
        if caps.ControlType == control_type:
            return int(caps.MinValue), int(caps.MaxValue)
    return None


# Global camera instance
camera = ASICamera()

# API Routes
def _auto_tuning_status():
    """Per-frame auto tuning metrics for website history chart (not persisted on Pi)."""
    if auto_state.get('last_mean_r') is None:
        return None
    return {
        'meanR': auto_state.get('last_mean_r'),
        'meanG': auto_state.get('last_mean_g'),
        'meanB': auto_state.get('last_mean_b'),
        'meanRgb': auto_state.get('last_brightness_mean'),
        'expAction': auto_state.get('last_auto_exp_action'),
        'wbAction': auto_state.get('last_auto_wb_action'),
        'photoExposureUs': camera_state.get('exposure'),
        'wbR': camera_state.get('wb_r'),
        'wbB': camera_state.get('wb_b'),
        'expDeltaUs': auto_state.get('last_exp_delta_us', 0),
        'wbRDelta': auto_state.get('last_wb_r_delta', 0),
        'wbBDelta': auto_state.get('last_wb_b_delta', 0),
    }


def _status_payload():
    """Shared JSON for /status and /camera/status (reverse proxies often mount only /camera/*)."""
    return {
        'sensors': {
            'temperature': None,  # This controller doesn't have environment sensors
            'humidity': None,     # This controller doesn't have environment sensors
            'allSkyCam': {
                'connected': camera_state['connected'],
                'streaming': camera_state['streaming'],
                'mode': camera_state.get('mode', 'off'),
                'autoMode': auto_state['active'],
                'lastSnapshot': camera_state.get('last_auto_frame_iso') or (
                    datetime.now().isoformat() if camera_state['current_frame'] else None
                ),
                'lastStreamFrameIso': camera_state.get('stream_last_frame_iso'),
                'lastAutoFrameIso': camera_state.get('last_auto_frame_iso'),
                'fault': camera_state['error'],
                'gainMin': camera_state.get('gain_min', 0),
                'gainMax': camera_state.get('gain_max', 500),
                'autoExposureBrightness': auto_state.get('last_brightness_mean'),
                'autoExposureLastAction': auto_state.get('last_auto_exp_action'),
                'autoWhiteBalanceLastAction': auto_state.get('last_auto_wb_action'),
                'autoTuning': _auto_tuning_status(),
                'autoModeDaytime': auto_state.get('last_auto_daytime'),
                'autoModeTargetGain': auto_state.get('last_auto_target_gain'),
                'imagingDrive': imaging_drive.status_payload(),
                'ascCloud': asc_cloud_ai.status_payload(),
            }
        }
        # No 'roof', 'safety', or 'alerts' - this controller doesn't handle those
    }


@app.route('/status', methods=['GET'])
def get_status():
    """Get camera status - ONLY return camera data, nothing else"""
    return jsonify(_status_payload())


@app.route('/camera/status', methods=['GET'])
def get_status_under_camera_prefix():
    """Same as /status when the host only reverse-proxies /camera/* to this service."""
    return jsonify(_status_payload())

@app.route('/camera/connect', methods=['POST'])
def connect_camera():
    """Connect to camera"""
    if camera.connect():
        saved_mode, saved_interval = _load_persisted_mode()
        if saved_mode in VALID_CAMERA_MODES and saved_mode != 'off':
            apply_camera_mode(saved_mode, saved_interval)
        return jsonify({'success': True, 'message': 'Camera connected', 'mode': camera_state.get('mode', 'off')})
    return jsonify({'success': False, 'message': camera_state['error']}), 500

@app.route('/camera/disconnect', methods=['POST'])
def disconnect_camera():
    """Disconnect camera"""
    camera.disconnect()
    return jsonify({'success': True, 'message': 'Camera disconnected'})

@app.route('/camera/mode', methods=['POST'])
def set_camera_mode_route():
    """Set camera mode: off, stream, or auto (server-side periodic capture)."""
    data = request.get_json() or {}
    mode = data.get('mode', 'off')
    interval = data.get('interval')
    ok, message = apply_camera_mode(mode, interval)
    if ok:
        return jsonify({
            'success': True,
            'message': message,
            'mode': camera_state.get('mode', 'off'),
            'autoMode': auto_state['active'],
        })
    return jsonify({'success': False, 'message': message}), 500


@app.route('/camera/latest', methods=['GET'])
def latest_frame():
    """Latest auto or snapshot frame as JPEG (for polling UIs)."""
    with frame_lock:
        frame = camera_state.get('current_frame')
    if not frame:
        return jsonify({'error': 'No frame available'}), 404
    img_io = io.BytesIO()
    frame.save(img_io, 'JPEG', quality=85)
    img_io.seek(0)
    return send_file(img_io, mimetype='image/jpeg')

_mjpeg_lock = threading.Lock()
_mjpeg_part = None
_mjpeg_version = 0
_mjpeg_thread = None
_mjpeg_last_asc_at = 0.0
ASC_STREAM_ANALYSIS_INTERVAL_S = 45.0


def _run_asc_analysis_async(img) -> None:
    """TensorFlow inference can take seconds — never block HTTP or MJPEG threads."""
    threading.Thread(
        target=asc_cloud_ai.analyze_and_store,
        args=(img.copy(),),
        daemon=True,
    ).start()


def _mjpeg_encoder_loop() -> None:
    """Encode one MJPEG part per frame; clients only read shared bytes."""
    global _mjpeg_part, _mjpeg_version, _mjpeg_last_asc_at
    while True:
        if not (camera_state['streaming'] or auto_state['active']):
            time.sleep(0.2)
            continue

        frame = None
        if camera_state['streaming']:
            frame = camera.frame_buffer
        elif auto_state['active']:
            with frame_lock:
                frame = camera_state.get('current_frame')

        if frame is None:
            time.sleep(0.05)
            continue

        if camera_state['streaming']:
            now = time.time()
            if now - _mjpeg_last_asc_at >= ASC_STREAM_ANALYSIS_INTERVAL_S:
                _mjpeg_last_asc_at = now
                _run_asc_analysis_async(frame)

        img_io = io.BytesIO()
        frame.save(img_io, 'JPEG', quality=75)
        part = (
            b'--frame\r\n'
            b'Content-Type: image/jpeg\r\n\r\n' + img_io.getvalue() + b'\r\n'
        )
        with _mjpeg_lock:
            _mjpeg_part = part
            _mjpeg_version += 1

        time.sleep(0.05 if camera_state['streaming'] else 1.0)


def _ensure_mjpeg_encoder() -> None:
    global _mjpeg_thread
    if _mjpeg_thread and _mjpeg_thread.is_alive():
        return
    _mjpeg_thread = threading.Thread(target=_mjpeg_encoder_loop, daemon=True)
    _mjpeg_thread.start()


@app.route('/camera/stream', methods=['GET'])
def video_stream():
    """MJPEG stream — shared encoder; one thread per client only waits on cached frames."""
    _ensure_mjpeg_encoder()

    def generate():
        last_version = -1
        while camera_state['streaming'] or auto_state['active']:
            with _mjpeg_lock:
                part = _mjpeg_part
                version = _mjpeg_version
            if part is not None and version != last_version:
                yield part
                last_version = version
            time.sleep(0.05)

    return Response(generate(), mimetype='multipart/x-mixed-replace; boundary=frame')

def _sync_controls_from_camera():
    """Read live gain/gamma/video exposure from the camera into camera_state."""
    if not camera.is_open or asi_lib is None:
        return

    gain = ctypes.c_long(0)
    auto_gain = ctypes.c_int(0)
    if asi_lib.ASIGetControlValue(camera.camera_id, ASI_GAIN, ctypes.byref(gain), ctypes.byref(auto_gain)) == ASI_SUCCESS:
        camera_state['gain'] = int(gain.value)

    gamma = ctypes.c_long(0)
    auto_gamma = ctypes.c_int(0)
    if asi_lib.ASIGetControlValue(camera.camera_id, ASI_GAMMA, ctypes.byref(gamma), ctypes.byref(auto_gamma)) == ASI_SUCCESS:
        camera_state['gamma'] = int(gamma.value)

    exposure = ctypes.c_long(0)
    auto_exp = ctypes.c_int(0)
    if asi_lib.ASIGetControlValue(camera.camera_id, ASI_EXPOSURE, ctypes.byref(exposure), ctypes.byref(auto_exp)) == ASI_SUCCESS:
        camera_state['video_exposure'] = int(exposure.value)

    wb_r = ctypes.c_long(0)
    auto_wb_r = ctypes.c_int(0)
    if asi_lib.ASIGetControlValue(camera.camera_id, ASI_WB_R, ctypes.byref(wb_r), ctypes.byref(auto_wb_r)) == ASI_SUCCESS:
        camera_state['wb_r'] = int(wb_r.value)

    wb_b = ctypes.c_long(0)
    auto_wb_b = ctypes.c_int(0)
    if asi_lib.ASIGetControlValue(camera.camera_id, ASI_WB_B, ctypes.byref(wb_b), ctypes.byref(auto_wb_b)) == ASI_SUCCESS:
        camera_state['wb_b'] = int(wb_b.value)


def _settings_payload():
    format_names = {ASI_IMG_RGB24: 'RGB24', ASI_IMG_RAW8: 'RAW8', ASI_IMG_RAW16: 'RAW16', ASI_IMG_Y8: 'Y8'}
    # Auto mode: return Pi state (auto exposure / scheduled gain), not a hardware resync.
    if camera_state['connected'] and not auto_state['active']:
        _sync_controls_from_camera()
    return {
        'connected': camera_state['connected'],
        'gain': camera_state['gain'],
        'gamma': camera_state.get('gamma', 50),
        'photo_exposure': camera_state['exposure'],
        'video_exposure': camera_state['video_exposure'],
        'gain_min': camera_state.get('gain_min', 0),
        'gain_max': camera_state.get('gain_max', 500),
        'wb_r': camera_state.get('wb_r', 50),
        'wb_b': camera_state.get('wb_b', 50),
        'wb_auto': False,
        'image_format': format_names.get(camera_state['image_format'], 'RGB24'),
    }


@app.route('/camera/settings', methods=['GET'])
def get_settings():
    """Return current camera settings (Pi state, synced from hardware when connected)."""
    return jsonify(_settings_payload())


@app.route('/camera/settings', methods=['POST'])
def update_settings():
    """Update camera settings"""
    data = request.get_json()
    print(f"[Settings] Request received: {data}")
    
    updated = []
    
    if 'gain' in data:
        gain_max = camera_state.get('gain_max', 500)
        gain = max(0, min(gain_max, int(data['gain'])))
        camera_state['gain'] = gain
        
        # Remember if streaming
        was_streaming = camera_state['streaming']
        print(f"[Settings] Current streaming state: {was_streaming}")
        
        if camera.is_open:
            # Try to set gain directly if streaming (may work without restart on some SDKs)
            result = asi_lib.ASISetControlValue(camera.camera_id, ASI_GAIN, gain, ASI_FALSE)
            
            # Verify it was set
            actual_gain = ctypes.c_long(0)
            auto_gain = ctypes.c_int(0)
            asi_lib.ASIGetControlValue(camera.camera_id, ASI_GAIN, ctypes.byref(actual_gain), ctypes.byref(auto_gain))
            
            print(f"[Settings] Set gain to {gain} (result: {result}, actual: {actual_gain.value}, auto: {auto_gain.value})")
            
            # If streaming and gain didn't take effect, restart stream
            if was_streaming:
                # Check if gain actually changed
                if actual_gain.value != gain:
                    print(f"[Settings] Gain not applied during streaming, restarting stream...")
                    camera.stop_stream()
                    time.sleep(0.5)
                    result = asi_lib.ASISetControlValue(camera.camera_id, ASI_GAIN, gain, ASI_FALSE)
                    time.sleep(0.2)
                    success = camera.start_stream()
                    print(f"[Settings] Stream restart result: {success}, State: {camera_state['streaming']}")
                else:
                    print(f"[Settings] Gain updated successfully without stream restart")
            
            updated.append(f"gain={gain}")
            
    if 'gamma' in data:
        gamma = int(data['gamma'])
        # Clamp gamma to valid range (1-100)
        gamma = max(1, min(100, gamma))
        camera_state['gamma'] = gamma
        print(f"[Settings] Setting gamma: {gamma}")
        
        if camera.is_open:
            result_gamma = asi_lib.ASISetControlValue(camera.camera_id, ASI_GAMMA, gamma, ASI_FALSE)
            
            # Verify it was set
            actual_gamma = ctypes.c_long(0)
            auto_gamma = ctypes.c_int(0)
            asi_lib.ASIGetControlValue(camera.camera_id, ASI_GAMMA, ctypes.byref(actual_gamma), ctypes.byref(auto_gamma))
            
            print(f"[Settings] Set gamma to {gamma} (result: {result_gamma}, actual: {actual_gamma.value})")
            
            # If streaming, restart to apply gamma
            was_streaming = camera_state['streaming']
            if was_streaming:
                print(f"[Settings] Restarting stream to apply gamma...")
                camera.stop_stream()
                time.sleep(0.5)
                success = camera.start_stream()
                print(f"[Settings] Stream restart result: {success}, State: {camera_state['streaming']}")
            
            updated.append(f"gamma={gamma}")
    
    if 'photo_exposure' in data:
        exposure_us = int(data['photo_exposure'])
        camera_state['exposure'] = exposure_us
        print(f"[Settings] Set photo exposure: {exposure_us} μs = {exposure_us/1000000:.3f} s")
        updated.append(f"photo_exposure={exposure_us}us")
    
    if 'video_exposure' in data:
        video_exposure_us = int(data['video_exposure'])
        camera_state['video_exposure'] = video_exposure_us
        
        # Remember if streaming
        was_streaming = camera_state['streaming']
        print(f"[Settings] Setting video exposure: {video_exposure_us} μs ({video_exposure_us/1000:.1f} ms)")
        
        if camera.is_open and was_streaming:
            # Video exposure only affects stream mode; auto/off use photo_exposure for stills.
            print(f"[Settings] Stopping stream to apply video exposure...")
            camera.stop_stream()
            time.sleep(0.5)

            result_exp = asi_lib.ASISetControlValue(
                camera.camera_id, ASI_EXPOSURE, video_exposure_us, ASI_FALSE
            )

            actual_exp = ctypes.c_long(0)
            auto_exp = ctypes.c_int(0)
            asi_lib.ASIGetControlValue(
                camera.camera_id, ASI_EXPOSURE, ctypes.byref(actual_exp), ctypes.byref(auto_exp)
            )

            print(
                f"[Settings] Set ASI_EXPOSURE to {video_exposure_us} μs "
                f"(result: {result_exp}, actual: {actual_exp.value} μs, auto: {auto_exp.value})"
            )

            print(f"[Settings] Restarting stream with new video exposure...")
            time.sleep(0.5)
            success = camera.start_stream()
            print(f"[Settings] Stream restart result: {success}, State: {camera_state['streaming']}")
        elif camera.is_open:
            print(
                f"[Settings] Saved video exposure {video_exposure_us} μs "
                f"(not applied to hardware until stream mode)"
            )

        updated.append(f"video_exposure={video_exposure_us}us")
    
    if 'wb_auto' in data and bool(data['wb_auto']):
        print("[Settings] Ignoring wb_auto=True (manual WB only)")

    wb_changed = False
    if 'wb_r' in data:
        wb_r = max(0, min(100, int(data['wb_r'])))
        camera_state['wb_r'] = wb_r
        wb_changed = True
        updated.append(f"wb_r={wb_r}")

    if 'wb_b' in data:
        wb_b = max(0, min(100, int(data['wb_b'])))
        camera_state['wb_b'] = wb_b
        wb_changed = True
        updated.append(f"wb_b={wb_b}")

    if wb_changed and camera.is_open:
        was_streaming = camera_state['streaming']
        if was_streaming:
            camera.stop_stream()
            time.sleep(0.5)
        _apply_manual_white_balance()
        print(
            f"[Settings] Manual white balance R={camera_state['wb_r']} "
            f"B={camera_state['wb_b']}"
        )
        if was_streaming:
            time.sleep(0.5)
            success = camera.start_stream()
            print(f"[Settings] Stream restart result: {success}, State: {camera_state['streaming']}")
    
    if 'image_format' in data:
        format_map = {
            'RGB24': ASI_IMG_RGB24,
            'RAW8': ASI_IMG_RAW8,
            'RAW16': ASI_IMG_RAW16,
            'Y8': ASI_IMG_Y8
        }
        format_str = data['image_format']
        if format_str in format_map:
            new_format = format_map[format_str]
            camera_state['image_format'] = new_format
            print(f"[Settings] Set image format to {format_str} ({new_format})")
            print(f"[Settings] Note: Image format only affects photo capture, video stream always uses RGB24")
            updated.append(f"image_format={format_str}")
            # Note: Image format is only applied when capturing photos, not for video streaming
            # Video stream always uses RGB24 for real-time performance
        else:
            print(f"[Settings] Invalid image format: {format_str}")
    
    # Get current format name
    format_names = {ASI_IMG_RGB24: 'RGB24', ASI_IMG_RAW8: 'RAW8', ASI_IMG_RAW16: 'RAW16', ASI_IMG_Y8: 'Y8'}
    current_format_name = format_names.get(camera_state['image_format'], 'RGB24')
    
    print(f"[Settings] Updated: {', '.join(updated) if updated else 'nothing'}")
    print(f"[Settings] State now - Gain: {camera_state['gain']}, Photo Exposure: {camera_state['exposure']} μs, Video Exposure: {camera_state['video_exposure']} μs, WB R: {camera_state.get('wb_r', 'N/A')}, WB B: {camera_state.get('wb_b', 'N/A')}, Format: {current_format_name}")

    # Auto: gain/gamma/photo exp / WB → wake loop (immediate capture + fresh interval).
    if auto_state['active'] and camera_state.get('mode') == 'auto':
        if any(k in data for k in ('gain', 'gamma', 'photo_exposure', 'wb_r', 'wb_b')):
            _request_auto_cycle_restart()

    return jsonify({
        'success': True,
        'gain': camera_state['gain'],
        'exposure': camera_state['exposure'],
        'video_exposure': camera_state['video_exposure'],
        'wb_r': camera_state.get('wb_r', 50),
        'wb_b': camera_state.get('wb_b', 50),
        'image_format': current_format_name
    })

@app.route('/camera/sequence/start', methods=['POST'])
def start_sequence():
    """Start sequence capture; each frame uploads to Google Drive (no Pi disk storage)."""
    import google_drive_upload as gdrive

    data = request.get_json()
    print(f"[Sequence Start] Received request data: {data}")

    if data is None:
        return jsonify({'error': 'No JSON data received'}), 400

    if sequence_state['active']:
        return jsonify({'error': 'Sequence capture already in progress'}), 400

    if 'count' not in data:
        return jsonify({'error': 'Missing required parameter: count'}), 400

    if not gdrive.drive_configured():
        return jsonify({
            'error': (
                'Google Drive is not configured on the Pi. Set '
                'GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON to the service account JSON path, '
                'and share the All Sky Camera folder with that service account email.'
            )
        }), 503

    try:
        count = int(data['count'])
    except (ValueError, TypeError):
        return jsonify({'error': f'Invalid count value: {data.get("count")}'}), 400

    file_format = data.get('file_format', 'JPEG')
    interval = float(data.get('interval', 0))

    if interval < 0:
        return jsonify({'error': 'Interval must be >= 0'}), 400

    if count < 1 or count > 10000:
        return jsonify({'error': 'Count must be between 1 and 10000'}), 400

    if file_format not in ['JPEG', 'PNG', 'TIFF']:
        return jsonify({'error': 'File format must be JPEG, PNG, or TIFF'}), 400

    if not camera_state['connected'] or not camera.is_open:
        return jsonify({'error': 'Camera not connected'}), 500

    folder_name = (data.get('folder_name') or data.get('save_path') or '').strip()
    if not folder_name:
        folder_name = f"{datetime.now().strftime('%Y-%m-%d_%H-%M-%S')}_x{count}"

    root_id = gdrive.sequence_root_folder_id()
    try:
        drive_folder_id = gdrive.create_folder(root_id, folder_name)
    except Exception as e:
        print(f"[Sequence Start] Google Drive error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'Google Drive: {e}'}), 503

    drive_url = gdrive.folder_web_url(drive_folder_id)

    sequence_state['active'] = True
    sequence_state['drive_folder_id'] = drive_folder_id
    sequence_state['drive_folder_name'] = folder_name
    sequence_state['total_count'] = count
    sequence_state['current_count'] = 0
    sequence_state['file_format'] = file_format
    sequence_state['interval'] = interval
    sequence_state['last_error'] = None

    sequence_state['thread'] = threading.Thread(target=sequence_capture_loop, daemon=True)
    sequence_state['thread'].start()

    mode_str = f"time-lapse (interval: {interval}s)" if interval > 0 else "fast mode"
    print(
        f"[Sequence] Started: {count} photos → Drive folder {folder_name} ({drive_url}), "
        f"format: {file_format}, {mode_str}"
    )

    return jsonify({
        'success': True,
        'message': f'Sequence capture started: {count} photos ({mode_str})',
        'folder_name': folder_name,
        'drive_folder_id': drive_folder_id,
        'drive_url': drive_url,
        'count': count,
        'file_format': file_format,
        'interval': interval,
    })

@app.route('/camera/sequence/stop', methods=['POST'])
def stop_sequence():
    """Stop sequence capture"""
    if not sequence_state['active']:
        return jsonify({'error': 'No sequence capture in progress'}), 400
    
    sequence_state['active'] = False
    
    # Wait for thread to finish
    if sequence_state['thread']:
        sequence_state['thread'].join(timeout=5.0)
    
    print(f"[Sequence] Stopped: {sequence_state['current_count']}/{sequence_state['total_count']} photos captured")
    
    return jsonify({
        'success': True,
        'message': 'Sequence capture stopped',
        'captured': sequence_state['current_count'],
        'total': sequence_state['total_count']
    })

@app.route('/camera/sequence/status', methods=['GET'])
def sequence_status():
    """Get sequence capture status"""
    folder_id = sequence_state.get('drive_folder_id')
    drive_url = None
    if folder_id:
        import google_drive_upload as gdrive
        drive_url = gdrive.folder_web_url(folder_id)

    return jsonify({
        'active': sequence_state['active'],
        'current_count': sequence_state['current_count'],
        'total_count': sequence_state['total_count'],
        'folder_name': sequence_state.get('drive_folder_name'),
        'drive_folder_id': folder_id,
        'drive_url': drive_url,
        'file_format': sequence_state['file_format'],
        'interval': sequence_state.get('interval', 0),
        'last_error': sequence_state.get('last_error'),
    })


if __name__ == '__main__':
    print("Starting ASI Camera Service...")
    print("Attempting to connect to camera...")
    
    if camera.connect():
        print("Camera connected successfully!")
        saved_mode, saved_interval = _load_persisted_mode()
        if saved_mode in VALID_CAMERA_MODES and saved_mode != 'off':
            print(f"[Mode] Restoring persisted mode: {saved_mode}")
            apply_camera_mode(saved_mode, saved_interval)
    else:
        print(f"Failed to connect to camera: {camera_state['error']}")
        print("Service will start anyway, you can try connecting via API")
    
    print("Starting HTTP server on port 8080...")
    app.run(host='0.0.0.0', port=8080, debug=False, threaded=True)

