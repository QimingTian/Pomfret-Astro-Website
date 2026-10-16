"""
ASC all-sky camera sky + rain inference (ASC AI v2, PyTorch ResNet18 ensemble).

Outputs clear/cloudy + rain for /camera/status → allSkyCam.ascCloud.
Ready gate (cloud): sky == clear. Rain gate unchanged (detected → block).
"""

from __future__ import annotations

import json
import os
import threading
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import observatory_solar as obs_solar

_MODELS_DIR = os.path.join(os.path.dirname(__file__), 'models')
_VERSION_MANIFEST = os.path.join(_MODELS_DIR, 'ASC_AI_MODEL_VERSION.json')
_V2_DIR = os.path.join(_MODELS_DIR, 'ASC_AI_v2')
_ENSEMBLE_CONFIG = os.path.join(_V2_DIR, 'ensemble_config_multiview.json')
_NORMALIZE_MEAN = [0.485, 0.456, 0.406]
_NORMALIZE_STD = [0.229, 0.224, 0.225]

_lock = threading.Lock()
_models: list[tuple[float, Any, str]] = []
_transforms: Dict[str, Any] = {}
_device: Any = None
_load_error: Optional[str] = None
_last_result: Optional[Dict[str, Any]] = None
_model_version_info: Optional[Dict[str, Any]] = None


def model_version_info() -> Dict[str, Any]:
    """ASC AI bundle version from observatory/models/ASC_AI_MODEL_VERSION.json."""
    global _model_version_info
    if _model_version_info is not None:
        return dict(_model_version_info)
    fallback = {'version': 'unknown', 'label': 'ASC AI Model (version manifest missing)'}
    try:
        with open(_VERSION_MANIFEST, 'r', encoding='utf-8') as f:
            data = json.load(f)
        _model_version_info = {
            'version': data.get('version', 'unknown'),
            'label': data.get('label', data.get('version', 'unknown')),
            'released': data.get('released'),
        }
    except OSError:
        _model_version_info = fallback
    except json.JSONDecodeError:
        _model_version_info = fallback
    return dict(_model_version_info)


