"""
ASC all-sky camera cloud cover and rain inference (Teachable Machine TFJS models).
Runs on the Pi after each auto-like capture; results exposed via camera /status.
"""

from __future__ import annotations

import json
import os
import threading
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import observatory_solar as obs_solar

_MODELS_DIR = os.path.join(os.path.dirname(__file__), 'models')
_VERSION_MANIFEST = os.path.join(_MODELS_DIR, 'ASC_AI_MODEL_VERSION.json')
_IMAGE_SIZE = 224
# Top-1 softmax above this → use that class label; otherwise weighted expected cover.
_CLOUD_ARGMAX_MIN_CONFIDENCE = 0.5

_lock = threading.Lock()
_models: Dict[str, Any] = {}
_metadata: Dict[str, dict] = {}
_load_error: Optional[str] = None
_last_result: Optional[Dict[str, Any]] = None
_model_version_info: Optional[Dict[str, Any]] = None


def model_version_info() -> Dict[str, Any]:
    """ASC AI bundle version (v1, v2, …) from observatory/models/ASC_AI_MODEL_VERSION.json."""
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


def _model_dir(name: str) -> str:
    return os.path.join(_MODELS_DIR, name)


def _read_metadata(model_key: str) -> dict:
    path = os.path.join(_model_dir(model_key), 'metadata.json')
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def _load_model(key: str):
    """Load a TM model from model.json (Teachable Machine TFJS export)."""
    json_path = os.path.join(_model_dir(key), 'model.json')
    if not os.path.isfile(json_path):
        raise FileNotFoundError(f'missing model.json in {_model_dir(key)}')
    # Import loader only (Pi: patch tensorflowjs/converters/__init__.py to avoid heavy deps).
    from tensorflowjs.converters.keras_tfjs_loader import load_keras_model

    return load_keras_model(json_path)


def ensure_models_loaded() -> None:
    """Lazy-load all four TM models; records _load_error on failure."""
    global _load_error

    with _lock:
        if _models or _load_error:
            return

        try:
            import tensorflow  # noqa: F401
        except ImportError:
            _load_error = 'tensorflow is not installed (see observatory/requirements-ai.txt)'
            print(f'[ASC-AI] {_load_error}')
            return

        for key in ('Day_Cloud_Model', 'Night_Cloud_Model', 'Day_Rain_Model', 'Night_Rain_Model'):
            try:
                _metadata[key] = _read_metadata(key)
                _models[key] = _load_model(key)
                print(f'[ASC-AI] Loaded {key}')
            except Exception as e:
                _load_error = f'failed to load {key}: {e}'
                _models.clear()
                _metadata.clear()
                print(f'[ASC-AI] {_load_error}')
                return


def _preprocess(img) -> Any:
    """PIL Image → TM-compatible batch (1, 224, 224, 3) in [-1, 1].

    Matches @teachablemachine/image: center cropTo(imageSize), then capture() normalization.
    """
    import math
    import numpy as np
    from PIL import Image

    rgb = img.convert('RGB')
    width, height = rgb.size
    min_side = min(width, height)
    scale = _IMAGE_SIZE / min_side
    scaled_w = int(math.ceil(width * scale))
    scaled_h = int(math.ceil(height * scale))
    scaled = rgb.resize((scaled_w, scaled_h), Image.Resampling.BILINEAR)

    dx = scaled_w - _IMAGE_SIZE
    dy = scaled_h - _IMAGE_SIZE
    left = dx // 2
    top = dy // 2
    cropped = scaled.crop((left, top, left + _IMAGE_SIZE, top + _IMAGE_SIZE))

    arr = np.asarray(cropped, dtype=np.float32)
    arr = arr / 127.0 - 1.0
    return arr.reshape(1, _IMAGE_SIZE, _IMAGE_SIZE, 3)


def _label_to_cloud_percent(label: str) -> float:
    try:
        return float(label)
    except ValueError:
        return 0.0


