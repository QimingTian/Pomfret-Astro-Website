"""Per-frame auto white balance for all-sky auto mode — align R/B channel means to G."""

from typing import Any, Dict, Optional

AUTO_WB_R_START = 50
AUTO_WB_B_START = 70
AUTO_WB_STEP = 3
AUTO_WB_DEADBAND = 2.0  # |channel - G| within this → no WB change (balanced enough)
AUTO_WB_MIN = 0
AUTO_WB_MAX = 100
# Skip when highlights dominate (channel means are unreliable)
AUTO_WB_MAX_CLIP_PCT = 0.15
AUTO_WB_MIN_VALID_FRAC = 0.05
AUTO_WB_MIN_G_MEAN = 0.5


def decide_auto_white_balance_adjustment(
    mean_r: float,
    mean_g: float,
    mean_b: float,
    wb_r: int,
    wb_b: int,
    clip_white_pct: float = 0.0,
    valid_pixel_frac: float = 1.0,
) -> Optional[Dict[str, Any]]:
    """
    Step wb_r / wb_b by AUTO_WB_STEP so R and B means move toward G.
    Higher wb_r/wb_b increases that channel in the frame (ASI manual WB).
    """
    if clip_white_pct > AUTO_WB_MAX_CLIP_PCT:
        return None
    if valid_pixel_frac < AUTO_WB_MIN_VALID_FRAC:
        return None
    if mean_g < AUTO_WB_MIN_G_MEAN:
        return None

    wb_r = int(wb_r)
    wb_b = int(wb_b)
    new_r, new_b = wb_r, wb_b
    parts = []

    r_diff = mean_r - mean_g
    if r_diff > AUTO_WB_DEADBAND:
        new_r = max(AUTO_WB_MIN, wb_r - AUTO_WB_STEP)
        if new_r != wb_r:
            parts.append(f'R high ({mean_r:.1f}>{mean_g:.1f}) wb_r-{AUTO_WB_STEP}')
    elif r_diff < -AUTO_WB_DEADBAND:
        new_r = min(AUTO_WB_MAX, wb_r + AUTO_WB_STEP)
        if new_r != wb_r:
            parts.append(f'R low ({mean_r:.1f}<{mean_g:.1f}) wb_r+{AUTO_WB_STEP}')

    b_diff = mean_b - mean_g
    if b_diff > AUTO_WB_DEADBAND:
        new_b = max(AUTO_WB_MIN, wb_b - AUTO_WB_STEP)
        if new_b != wb_b:
            parts.append(f'B high ({mean_b:.1f}>{mean_g:.1f}) wb_b-{AUTO_WB_STEP}')
    elif b_diff < -AUTO_WB_DEADBAND:
        new_b = min(AUTO_WB_MAX, wb_b + AUTO_WB_STEP)
        if new_b != wb_b:
            parts.append(f'B low ({mean_b:.1f}<{mean_g:.1f}) wb_b+{AUTO_WB_STEP}')

    if new_r == wb_r and new_b == wb_b:
        return None

    return {
        'wb_r': new_r,
        'wb_b': new_b,
        'action': 'wb_adjust',
        'reason': '; '.join(parts),
        'mean_r': mean_r,
        'mean_g': mean_g,
        'mean_b': mean_b,
    }