def _with_model_version(payload: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(payload)
    out['modelVersion'] = model_version_info()
    return out


def _empty_payload(
    *,
    phase: Optional[str],
    frame_iso: Optional[str],
    last_error: Optional[str],
    stale: bool = False,
    stale_reason: Optional[str] = None,
) -> Dict[str, Any]:
    body: Dict[str, Any] = {
        'sky': None,
        'skyConfidence': None,
        'skyProbs': None,
        'modelPhase': phase,
        'frameIso': frame_iso,
        'rain': None,
        'lastError': last_error,
    }
    if stale:
        body['stale'] = True
        body['staleReason'] = stale_reason
    return _with_model_version(body)


def _build_model():  # type: ignore[no-untyped-def]
    import torch.nn as nn
    from torchvision import models

    class _Net(nn.Module):
        def __init__(self) -> None:
            super().__init__()
            backbone = models.resnet18(weights=None)
            in_f = backbone.fc.in_features
            backbone.fc = nn.Identity()
            self.backbone = backbone
            self.sky_head = nn.Linear(in_f, 2)
            self.rain_head = nn.Linear(in_f, 2)

        def forward(self, x):  # type: ignore[no-untyped-def]
            f = self.backbone(x)
            return self.sky_head(f), self.rain_head(f)

    return _Net()


def ensure_models_loaded() -> None:
    """Lazy-load the V2 ensemble; records _load_error on failure."""
    global _models, _transforms, _device, _load_error

    with _lock:
        if _models or _load_error:
            return

        try:
            import torch
        except ImportError:
            _load_error = 'torch is not installed (see observatory/requirements-ai.txt)'
            print(f'[ASC-AI] {_load_error}')
            return

        if not os.path.isfile(_ENSEMBLE_CONFIG):
            _load_error = f'missing ensemble config: {_ENSEMBLE_CONFIG}'
            print(f'[ASC-AI] {_load_error}')
            return

        try:
            from torchvision import transforms

            device = torch.device('cpu')
            with open(_ENSEMBLE_CONFIG, 'r', encoding='utf-8') as f:
                config = json.load(f)

            loaded_models: list[tuple[float, Any, str]] = []
            for member in config['members']:
                preprocess = member.get('preprocess', 'center_crop')
                if preprocess not in {'center_crop', 'full_frame'}:
                    raise ValueError(f'unsupported preprocess: {preprocess}')
                checkpoint_path = os.path.join(_V2_DIR, member['checkpoint'])
                if not os.path.isfile(checkpoint_path):
                    raise FileNotFoundError(f'missing checkpoint: {checkpoint_path}')
                net = _build_model()
                ckpt = torch.load(checkpoint_path, map_location=device, weights_only=False)
                state = ckpt['model'] if isinstance(ckpt, dict) and 'model' in ckpt else ckpt
                net.load_state_dict(state)
                net.eval()
                loaded_models.append((float(member['weight']), net, preprocess))

            if not loaded_models or abs(sum(weight for weight, _, _ in loaded_models) - 1.0) > 1e-6:
                raise ValueError('ensemble must contain models whose weights sum to 1')

            normalize = transforms.Normalize(mean=_NORMALIZE_MEAN, std=_NORMALIZE_STD)
            loaded_transforms = {
                'center_crop': transforms.Compose(
                    [transforms.Resize(256), transforms.CenterCrop(224), transforms.ToTensor(), normalize]
                ),
                'full_frame': transforms.Compose(
                    [
                        transforms.Resize((216, 384), interpolation=transforms.InterpolationMode.BICUBIC),
                        transforms.ToTensor(),
                        normalize,
                    ]
                ),
            }
            _models = loaded_models
            _transforms = loaded_transforms
            _device = device
            print(f'[ASC-AI] Loaded ASC AI v2 ensemble with {len(_models)} models')
        except Exception as e:
            _load_error = f'failed to load ASC AI v2: {e}'
            _models = []
            _transforms = {}
            _device = None
            print(f'[ASC-AI] {_load_error}')


def analyze_frame(img, now: datetime | None = None) -> Dict[str, Any]:
    """Run sky + rain heads; return clear/cloudy + rain payload."""
    import torch

    if now is None:
        now = datetime.now(timezone.utc)
    elif now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    else:
        now = now.astimezone(timezone.utc)

    phase = 'day' if obs_solar.is_asc_model_daytime(now) else 'night'
    frame_iso = now.isoformat()

    ensure_models_loaded()
    if _load_error or not _models or _device is None:
        return _empty_payload(phase=phase, frame_iso=frame_iso, last_error=_load_error)

    try:
        rgb = img.convert('RGB')
        inputs = {
            preprocess: _transforms[preprocess](rgb).unsqueeze(0).to(_device)
            for _, _, preprocess in _models
        }
        cloudy_p = 0.0
        rain_true_p = 0.0
        with torch.inference_mode():
            for weight, model, preprocess in _models:
                sky_logits, rain_logits = model(inputs[preprocess])
                cloudy_p += weight * float(torch.softmax(sky_logits, 1)[0, 1])
                rain_true_p += weight * float(torch.softmax(rain_logits, 1)[0, 1])

        clear_p = 1.0 - cloudy_p
        no_rain_p = 1.0 - rain_true_p

        sky = 'clear' if clear_p >= cloudy_p else 'cloudy'
        sky_conf = clear_p if sky == 'clear' else cloudy_p
        rain_detected = rain_true_p >= no_rain_p
        rain = {
            'detected': rain_detected,
            'confidence': rain_true_p if rain_detected else no_rain_p,
            'label': 'Rain' if rain_detected else 'No Rain',
        }

        return _with_model_version(
            {
                'sky': sky,
                'skyConfidence': sky_conf,
                'skyProbs': {'clear': clear_p, 'cloudy': cloudy_p},
                'modelPhase': phase,
                'frameIso': frame_iso,
                'rain': rain,
                'lastError': None,
            }
        )
    except Exception as e:
        msg = str(e)
        print(f'[ASC-AI] inference error: {msg}')
        return _empty_payload(phase=phase, frame_iso=frame_iso, last_error=msg)


def analyze_and_store(img, now: datetime | None = None) -> None:
    """Analyze frame and store latest result for /status."""
    global _last_result
    result = analyze_frame(img, now)
    with _lock:
        _last_result = result
    if result.get('lastError'):
        print(f"[ASC-AI] stored error: {result['lastError']}")
    elif result.get('sky') is not None:
        print(
            f"[ASC-AI] sky={result['sky']} "
            f"conf={result.get('skyConfidence')} "
            f"phase={result.get('modelPhase')} "
            f"rain={result.get('rain', {}).get('label')}"
        )


def status_payload(sequence_active: bool = False) -> Optional[Dict[str, Any]]:
    """Latest inference for allSkyCam.ascCloud in /status."""
    if sequence_active:
        return _empty_payload(
            phase=None,
            frame_iso=None,
            last_error=None,
            stale=True,
            stale_reason='sequence_active',
        )
    with _lock:
        if _last_result is None:
            if _load_error:
                return _empty_payload(phase=None, frame_iso=None, last_error=_load_error)
            return None
        return _with_model_version(dict(_last_result))