def _cloud_expected_percent(probs: List[float], labels: List[str]) -> Tuple[int, float]:
    """Cloud cover: argmax label if top-1 > 50%, else probability-weighted expected %."""
    best_idx = max(range(len(probs)), key=lambda i: probs[i])
    top_conf = float(probs[best_idx])

    if top_conf > _CLOUD_ARGMAX_MIN_CONFIDENCE:
        cover = int(round(_label_to_cloud_percent(labels[best_idx])))
    else:
        total = 0.0
        weighted = 0.0
        for label, prob in zip(labels, probs):
            pct = _label_to_cloud_percent(label)
            weighted += pct * prob
            total += prob
        if total <= 0:
            cover = 0
        else:
            cover = int(round(weighted / total))

    cover = int(max(0, min(100, cover)))
    return cover, top_conf


def _rain_from_probs(probs: List[float], labels: List[str]) -> Dict[str, Any]:
    best_idx = max(range(len(probs)), key=lambda i: probs[i])
    label = labels[best_idx]
    rain_prob = 0.0
    for lbl, prob in zip(labels, probs):
        if lbl.strip().lower() == 'rain':
            rain_prob = float(prob)
            break
    return {
        'detected': label.strip().lower() == 'rain',
        'confidence': rain_prob if label.strip().lower() == 'rain' else float(probs[best_idx]),
        'label': label,
    }


def _run_model(model_key: str, batch) -> List[float]:
    import numpy as np

    preds = _models[model_key].predict(batch, verbose=0)
    return [float(x) for x in np.asarray(preds[0]).tolist()]


def analyze_frame(img, now: datetime | None = None) -> Dict[str, Any]:
    """Run cloud + rain models for the current nautical day/night phase."""
    if now is None:
        now = datetime.now(timezone.utc)
    elif now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    else:
        now = now.astimezone(timezone.utc)

    ensure_models_loaded()
    if _load_error:
        return _with_model_version({
            'cloudCoverPercent': None,
            'cloudConfidence': None,
            'modelPhase': 'day' if obs_solar.is_asc_model_daytime(now) else 'night',
            'frameIso': now.isoformat(),
            'rain': None,
            'lastError': _load_error,
        })

    daytime = obs_solar.is_asc_model_daytime(now)
    cloud_key = 'Day_Cloud_Model' if daytime else 'Night_Cloud_Model'
    rain_key = 'Day_Rain_Model' if daytime else 'Night_Rain_Model'
    phase = 'day' if daytime else 'night'

    try:
        batch = _preprocess(img)
        cloud_probs = _run_model(cloud_key, batch)
        rain_probs = _run_model(rain_key, batch)
        cloud_labels = _metadata[cloud_key].get('labels', [])
        rain_labels = _metadata[rain_key].get('labels', [])
        cover, confidence = _cloud_expected_percent(cloud_probs, cloud_labels)
        rain = _rain_from_probs(rain_probs, rain_labels)
        return _with_model_version({
            'cloudCoverPercent': cover,
            'cloudConfidence': confidence,
            'modelPhase': phase,
            'frameIso': now.isoformat(),
            'rain': rain,
            'lastError': None,
        })
    except Exception as e:
        msg = str(e)
        print(f'[ASC-AI] inference error: {msg}')
        return _with_model_version({
            'cloudCoverPercent': None,
            'cloudConfidence': None,
            'modelPhase': phase,
            'frameIso': now.isoformat(),
            'rain': None,
            'lastError': msg,
        })


def analyze_and_store(img, now: datetime | None = None) -> None:
    """Analyze frame and store latest result for /status."""
    global _last_result
    result = analyze_frame(img, now)
    with _lock:
        _last_result = result
    if result.get('lastError'):
        print(f"[ASC-AI] stored error: {result['lastError']}")
    elif result.get('cloudCoverPercent') is not None:
        print(
            f"[ASC-AI] cloud={result['cloudCoverPercent']}% "
            f"phase={result.get('modelPhase')} "
            f"rain={result.get('rain', {}).get('label')}"
        )


def status_payload() -> Optional[Dict[str, Any]]:
    """Latest inference for allSkyCam.ascCloud in /status."""
    with _lock:
        if _last_result is None:
            if _load_error:
                return _with_model_version({
                    'cloudCoverPercent': None,
                    'cloudConfidence': None,
                    'modelPhase': None,
                    'frameIso': None,
                    'rain': None,
                    'lastError': _load_error,
                })
            return None
        return _with_model_version(dict(_last_result))
