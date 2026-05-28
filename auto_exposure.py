"""
Auto exposure for server-side Auto mode: target mean RGB 45, probe + two-point log extrapolation.
"""

from __future__ import annotations

import math
from typing import Any, Dict, Optional

import numpy as np

AUTO_EXP_TARGET = 45
AUTO_EXP_HOLD_TOLERANCE = 2  # |mean − target| within this → hold (not a wide band)
AUTO_EXP_PROBE_THRESHOLD = 8  # |mean - center| → probe (moderate error)
AUTO_EXP_DIRECT_THRESHOLD = 8  # |mean - center| → skip probe, ratio step (large error)
AUTO_EXP_PROBE_RATIO = 2.0
AUTO_EXP_FINE_RATIO = 1.2
AUTO_EXP_FINE_RATIO_MIN = 1.03  # long exposures converge with smaller fine steps
AUTO_EXP_FINE_RATIO_TAU_S = 20.0  # damping time-constant for fine step sizing
AUTO_EXP_FALLBACK_RATIO = 1.5
AUTO_EXP_AGGRESSIVE_MAX_RATIO = 20.0  # cap when |mean − target| is very large
AUTO_EXP_AGGRESSIVE_MAX_RATIO_NEAR = 2.5  # cap when error is just above direct threshold
AUTO_EXP_VERY_FAR_ERR = 20  # |mean − 45| ≥ this → allow full error-based cap
AUTO_EXP_AGGRESSIVE_POWER = 0.85  # (target/mean)^power — sub-linear when moderately off
AUTO_EXP_EXPOSURE_TAU_S = 2.0  # dampen per-step ratio when exposure is already long (seconds)
AUTO_EXP_MIN_BRIGHTNESS_DELTA = 0.5
AUTO_EXP_SAT_THRESHOLD = 250
AUTO_EXP_CLIP_ONLY_DECREASE = 0.03
PHOTO_EXP_MIN_US = 32
PHOTO_EXP_MAX_US = 300_000_000
AUTO_EXP_GAIN_STEP = 15


