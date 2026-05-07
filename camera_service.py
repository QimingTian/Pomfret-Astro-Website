#!/usr/bin/env python3
"""
ASI Camera Service for Raspberry Pi (Linux)
Provides HTTP API and MJPEG stream for remote access

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
from uuid import uuid4

app = Flask(__name__)
CORS(app)

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

# ASI Camera constants (from ASICamera2.h)
ASI_SUCCESS = 0
ASI_FALSE = 0
ASI_TRUE = 1

# Image types
ASI_IMG_RAW8 = 0
ASI_IMG_RGB24 = 1
ASI_IMG_RAW16 = 2
ASI_IMG_Y8 = 3

# Control types (IMPORTANT: Order from header file)
ASI_GAIN = 0
ASI_EXPOSURE = 1
ASI_GAMMA = 2
ASI_WB_R = 3
ASI_WB_B = 4
ASI_BRIGHTNESS = 5
ASI_BANDWIDTHOVERLOAD = 6
ASI_OVERCLOCK = 7
ASI_TEMPERATURE = 8
ASI_FLIP = 9
ASI_AUTO_MAX_GAIN = 10
ASI_AUTO_MAX_EXP = 11
ASI_AUTO_TARGET_BRIGHTNESS = 12
ASI_HARDWARE_BIN = 13
ASI_HIGH_SPEED_MODE = 14

# Camera state
camera_state = {
    'connected': False,
    'streaming': False,
    'camera_id': -1,
    'width': 1280,
    'height': 960,
    'exposure': 1000000,  # microseconds - for photo capture only
    'video_exposure': 100000,  # microseconds - max exposure for video streaming (controls frame rate)
    'gain': 50,
    'gamma': 50,  # Gamma (default, range 1-100, recommended 50 for linear output)
    'wb_r': 50,  # White balance red channel (default, range 0-100)
    'wb_b': 50,  # White balance blue channel (default, range 0-100)
    'wb_auto': False,  # Auto white balance enabled (default: manual)
    'image_format': ASI_IMG_RGB24,  # Default to RGB24
    'current_frame': None,
    'error': None,
    # Wall time of last successful video frame (UTC ISO), for web UI "last updated" polling
    'stream_last_frame_iso': None,
}

# Sequence capture state
sequence_state = {
    'active': False,
    'save_path': None,
    'total_count': 0,
    'current_count': 0,
    'file_format': 'JPEG',  # JPEG, PNG, or TIFF
    'interval': 0,  # Interval between photos in seconds (0 = fast mode, >0 = time-lapse mode)
    'thread': None
}

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
            
            # Set initial white balance (only for color cameras)
            if camera_info.IsColorCam:
                wb_auto = camera_state.get('wb_auto', False)
                if wb_auto:
                    # Set auto white balance
                    result_wb_r = asi_lib.ASISetControlValue(self.camera_id, ASI_WB_R, 0, ASI_TRUE)
                    result_wb_b = asi_lib.ASISetControlValue(self.camera_id, ASI_WB_B, 0, ASI_TRUE)
                else:
                    # Set manual white balance
                    result_wb_r = asi_lib.ASISetControlValue(self.camera_id, ASI_WB_R, camera_state['wb_r'], ASI_FALSE)
                    result_wb_b = asi_lib.ASISetControlValue(self.camera_id, ASI_WB_B, camera_state['wb_b'], ASI_FALSE)
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
                wb_auto = camera_state.get('wb_auto', False)
                if wb_auto:
                    print(f"  White Balance: Auto (R result: {result_wb_r}, B result: {result_wb_b})")
                else:
                    print(f"  White Balance R: {camera_state['wb_r']} (result: {result_wb_r})")
                    print(f"  White Balance B: {camera_state['wb_b']} (result: {result_wb_b})")
            
            camera_state['connected'] = True
            camera_state['error'] = None
            return True
            
        except Exception as e:
            camera_state['error'] = str(e)
            print(f"Error connecting to camera: {e}")
            return False
    
    def disconnect(self):
        """Disconnect from camera"""
        self.stop_stream()
        if self.is_open and self.camera_id >= 0:
            asi_lib.ASICloseCamera(self.camera_id)
            self.is_open = False
        camera_state['connected'] = False
        camera_state['streaming'] = False
        camera_state['stream_last_frame_iso'] = None
    
    def reset_camera(self):
        """Reset camera by closing and reopening - use when camera is stuck in FAILED state"""
        if not self.is_open or self.camera_id < 0:
            return False
        
        print("[reset_camera] Attempting to reset camera...")
        camera_id = self.camera_id
        width = camera_state['width']
        height = camera_state['height']
        gain = camera_state['gain']
        exposure = camera_state['exposure']
        image_format = camera_state['image_format']
        
        try:
            # Close camera
            print("[reset_camera] Closing camera...")
            asi_lib.ASICloseCamera(camera_id)
            self.is_open = False
            time.sleep(1.0)
            
            # Reopen camera
            print("[reset_camera] Reopening camera...")
            result = asi_lib.ASIOpenCamera(camera_id)
            if result != ASI_SUCCESS:
                print(f"[reset_camera] Failed to reopen camera: {result}")
                return False
            
            # Reinitialize camera
            result = asi_lib.ASIInitCamera(camera_id)
            if result != ASI_SUCCESS:
                print(f"[reset_camera] Failed to reinitialize camera: {result}")
                asi_lib.ASICloseCamera(camera_id)
                return False
            
            self.is_open = True
            
            # Restore settings
            print("[reset_camera] Restoring camera settings...")
            asi_lib.ASISetROIFormat(camera_id, width, height, 1, image_format)
            time.sleep(0.3)
            asi_lib.ASISetControlValue(camera_id, ASI_GAIN, gain, ASI_FALSE)
            asi_lib.ASISetControlValue(camera_id, ASI_EXPOSURE, exposure, ASI_FALSE)
            asi_lib.ASISetControlValue(camera_id, ASI_BANDWIDTHOVERLOAD, 40, ASI_FALSE)
            time.sleep(0.3)
            
            # Check status
            status = ctypes.c_int(0)
            asi_lib.ASIGetExpStatus(camera_id, ctypes.byref(status))
            if status.value == 0:
                print("[reset_camera] Camera successfully reset to IDLE state")
                return True
            else:
                status_names = {0: "ASI_EXP_IDLE", 1: "ASI_EXP_WORKING", 2: "ASI_EXP_SUCCESS", 3: "ASI_EXP_FAILED"}
                status_name = status_names.get(status.value, f"UNKNOWN_{status.value}")
                print(f"[reset_camera] Camera reset but still in state {status.value} ({status_name})")
                return False
                
        except Exception as e:
            print(f"[reset_camera] Exception during reset: {e}")
            import traceback
            traceback.print_exc()
            return False
    
    def start_stream(self):
        """Start video streaming"""
        if not self.is_open:
            return False
        
        # Enable auto exposure for video mode, but limit max exposure time
        # This allows the camera to adjust exposure automatically while respecting the max limit
        video_exposure = camera_state['video_exposure']  # microseconds
        gain = camera_state['gain']
        
        # Set gain first (must be set before starting video capture)
        result_gain = asi_lib.ASISetControlValue(self.camera_id, ASI_GAIN, gain, ASI_FALSE)
        
        # Set gamma
        gamma = camera_state.get('gamma', 50)
        result_gamma = asi_lib.ASISetControlValue(self.camera_id, ASI_GAMMA, gamma, ASI_FALSE)
        
        # Set white balance (only for color cameras)
        if self.is_color_cam:
            wb_auto = camera_state.get('wb_auto', False)
            if wb_auto:
                # Set auto white balance
                result_wb_r = asi_lib.ASISetControlValue(self.camera_id, ASI_WB_R, 0, ASI_TRUE)
                result_wb_b = asi_lib.ASISetControlValue(self.camera_id, ASI_WB_B, 0, ASI_TRUE)
            else:
                # Set manual white balance
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
            wb_auto = camera_state.get('wb_auto', False)
            if wb_auto:
                print(f"[start_stream] Set auto white balance (R result: {result_wb_r}, B result: {result_wb_b})")
            else:
                wb_r = camera_state.get('wb_r', 50)
                wb_b = camera_state.get('wb_b', 50)
                print(f"[start_stream] Set manual white balance R: {wb_r} (result: {result_wb_r}), B: {wb_b} (result: {result_wb_b})")
        print(f"[start_stream] Set video exposure to {video_exposure} μs ({video_exposure/1000:.1f} ms)")
        print(f"[start_stream] Manual exposure result: {result_manual}, actual: {actual_exp.value} μs, auto: {auto_exp.value}")
        
        print(f"[start_stream] Starting video capture")
        
        result = asi_lib.ASIStartVideoCapture(self.camera_id)
        if result != ASI_SUCCESS:
            camera_state['error'] = f"Failed to start video capture: {result}"
            return False
        
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
            # SDK recommends: exposure*2+500ms
            video_exposure_ms = camera_state['video_exposure'] / 1000.0  # Convert to ms
            timeout_ms = int(video_exposure_ms * 2 + 500)
            timeout_ms = max(100, min(timeout_ms, 5000))  # Clamp between 100ms and 5s (was 1s minimum)
            
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
                # Convert to numpy array
                img_array = np.frombuffer(buffer, dtype=np.uint8)
                img_array = img_array.reshape((height, width, 3))
                
                # Convert to PIL Image
                img = Image.fromarray(img_array, mode='RGB')
                self.frame_buffer = img
                camera_state['current_frame'] = img
                camera_state['stream_last_frame_iso'] = datetime.now(timezone.utc).isoformat()
            elif result != 2:  # 2 = timeout, which is normal
                consecutive_errors += 1
                # Only print error if it persists
                if consecutive_errors == 1 or consecutive_errors % 10 == 0:
                    print(f"Error getting video data: {result} (consecutive: {consecutive_errors})")
            
            # Minimal sleep - let camera exposure time control the actual frame rate
            # If exposure is short, we'll get frames faster; if long, we'll wait longer
            time.sleep(0.001)  # 1ms sleep - much shorter to allow FPS to vary with exposure
    
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
        
        # Set exposure and gain (disable auto for photo mode)
        exposure = camera_state['exposure']
        gain_val = camera_state['gain']
        
        # Disable auto exposure and set manual values
        asi_lib.ASISetControlValue(self.camera_id, ASI_EXPOSURE, exposure, ASI_FALSE)
        asi_lib.ASISetControlValue(self.camera_id, ASI_GAIN, gain_val, ASI_FALSE)
        
        print(f"[capture_snapshot] Starting exposure: {exposure} μs, gain: {gain_val}")
        
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
        status = ctypes.c_int(0)
        timeout = 0
        max_timeout = (exposure // 1000) + 5000  # ms
        
        while timeout < max_timeout:
            asi_lib.ASIGetExpStatus(self.camera_id, ctypes.byref(status))
            if status.value == 2:  # ASI_EXP_SUCCESS
                break
            if status.value == 3:  # ASI_EXP_FAILED - don't wait, fail immediately
                status_name = status_names.get(status.value, f"UNKNOWN_{status.value}")
                print(f"[capture_snapshot] Exposure failed with status: {status.value} ({status_name}) at timeout: {timeout}ms")
                return None
            time.sleep(0.1)
            timeout += 100
        
        if status.value != 2:
            status_name = status_names.get(status.value, f"UNKNOWN_{status.value}")
            print(f"[capture_snapshot] Exposure failed with status: {status.value} ({status_name}) after {timeout}ms")
            return None
        
        # Get image data based on format
        width = camera_state['width']
        height = camera_state['height']
        img_format = camera_state['image_format']
        
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
    """Background thread for sequence capture"""
    import os
    
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
                # Generate filename
                sequence_state['current_count'] += 1
                count = sequence_state['current_count']
                total = sequence_state['total_count']
                
                date_formatter = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
                gain = camera_state['gain']
                exposure = camera_state['exposure'] / 1000000.0  # Convert to seconds
                
                file_format = sequence_state['file_format'].lower()
                if file_format == 'jpeg':
                    file_format = 'jpg'
                
                filename = f"{date_formatter}_seq{count:04d}of{total:04d}_gain{gain}_exp{exposure:.3f}s.{file_format}"
                filepath = os.path.join(sequence_state['save_path'], filename)
                
                # Save image
                if sequence_state['file_format'] == 'JPEG':
                    img.save(filepath, 'JPEG', quality=100)
                elif sequence_state['file_format'] == 'PNG':
                    img.save(filepath, 'PNG')
                elif sequence_state['file_format'] == 'TIFF':
                    img.save(filepath, 'TIFF')
                
                print(f"[Sequence] Saved photo {count}/{total}: {filename}")
            else:
                print(f"[Sequence] Failed to capture photo {sequence_state['current_count'] + 1}/{sequence_state['total_count']}")
            
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

# Global camera instance
camera = ASICamera()

# API Routes
def _status_payload():
    """Shared JSON for /status and /camera/status (reverse proxies often mount only /camera/*)."""
    return {
        'sensors': {
            'temperature': None,  # This controller doesn't have environment sensors
            'humidity': None,     # This controller doesn't have environment sensors
            'allSkyCam': {
                'connected': camera_state['connected'],
                'streaming': camera_state['streaming'],
                'lastSnapshot': datetime.now().isoformat() if camera_state['current_frame'] else None,
                'lastStreamFrameIso': camera_state.get('stream_last_frame_iso'),
                'fault': camera_state['error'],
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
        return jsonify({'success': True, 'message': 'Camera connected'})
    return jsonify({'success': False, 'message': camera_state['error']}), 500

@app.route('/camera/disconnect', methods=['POST'])
def disconnect_camera():
    """Disconnect camera"""
    camera.disconnect()
    return jsonify({'success': True, 'message': 'Camera disconnected'})

@app.route('/camera/stream/start', methods=['POST'])
def start_stream():
    """Start video stream"""
    if camera.start_stream():
        return jsonify({'success': True, 'message': 'Stream started'})
    return jsonify({'success': False, 'message': camera_state['error']}), 500

@app.route('/camera/stream/stop', methods=['POST'])
def stop_stream():
    """Stop video stream"""
    camera.stop_stream()
    return jsonify({'success': True, 'message': 'Stream stopped'})

@app.route('/camera/snapshot', methods=['GET'])
def snapshot():
    """Get a snapshot - automatically stops/resumes stream if needed"""
    print(f"[Snapshot] Request. Streaming: {camera_state['streaming']}")
    
    # Check if camera is connected
    if not camera_state['connected'] or not camera.is_open:
        error_msg = "Camera not connected"
        print(f"[Snapshot] Error: {error_msg}")
        return jsonify({'error': error_msg}), 500
    
    # Remember if we were streaming
    was_streaming = camera.streaming
    
    try:
        # MUST stop video capture before exposure mode
        if was_streaming:
            print("[Snapshot] Stopping stream for capture...")
            camera.stop_stream()
            time.sleep(0.5)
        
        # Apply image format for photo capture (video stream always uses RGB24)
        photo_format = camera_state['image_format']
        width = camera_state['width']
        height = camera_state['height']
        format_applied = False
        
        if photo_format != ASI_IMG_RGB24:
            # Apply format for photo capture
            result = asi_lib.ASISetROIFormat(camera.camera_id, width, height, 1, photo_format)
            if result != ASI_SUCCESS:
                error_names = {
                    1: "ASI_ERROR_INVALID_INDEX",
                    2: "ASI_ERROR_INVALID_ID", 
                    3: "ASI_ERROR_INVALID_CONTROL_TYPE",
                    4: "ASI_ERROR_CAMERA_CLOSED",
                    5: "ASI_ERROR_CAMERA_REMOVED",
                    9: "ASI_ERROR_INVALID_IMGTYPE",
                    10: "ASI_ERROR_OUTOF_BOUNDARY",
                    14: "ASI_ERROR_VIDEO_MODE_ACTIVE",
                    15: "ASI_ERROR_EXPOSURE_IN_PROGRESS",
                    16: "ASI_ERROR_GENERAL_ERROR"
                }
                error_name = error_names.get(result, f"UNKNOWN_ERROR_{result}")
                error_msg = f"Failed to set ROI format: {result} ({error_name})"
                print(f"[Snapshot] Error: {error_msg}")
                # Try to restore stream if it was running
                if was_streaming:
                    try:
                        camera.start_stream()
                    except:
                        pass
                return jsonify({'error': error_msg}), 500
            format_applied = True
            print(f"[Snapshot] Applied image format {photo_format} for photo capture")
            # Wait for format to be applied
            time.sleep(0.3)
            
            # Ensure camera is idle after format change
            status = ctypes.c_int(0)
            asi_lib.ASIGetExpStatus(camera.camera_id, ctypes.byref(status))
            if status.value != 0:
                print(f"[Snapshot] Camera not idle after format change (status: {status.value}), waiting...")
                timeout = 0
                while status.value != 0 and timeout < 3000:  # Wait up to 3 seconds
                    time.sleep(0.1)
                    asi_lib.ASIGetExpStatus(camera.camera_id, ctypes.byref(status))
                    timeout += 100
                if status.value != 0:
                    print(f"[Snapshot] Warning: Camera still not idle after format change, forcing stop...")
                    asi_lib.ASIStopExposure(camera.camera_id)
                    time.sleep(0.5)
        
        print(f"[Snapshot] Capturing with exposure: {camera_state['exposure']} μs ({camera_state['exposure']/1000000:.3f} s), format: {photo_format}")
        img = camera.capture_snapshot()
        
        # Restore RGB24 format if needed before resuming stream
        if was_streaming:
            if format_applied:
                # Restore RGB24 for video streaming
                asi_lib.ASISetROIFormat(camera.camera_id, width, height, 1, ASI_IMG_RGB24)
                print("[Snapshot] Restored RGB24 format for video streaming")
                time.sleep(0.3)
            
            print("[Snapshot] Resuming stream...")
            time.sleep(0.3)
            camera.start_stream()
        
        if img:
            img_io = io.BytesIO()
            img.save(img_io, 'JPEG', quality=85)
            img_io.seek(0)
            print(f"[Snapshot] Success!")
            return send_file(img_io, mimetype='image/jpeg')
        else:
            error_msg = 'Failed to capture snapshot - camera returned None'
            print(f"[Snapshot] Error: {error_msg}")
            return jsonify({'error': error_msg}), 500
            
    except Exception as e:
        import traceback
        error_details = traceback.format_exc()
        print(f"[Snapshot] Exception: {e}")
        print(f"[Snapshot] Traceback:\n{error_details}")
        if was_streaming and not camera.streaming:
            try:
                camera.start_stream()
            except:
                pass
        return jsonify({'error': f'Exception: {str(e)}'}), 500

@app.route('/camera/stream', methods=['GET'])
def video_stream():
    """MJPEG video stream"""
    def generate():
        while camera_state['streaming']:
            frame = camera.frame_buffer
            if frame:
                img_io = io.BytesIO()
                frame.save(img_io, 'JPEG', quality=75)
                img_io.seek(0)
                yield (b'--frame\r\n'
                       b'Content-Type: image/jpeg\r\n\r\n' + img_io.read() + b'\r\n')
                
                # Minimal sleep to prevent CPU overload, but let camera capture rate control FPS
                # The actual FPS will be determined by the camera's exposure time and capture speed
                time.sleep(0.005)  # 5ms sleep - much shorter than before to allow higher FPS
            else:
                # No frame available, short sleep to avoid busy waiting
                time.sleep(0.01)
    
    return Response(generate(), mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route('/camera/settings', methods=['POST'])
def update_settings():
    """Update camera settings"""
    from flask import request
    data = request.get_json()
    print(f"[Settings] Request received: {data}")
    
    updated = []
    
    if 'gain' in data:
        gain = int(data['gain'])
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
        
        if camera.is_open:
            # Video exposure requires stream restart to take effect (manual exposure mode)
            if was_streaming:
                print(f"[Settings] Stopping stream to apply video exposure...")
                camera.stop_stream()
                time.sleep(0.5)
            
            # Set ASI_EXPOSURE directly (manual exposure mode for video)
            # Set ASI_EXPOSURE directly as we are in manual exposure mode
            # Note: ASI_AUTO_MAX_EXP is not needed in manual mode
            result_exp = asi_lib.ASISetControlValue(camera.camera_id, ASI_EXPOSURE, video_exposure_us, ASI_FALSE)
            
            # Verify ASI_EXPOSURE was set
            actual_exp = ctypes.c_long(0)
            auto_exp = ctypes.c_int(0)
            asi_lib.ASIGetControlValue(camera.camera_id, ASI_EXPOSURE, ctypes.byref(actual_exp), ctypes.byref(auto_exp))
            
            print(f"[Settings] Set ASI_EXPOSURE to {video_exposure_us} μs (result: {result_exp}, actual: {actual_exp.value} μs, auto: {auto_exp.value})")
            
            # Restart stream if it was active
            if was_streaming:
                print(f"[Settings] Restarting stream with new video exposure...")
                time.sleep(0.5)
                success = camera.start_stream()
                print(f"[Settings] Stream restart result: {success}, State: {camera_state['streaming']}")
            
            updated.append(f"video_exposure={video_exposure_us}us")
    
    if 'wb_auto' in data:
        wb_auto = bool(data['wb_auto'])
        camera_state['wb_auto'] = wb_auto
        print(f"[Settings] Setting white balance auto: {wb_auto}")
        
        if camera.is_open:
            was_streaming = camera_state['streaming']
            if was_streaming:
                print(f"[Settings] Stopping stream to apply white balance mode...")
                camera.stop_stream()
                time.sleep(0.5)
            
            if wb_auto:
                # Enable auto white balance
                result_wb_r = asi_lib.ASISetControlValue(camera.camera_id, ASI_WB_R, 0, ASI_TRUE)
                result_wb_b = asi_lib.ASISetControlValue(camera.camera_id, ASI_WB_B, 0, ASI_TRUE)
                print(f"[Settings] Enabled auto white balance (R result: {result_wb_r}, B result: {result_wb_b})")
            else:
                # Disable auto and set manual values
                wb_r = camera_state.get('wb_r', 50)
                wb_b = camera_state.get('wb_b', 50)
                result_wb_r = asi_lib.ASISetControlValue(camera.camera_id, ASI_WB_R, wb_r, ASI_FALSE)
                result_wb_b = asi_lib.ASISetControlValue(camera.camera_id, ASI_WB_B, wb_b, ASI_FALSE)
                print(f"[Settings] Disabled auto white balance, set manual R: {wb_r}, B: {wb_b}")
            
            # Restart stream if it was active
            if was_streaming:
                print(f"[Settings] Restarting stream with new white balance mode...")
                time.sleep(0.5)
                success = camera.start_stream()
                print(f"[Settings] Stream restart result: {success}, State: {camera_state['streaming']}")
            
            updated.append(f"wb_auto={wb_auto}")
    
    if 'wb_r' in data:
        # Only set manual values if auto is disabled
        if not camera_state.get('wb_auto', False):
            wb_r = int(data['wb_r'])
            camera_state['wb_r'] = wb_r
            print(f"[Settings] Setting white balance R: {wb_r}")
            
            if camera.is_open:
                result_wb_r = asi_lib.ASISetControlValue(camera.camera_id, ASI_WB_R, wb_r, ASI_FALSE)
                
                # Verify it was set
                actual_wb_r = ctypes.c_long(0)
                auto_wb_r = ctypes.c_int(0)
                asi_lib.ASIGetControlValue(camera.camera_id, ASI_WB_R, ctypes.byref(actual_wb_r), ctypes.byref(auto_wb_r))
                
                print(f"[Settings] Set white balance R to {wb_r} (result: {result_wb_r}, actual: {actual_wb_r.value})")
                
                # If streaming, restart to apply white balance
                was_streaming = camera_state['streaming']
                if was_streaming:
                    print(f"[Settings] Restarting stream to apply white balance R...")
                    camera.stop_stream()
                    time.sleep(0.5)
                    success = camera.start_stream()
                    print(f"[Settings] Stream restart result: {success}, State: {camera_state['streaming']}")
                
                updated.append(f"wb_r={wb_r}")
        else:
            print(f"[Settings] Ignoring wb_r change: auto white balance is enabled")
    
    if 'wb_b' in data:
        # Only set manual values if auto is disabled
        if not camera_state.get('wb_auto', False):
            wb_b = int(data['wb_b'])
            camera_state['wb_b'] = wb_b
            print(f"[Settings] Setting white balance B: {wb_b}")
            
            if camera.is_open:
                result_wb_b = asi_lib.ASISetControlValue(camera.camera_id, ASI_WB_B, wb_b, ASI_FALSE)
                
                # Verify it was set
                actual_wb_b = ctypes.c_long(0)
                auto_wb_b = ctypes.c_int(0)
                asi_lib.ASIGetControlValue(camera.camera_id, ASI_WB_B, ctypes.byref(actual_wb_b), ctypes.byref(auto_wb_b))
                
                print(f"[Settings] Set white balance B to {wb_b} (result: {result_wb_b}, actual: {actual_wb_b.value})")
                
                # If streaming, restart to apply white balance
                was_streaming = camera_state['streaming']
                if was_streaming:
                    print(f"[Settings] Restarting stream to apply white balance B...")
                    camera.stop_stream()
                    time.sleep(0.5)
                    success = camera.start_stream()
                    print(f"[Settings] Stream restart result: {success}, State: {camera_state['streaming']}")
                
                updated.append(f"wb_b={wb_b}")
        else:
            print(f"[Settings] Ignoring wb_b change: auto white balance is enabled")
    
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
    
    return jsonify({
        'success': True,
        'gain': camera_state['gain'],
        'exposure': camera_state['exposure'],
        'video_exposure': camera_state['video_exposure'],
        'image_format': current_format_name
    })

@app.route('/camera/sequence/start', methods=['POST'])
def start_sequence():
    """Start sequence capture"""
    from flask import request
    import os
    
    data = request.get_json()
    print(f"[Sequence Start] Received request data: {data}")
    
    if data is None:
        print("[Sequence Start] Error: No JSON data received")
        return jsonify({'error': 'No JSON data received'}), 400
    
    if sequence_state['active']:
        print("[Sequence Start] Error: Sequence already in progress")
        return jsonify({'error': 'Sequence capture already in progress'}), 400
    
    if 'save_path' not in data or 'count' not in data:
        print(f"[Sequence Start] Error: Missing parameters. Received keys: {list(data.keys()) if data else 'None'}")
        return jsonify({'error': 'Missing required parameters: save_path, count'}), 400
    
    save_path = data['save_path']
    
    # Validate save path is not empty
    if not save_path or not save_path.strip():
        print(f"[Sequence Start] Error: Empty save path")
        return jsonify({'error': 'Save path cannot be empty'}), 400
    
    try:
        count = int(data['count'])
    except (ValueError, TypeError):
        print(f"[Sequence Start] Error: Invalid count value: {data.get('count')}")
        return jsonify({'error': f'Invalid count value: {data.get("count")}'}), 400
    
    file_format = data.get('file_format', 'JPEG')
    interval = float(data.get('interval', 0))  # Interval in seconds (0 = fast mode)
    
    # Validate interval
    if interval < 0:
        return jsonify({'error': 'Interval must be >= 0'}), 400
    
    # Validate save path exists and is a directory
    # Expand user path (~) if present
    save_path = os.path.expanduser(save_path)
    
    if not os.path.exists(save_path):
        print(f"[Sequence Start] Error: Save path does not exist: {save_path}")
        return jsonify({'error': f'Save path does not exist on server: {save_path}. Please use a path on the Raspberry Pi.'}), 400
    
    if not os.path.isdir(save_path):
        print(f"[Sequence Start] Error: Invalid save path (not a directory): {save_path}")
        return jsonify({'error': f'Invalid save path (not a directory): {save_path}'}), 400
    
    # Check write permissions
    if not os.access(save_path, os.W_OK):
        print(f"[Sequence Start] Error: No write permission for path: {save_path}")
        return jsonify({'error': f'No write permission for path: {save_path}'}), 400
    
    # Validate count
    if count < 1 or count > 10000:
        return jsonify({'error': 'Count must be between 1 and 10000'}), 400
    
    # Validate file format
    if file_format not in ['JPEG', 'PNG', 'TIFF']:
        return jsonify({'error': 'File format must be JPEG, PNG, or TIFF'}), 400
    
    # Check if camera is connected
    if not camera_state['connected'] or not camera.is_open:
        return jsonify({'error': 'Camera not connected'}), 500
    
    # Initialize sequence state
    sequence_state['active'] = True
    sequence_state['save_path'] = save_path
    sequence_state['total_count'] = count
    sequence_state['current_count'] = 0
    sequence_state['file_format'] = file_format
    sequence_state['interval'] = interval
    
    # Start sequence capture thread
    sequence_state['thread'] = threading.Thread(target=sequence_capture_loop, daemon=True)
    sequence_state['thread'].start()
    
    mode_str = f"time-lapse (interval: {interval}s)" if interval > 0 else "fast mode"
    print(f"[Sequence] Started: {count} photos to {save_path}, format: {file_format}, {mode_str}")
    
    return jsonify({
        'success': True,
        'message': f'Sequence capture started: {count} photos ({mode_str})',
        'save_path': save_path,
        'count': count,
        'file_format': file_format,
        'interval': interval
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
    return jsonify({
        'active': sequence_state['active'],
        'current_count': sequence_state['current_count'],
        'total_count': sequence_state['total_count'],
        'save_path': sequence_state['save_path'],
        'file_format': sequence_state['file_format'],
        'interval': sequence_state.get('interval', 0)
    })

@app.route('/camera/sequence/capture', methods=['POST'])
def capture_sequence():
    """Capture a sequence of photos - simple: stop stream, take N photos, resume stream"""
    from flask import request
    import base64
    
    data = request.get_json()
    
    if not data or 'count' not in data:
        return jsonify({'error': 'Missing count parameter'}), 400
    
    count = int(data.get('count', 1))
    if count < 1 or count > 100:
        return jsonify({'error': 'Count must be between 1 and 100'}), 400
    
    # Check if camera is connected
    if not camera_state['connected'] or not camera.is_open:
        return jsonify({'error': 'Camera not connected'}), 500
    
    # Remember if we were streaming
    was_streaming = camera.streaming
    
    try:
        # Stop stream if running
        if was_streaming:
            print(f"[Sequence Capture] Stopping stream for {count} photos...")
            camera.stop_stream()
            time.sleep(0.5)
        
        # Apply image format if needed
        photo_format = camera_state['image_format']
        width = camera_state['width']
        height = camera_state['height']
        format_applied = False
        
        if photo_format != ASI_IMG_RGB24:
            asi_lib.ASISetROIFormat(camera.camera_id, width, height, 1, photo_format)
            format_applied = True
        
        # Capture all photos
        photos = []
        print(f"[Sequence Capture] Capturing {count} photos...")
        
        for i in range(count):
            print(f"[Sequence Capture] Photo {i+1}/{count}...")
            img = camera.capture_snapshot()
            
            if img:
                # Convert to JPEG bytes
                img_io = io.BytesIO()
                img.save(img_io, 'JPEG', quality=100)
                img_io.seek(0)
                img_bytes = img_io.read()
                # Encode as base64 for JSON
                img_base64 = base64.b64encode(img_bytes).decode('utf-8')
                photos.append(img_base64)
                
                # Wait between photos (at least exposure time)
                exposure_s = camera_state['exposure'] / 1000000.0
                wait_time = max(exposure_s + 0.3, 0.5)
                if i < count - 1:  # Don't wait after last photo
                    time.sleep(wait_time)
            else:
                print(f"[Sequence Capture] Failed to capture photo {i+1}")
                photos.append(None)
        
        # Restore format if needed
        if was_streaming and format_applied:
            asi_lib.ASISetROIFormat(camera.camera_id, width, height, 1, ASI_IMG_RGB24)
            time.sleep(0.3)
        
        # Resume stream if it was running
        if was_streaming:
            print("[Sequence Capture] Resuming stream...")
            time.sleep(0.5)
            camera.start_stream()
        
        print(f"[Sequence Capture] Successfully captured {len([p for p in photos if p])}/{count} photos")
        
        return jsonify({
            'success': True,
            'count': len([p for p in photos if p]),
            'photos': photos
        })
        
    except Exception as e:
        import traceback
        error_details = traceback.format_exc()
        print(f"[Sequence Capture] Exception: {e}")
        print(f"[Sequence Capture] Traceback:\n{error_details}")
        
        # Try to resume stream if it was running
        if was_streaming and not camera.streaming:
            try:
                camera.start_stream()
            except:
                pass
        
        return jsonify({'error': f'Exception: {str(e)}'}), 500

# Bookings storage (simple JSON file-based storage)
BOOKINGS_FILE = 'bookings.json'
bookings_lock = threading.Lock()

def load_bookings():
    """Load bookings from JSON file"""
    if os.path.exists(BOOKINGS_FILE):
        try:
            with open(BOOKINGS_FILE, 'r') as f:
                return json.load(f)
        except:
            return []
    return []

def save_bookings(bookings):
    """Save bookings to JSON file"""
    with bookings_lock:
        with open(BOOKINGS_FILE, 'w') as f:
            json.dump(bookings, f, indent=2, default=str)

# Booking API Routes
@app.route('/bookings', methods=['GET'])
def get_bookings():
    """Get all bookings"""
    bookings = load_bookings()
    return jsonify(bookings)

@app.route('/bookings', methods=['POST'])
def create_booking():
    """Create a new booking"""
    data = request.get_json()
    
    if not data:
        return jsonify({'error': 'Invalid request'}), 400
    
    required_fields = ['user_name', 'start_time', 'end_time']
    for field in required_fields:
        if field not in data:
            return jsonify({'error': f'Missing required field: {field}'}), 400
    
    # Parse dates
    try:
        start_time = datetime.fromisoformat(data['start_time'].replace('Z', '+00:00'))
        end_time = datetime.fromisoformat(data['end_time'].replace('Z', '+00:00'))
    except:
        return jsonify({'error': 'Invalid date format. Use ISO 8601 format (YYYY-MM-DDTHH:MM:SS)'}), 400
    
    if end_time <= start_time:
        return jsonify({'error': 'End time must be after start time'}), 400
    
    # Check for overlaps
    bookings = load_bookings()
    new_booking = {
        'id': str(uuid4()),
        'user_name': data['user_name'],
        'start_time': data['start_time'],
        'end_time': data['end_time'],
        'notes': data.get('notes')
    }
    
    # Check overlaps
    for booking in bookings:
        existing_start = datetime.fromisoformat(booking['start_time'].replace('Z', '+00:00'))
        existing_end = datetime.fromisoformat(booking['end_time'].replace('Z', '+00:00'))
        if start_time < existing_end and end_time > existing_start:
            return jsonify({'error': 'Booking overlaps with existing booking'}), 409
    
    bookings.append(new_booking)
    save_bookings(bookings)
    return jsonify(new_booking), 201

@app.route('/bookings/<booking_id>', methods=['PUT'])
def update_booking(booking_id):
    """Update an existing booking"""
    data = request.get_json()
    
    if not data:
        return jsonify({'error': 'Invalid request'}), 400
    
    bookings = load_bookings()
    booking_index = None
    for i, booking in enumerate(bookings):
        if booking['id'] == booking_id:
            booking_index = i
            break
    
    if booking_index is None:
        return jsonify({'error': 'Booking not found'}), 404
    
    # Parse dates
    try:
        start_time = datetime.fromisoformat(data['start_time'].replace('Z', '+00:00'))
        end_time = datetime.fromisoformat(data['end_time'].replace('Z', '+00:00'))
    except:
        return jsonify({'error': 'Invalid date format. Use ISO 8601 format (YYYY-MM-DDTHH:MM:SS)'}), 400
    
    if end_time <= start_time:
        return jsonify({'error': 'End time must be after start time'}), 400
    
    # Check for overlaps (excluding self)
    for booking in bookings:
        if booking['id'] == booking_id:
            continue
        existing_start = datetime.fromisoformat(booking['start_time'].replace('Z', '+00:00'))
        existing_end = datetime.fromisoformat(booking['end_time'].replace('Z', '+00:00'))
        if start_time < existing_end and end_time > existing_start:
            return jsonify({'error': 'Booking overlaps with existing booking'}), 409
    
    # Update booking
    bookings[booking_index].update({
        'user_name': data.get('user_name', bookings[booking_index]['user_name']),
        'start_time': data['start_time'],
        'end_time': data['end_time'],
        'notes': data.get('notes', bookings[booking_index].get('notes'))
    })
    save_bookings(bookings)
    return jsonify(bookings[booking_index])

@app.route('/bookings/<booking_id>', methods=['DELETE'])
def delete_booking(booking_id):
    """Delete a booking"""
    bookings = load_bookings()
    original_count = len(bookings)
    bookings = [b for b in bookings if b['id'] != booking_id]
    
    if len(bookings) == original_count:
        return jsonify({'error': 'Booking not found'}), 404
    
    save_bookings(bookings)
    return jsonify({'success': True})

if __name__ == '__main__':
    print("Starting ASI Camera Service...")
    print("Attempting to connect to camera...")
    
    if camera.connect():
        print("Camera connected successfully!")
    else:
        print(f"Failed to connect to camera: {camera_state['error']}")
        print("Service will start anyway, you can try connecting via API")
    
    print("Starting HTTP server on port 8080...")
    app.run(host='0.0.0.0', port=8080, debug=False, threaded=True)