class AutoExposureController:
    """Stateful controller: probe frame then extrapolate; fine steps near target."""

    def __init__(self) -> None:
        self.reset()

    def reset(self) -> None:
        self.probe_pending = False
        self.probe_e0_us = 0
        self.probe_b0 = 0.0

    def _clamp_exp(self, us: int, exp_min: int, exp_max: int) -> int:
        return max(exp_min, min(exp_max, int(us)))

    def _max_ratio_for_error(self, abs_err: float) -> float:
        """Larger brightness error → larger allowed per-frame exposure multiply."""
        if abs_err >= AUTO_EXP_VERY_FAR_ERR:
            return AUTO_EXP_AGGRESSIVE_MAX_RATIO
        if abs_err <= AUTO_EXP_DIRECT_THRESHOLD:
            return AUTO_EXP_AGGRESSIVE_MAX_RATIO_NEAR
        span = AUTO_EXP_VERY_FAR_ERR - AUTO_EXP_DIRECT_THRESHOLD
        t = (abs_err - AUTO_EXP_DIRECT_THRESHOLD) / span
        return AUTO_EXP_AGGRESSIVE_MAX_RATIO_NEAR + t * (
            AUTO_EXP_AGGRESSIVE_MAX_RATIO - AUTO_EXP_AGGRESSIVE_MAX_RATIO_NEAR
        )

    def _max_ratio_for_step(self, abs_err: float, exposure_us: int) -> float:
        """
        Error sets the ceiling; long exposures get a smaller per-step ratio
        (e.g. 0.001 s can jump ×20, 25 s only ~×2–3).
        """
        err_cap = self._max_ratio_for_error(abs_err)
        exp_s = max(exposure_us / 1e6, 1e-6)
        damp = 1.0 + exp_s / AUTO_EXP_EXPOSURE_TAU_S
        return max(AUTO_EXP_FINE_RATIO, 1.0 + (err_cap - 1.0) / damp)

    def _direct_boost_factor(self, mean_rgb: float, brighten: bool, exposure_us: int) -> float:
        target = float(AUTO_EXP_TARGET)
        mean_safe = max(mean_rgb, 1.0)
        abs_err = abs(mean_rgb - target)
        max_ratio = self._max_ratio_for_step(abs_err, exposure_us)

        if brighten:
            est = (target / mean_safe) ** AUTO_EXP_AGGRESSIVE_POWER
            return max(AUTO_EXP_FINE_RATIO, min(max_ratio, est))

        est = (target / mean_safe) ** AUTO_EXP_AGGRESSIVE_POWER
        return max(1.0 / max_ratio, min(1.0 / AUTO_EXP_FINE_RATIO, est))

    def _direct_ratio_step(
        self,
        mean_rgb: float,
        clip_high: bool,
        exposure_us: int,
        gain: int,
        gain_min: int,
        gain_max: int,
        exp_min: int,
        exp_max: int,
    ) -> Optional[Dict[str, Any]]:
        """Single-frame step from mean vs target (for large error; avoids slow probe fallback)."""
        if clip_high or mean_rgb > AUTO_EXP_TARGET + AUTO_EXP_HOLD_TOLERANCE:
            factor = self._direct_boost_factor(mean_rgb, brighten=False, exposure_us=exposure_us)
            if exposure_us > exp_min:
                new_exp = self._clamp_exp(int(round(exposure_us * factor)), exp_min, exp_max)
                if new_exp < exposure_us:
                    return {
                        'exposure_us': new_exp,
                        'gain': gain,
                        'action': 'exp_down',
                        'reason': f'direct mean={mean_rgb:.1f} ×{factor:.2f}',
                    }
            if gain > gain_min:
                step = max(1, min(AUTO_EXP_GAIN_STEP, gain - gain_min))
                return {
                    'exposure_us': exposure_us,
                    'gain': gain - step,
                    'action': 'gain_down',
                    'reason': f'direct mean={mean_rgb:.1f} exp floor',
                }
            return None

        if mean_rgb < AUTO_EXP_TARGET - AUTO_EXP_HOLD_TOLERANCE:
            factor = self._direct_boost_factor(mean_rgb, brighten=True, exposure_us=exposure_us)
            if exposure_us < exp_max:
                new_exp = self._clamp_exp(int(round(exposure_us * factor)), exp_min, exp_max)
                if new_exp > exposure_us:
                    return {
                        'exposure_us': new_exp,
                        'gain': gain,
                        'action': 'exp_up',
                        'reason': f'direct mean={mean_rgb:.1f} ×{factor:.2f}',
                    }
            if gain < gain_max:
                step = max(1, min(AUTO_EXP_GAIN_STEP, gain_max - gain))
                return {
                    'exposure_us': exposure_us,
                    'gain': gain + step,
                    'action': 'gain_up',
                    'reason': f'direct mean={mean_rgb:.1f} exp ceiling',
                }
            return None

        return None

    def _log_exp_us(self, exposure_us: int) -> float:
        return math.log(max(exposure_us, 1))

    def _fine_ratio_for_exposure(self, exposure_us: int) -> float:
        """
        Exposure-aware fine-step ratio:
        short exposures keep faster response (~1.2), long exposures damp toward ~1.03.
        """
        exp_s = max(exposure_us / 1e6, 1e-6)
        damp = 1.0 + exp_s / AUTO_EXP_FINE_RATIO_TAU_S
        return max(
            AUTO_EXP_FINE_RATIO_MIN,
            1.0 + (AUTO_EXP_FINE_RATIO - 1.0) / damp,
        )

    def _fine_step(
        self,
        mean_rgb: float,
        clip_high: bool,
        exposure_us: int,
        gain: int,
        gain_min: int,
        gain_max: int,
        exp_min: int,
        exp_max: int,
    ) -> Optional[Dict[str, Any]]:
        fine_ratio = self._fine_ratio_for_exposure(exposure_us)
        if mean_rgb > AUTO_EXP_TARGET + AUTO_EXP_HOLD_TOLERANCE or clip_high:
            if exposure_us > exp_min:
                new_exp = self._clamp_exp(int(round(exposure_us / fine_ratio)), exp_min, exp_max)
                if new_exp < exposure_us:
                    return {
                        'exposure_us': new_exp,
                        'gain': gain,
                        'action': 'exp_down',
                        'reason': f'fine mean={mean_rgb:.1f}',
                    }
            if gain > gain_min:
                step = max(1, min(AUTO_EXP_GAIN_STEP, gain - gain_min))
                return {
                    'exposure_us': exposure_us,
                    'gain': gain - step,
                    'action': 'gain_down',
                    'reason': f'fine mean={mean_rgb:.1f} exp floor',
                }
            return None

        if mean_rgb < AUTO_EXP_TARGET - AUTO_EXP_HOLD_TOLERANCE:
            if exposure_us < exp_max:
                new_exp = self._clamp_exp(int(round(exposure_us * fine_ratio)), exp_min, exp_max)
                if new_exp > exposure_us:
                    return {
                        'exposure_us': new_exp,
                        'gain': gain,
                        'action': 'exp_up',
                        'reason': f'fine mean={mean_rgb:.1f}',
                    }
            if gain < gain_max:
                step = max(1, min(AUTO_EXP_GAIN_STEP, gain_max - gain))
                return {
                    'exposure_us': exposure_us,
                    'gain': gain + step,
                    'action': 'gain_up',
                    'reason': f'fine mean={mean_rgb:.1f} exp ceiling',
                }
            return None

        return None

    def _fallback_step(
        self,
        mean_rgb: float,
        clip_high: bool,
        exposure_us: int,
        gain: int,
        gain_min: int,
        gain_max: int,
        exp_min: int,
        exp_max: int,
    ) -> Optional[Dict[str, Any]]:
        ratio = AUTO_EXP_FALLBACK_RATIO
        if mean_rgb > AUTO_EXP_TARGET + AUTO_EXP_HOLD_TOLERANCE or clip_high:
            if exposure_us > exp_min:
                new_exp = self._clamp_exp(int(round(exposure_us / ratio)), exp_min, exp_max)
                if new_exp < exposure_us:
                    return {
                        'exposure_us': new_exp,
                        'gain': gain,
                        'action': 'exp_down',
                        'reason': f'fallback mean={mean_rgb:.1f}',
                    }
        elif mean_rgb < AUTO_EXP_TARGET - AUTO_EXP_HOLD_TOLERANCE:
            if exposure_us < exp_max:
                new_exp = self._clamp_exp(int(round(exposure_us * ratio)), exp_min, exp_max)
                if new_exp > exposure_us:
                    return {
                        'exposure_us': new_exp,
                        'gain': gain,
                        'action': 'exp_up',
                        'reason': f'fallback mean={mean_rgb:.1f}',
                    }
        return self._fine_step(mean_rgb, clip_high, exposure_us, gain, gain_min, gain_max, exp_min, exp_max)

    def _complete_probe(
        self,
        mean_rgb: float,
        exposure_us: int,
        gain: int,
        gain_min: int,
        gain_max: int,
        exp_min: int,
        exp_max: int,
    ) -> Optional[Dict[str, Any]]:
        e0 = self.probe_e0_us
        b0 = self.probe_b0
        e1 = exposure_us
        b1 = mean_rgb
        self.probe_pending = False

        db = b1 - b0
        de_log = self._log_exp_us(e1) - self._log_exp_us(e0)

        if abs(db) < AUTO_EXP_MIN_BRIGHTNESS_DELTA or abs(de_log) < 0.02:
            direct = self._direct_ratio_step(b1, False, e1, gain, gain_min, gain_max, exp_min, exp_max)
            if direct is not None:
                return direct
            return self._fallback_step(b1, False, e1, gain, gain_min, gain_max, exp_min, exp_max)

        log_target = self._log_exp_us(e1) + de_log * ((AUTO_EXP_TARGET - b1) / db)
        new_exp = self._clamp_exp(int(round(math.exp(log_target))), exp_min, exp_max)

        if new_exp == e1:
            return self._fine_step(b1, False, e1, gain, gain_min, gain_max, exp_min, exp_max)

        action = 'extrapolate_up' if new_exp > e1 else 'extrapolate_down'
        return {
            'exposure_us': new_exp,
            'gain': gain,
            'action': action,
            'reason': f'probe b0={b0:.1f}@{e0/1e6:.4f}s b1={b1:.1f}@{e1/1e6:.4f}s → target~{AUTO_EXP_TARGET}',
        }

    def _start_probe(
        self,
        mean_rgb: float,
        exposure_us: int,
        gain: int,
        exp_min: int,
        exp_max: int,
        brighten: bool,
    ) -> Dict[str, Any]:
        self.probe_e0_us = exposure_us
        self.probe_b0 = mean_rgb
        self.probe_pending = True
        if brighten:
            probe_exp = self._clamp_exp(int(round(exposure_us * AUTO_EXP_PROBE_RATIO)), exp_min, exp_max)
            action = 'probe_up'
        else:
            probe_exp = self._clamp_exp(int(round(exposure_us / AUTO_EXP_PROBE_RATIO)), exp_min, exp_max)
            action = 'probe_down'
        if probe_exp == exposure_us:
            probe_exp = self._clamp_exp(
                int(round(exposure_us * (AUTO_EXP_PROBE_RATIO if brighten else 1 / AUTO_EXP_FINE_RATIO))),
                exp_min,
                exp_max,
            )
        return {
            'exposure_us': probe_exp,
            'gain': gain,
            'action': action,
            'reason': f'probe from mean={mean_rgb:.1f} exp={exposure_us/1e6:.4f}s',
        }

    def decide(
        self,
        mean_rgb: float,
        clip_white_pct: float,
        exposure_us: int,
        gain: int,
        gain_min: int,
        gain_max: int,
        exposure_min_us: int = PHOTO_EXP_MIN_US,
        exposure_max_us: int = PHOTO_EXP_MAX_US,
    ) -> Optional[Dict[str, Any]]:
        exp_min = max(PHOTO_EXP_MIN_US, int(exposure_min_us))
        exp_max = min(PHOTO_EXP_MAX_US, int(exposure_max_us))
        exposure_us = self._clamp_exp(int(exposure_us), exp_min, exp_max)
        gain = max(gain_min, min(gain_max, int(gain)))

        clip_high = clip_white_pct > AUTO_EXP_CLIP_ONLY_DECREASE
        on_target = (
            not clip_high and abs(mean_rgb - AUTO_EXP_TARGET) <= AUTO_EXP_HOLD_TOLERANCE
        )

        if self.probe_pending:
            return self._complete_probe(mean_rgb, exposure_us, gain, gain_min, gain_max, exp_min, exp_max)

        if on_target:
            return None

        err = mean_rgb - AUTO_EXP_TARGET
        abs_err = abs(err)
        far = abs_err > AUTO_EXP_PROBE_THRESHOLD
        very_far = abs_err > AUTO_EXP_DIRECT_THRESHOLD
        brighten = mean_rgb < AUTO_EXP_TARGET - AUTO_EXP_HOLD_TOLERANCE and not clip_high

        if clip_high or mean_rgb > AUTO_EXP_TARGET + AUTO_EXP_HOLD_TOLERANCE:
            if very_far:
                direct = self._direct_ratio_step(
                    mean_rgb, clip_high, exposure_us, gain, gain_min, gain_max, exp_min, exp_max
                )
                if direct is not None:
                    return direct
            if far and exposure_us > exp_min:
                return self._start_probe(mean_rgb, exposure_us, gain, exp_min, exp_max, brighten=False)
            return self._fine_step(mean_rgb, clip_high, exposure_us, gain, gain_min, gain_max, exp_min, exp_max)

        if mean_rgb < AUTO_EXP_TARGET - AUTO_EXP_HOLD_TOLERANCE:
            if very_far:
                direct = self._direct_ratio_step(
                    mean_rgb, clip_high, exposure_us, gain, gain_min, gain_max, exp_min, exp_max
                )
                if direct is not None:
                    return direct
            if far and exposure_us < exp_max:
                return self._start_probe(mean_rgb, exposure_us, gain, exp_min, exp_max, brighten=True)
            return self._fine_step(mean_rgb, clip_high, exposure_us, gain, gain_min, gain_max, exp_min, exp_max)

        return self._fine_step(mean_rgb, clip_high, exposure_us, gain, gain_min, gain_max, exp_min, exp_max)


# Module-level controller used by camera_service
_controller = AutoExposureController()


def reset_auto_exposure() -> None:
    _controller.reset()


def compute_brightness_mean(img) -> Dict[str, Any]:
    """Return mean (R+G+B)/3 excluding saturated pixels (max channel >= threshold)."""
    rgb = np.asarray(img.convert('RGB'))
    r = rgb[:, :, 0].astype(np.float64)
    g = rgb[:, :, 1].astype(np.float64)
    b = rgb[:, :, 2].astype(np.float64)
    mx = np.maximum(np.maximum(r, g), b)
    valid = mx < AUTO_EXP_SAT_THRESHOLD
    n_valid = int(valid.sum())
    total = r.size
    if n_valid == 0:
        mean_r = float(r.mean())
        mean_g = float(g.mean())
        mean_b = float(b.mean())
        mean_rgb = float((mean_r + mean_g + mean_b) / 3.0)
    else:
        mean_r = float(r[valid].mean())
        mean_g = float(g[valid].mean())
        mean_b = float(b[valid].mean())
        mean_rgb = float(((r[valid] + g[valid] + b[valid]) / 3.0).mean())
    lum = 0.299 * r + 0.587 * g + 0.114 * b
    clip_white_pct = float((lum >= 255).sum() / total) if total else 0.0
    return {
        'mean_rgb': mean_rgb,
        'mean_r': mean_r,
        'mean_g': mean_g,
        'mean_b': mean_b,
        'clip_white_pct': clip_white_pct,
        'pixel_count': total,
        'valid_pixel_count': n_valid,
        'valid_pixel_frac': (n_valid / total) if total else 0.0,
    }


def decide_auto_exposure_adjustment(
    mean_rgb: float,
    clip_white_pct: float,
    exposure_us: int,
    gain: int,
    gain_min: int,
    gain_max: int,
    exposure_min_us: int = PHOTO_EXP_MIN_US,
    exposure_max_us: int = PHOTO_EXP_MAX_US,
) -> Optional[Dict[str, Any]]:
    return _controller.decide(
        mean_rgb,
        clip_white_pct,
        exposure_us,
        gain,
        gain_min,
        gain_max,
        exposure_min_us,
        exposure_max_us,
    )
