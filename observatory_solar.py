"""
Pomfret observatory solar times (NOAA-style), aligned with lib/sunrise-window.ts.
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from typing import Tuple

# Pomfret School — match lib/target-altitude.ts
OBS_LAT_DEG = 41 + 53 / 60 + 10 / 3600
OBS_LON_DEG = -(71 + 57 / 60 + 54 / 3600)

AUTO_MODE_GAIN_DAY = 0
AUTO_MODE_GAIN_TWILIGHT = 80
AUTO_MODE_NIGHT_GAIN = 150
AUTO_MODE_START_EXPOSURE_US = 10_000  # 0.01 s — reset when entering Auto

_ZENITH_SUN = 90.833
_ZENITH_CIVIL = 96  # civil dawn / dusk (−6°)
_ZENITH_NAUTICAL = 102
_ZENITH_ASTRONOMICAL = 108


def _deg_to_rad(deg: float) -> float:
    return deg * math.pi / 180.0


def _rad_to_deg(rad: float) -> float:
    return rad * 180.0 / math.pi


def _day_of_year_utc(dt: datetime) -> int:
    start = datetime(dt.year, 1, 1, tzinfo=timezone.utc)
    current = datetime(dt.year, dt.month, dt.day, tzinfo=timezone.utc)
    return (current - start).days + 1


def solar_event_utc_for_date(anchor_utc: datetime, zenith_deg: float, is_sunrise: bool) -> datetime:
    """UTC datetime of solar event on anchor's UTC calendar day (NOAA)."""
    n = _day_of_year_utc(anchor_utc)
    gamma = (2 * math.pi / 365) * (n - 1)

    eq_time = 229.18 * (
        0.000075
        + 0.001868 * math.cos(gamma)
        - 0.032077 * math.sin(gamma)
        - 0.014615 * math.cos(2 * gamma)
        - 0.040849 * math.sin(2 * gamma)
    )

    decl = (
        0.006918
        - 0.399912 * math.cos(gamma)
        + 0.070257 * math.sin(gamma)
        - 0.006758 * math.cos(2 * gamma)
        + 0.000907 * math.sin(2 * gamma)
        - 0.002697 * math.cos(3 * gamma)
        + 0.00148 * math.sin(3 * gamma)
    )

    lat_rad = _deg_to_rad(OBS_LAT_DEG)
    zenith_rad = _deg_to_rad(zenith_deg)
    cos_h = (math.cos(zenith_rad) - math.sin(lat_rad) * math.sin(decl)) / (
        math.cos(lat_rad) * math.cos(decl)
    )
    cos_h = max(-1.0, min(1.0, cos_h))
    hour_angle_deg = _rad_to_deg(math.acos(cos_h))

    solar_noon_min = 720 - 4 * OBS_LON_DEG - eq_time
    event_min = solar_noon_min - 4 * hour_angle_deg if is_sunrise else solar_noon_min + 4 * hour_angle_deg

    midnight = datetime(anchor_utc.year, anchor_utc.month, anchor_utc.day, tzinfo=timezone.utc)
    return midnight + timedelta(minutes=event_min)


def observatory_local_calendar_anchor_utc(now: datetime) -> datetime:
    """UTC midnight for observatory America/New_York civil date of `now`."""
    try:
        from zoneinfo import ZoneInfo

        local = now.astimezone(ZoneInfo('America/New_York'))
        return datetime(local.year, local.month, local.day, tzinfo=timezone.utc)
    except Exception:
        return datetime(now.year, now.month, now.day, tzinfo=timezone.utc)


def nautical_dawn_and_astronomical_dark_utc(now: datetime) -> Tuple[datetime, datetime]:
    """Morning nautical dawn and evening astronomical dark for observatory local day of `now`."""
    anchor = observatory_local_calendar_anchor_utc(now)
    nautical_dawn = solar_event_utc_for_date(anchor, _ZENITH_NAUTICAL, is_sunrise=True)
    astronomical_dark = solar_event_utc_for_date(anchor, _ZENITH_ASTRONOMICAL, is_sunrise=False)
    return nautical_dawn, astronomical_dark


def is_auto_mode_daytime(now: datetime | None = None) -> bool:
    """Sunrise through sunset (official, gain 0)."""
    return auto_mode_target_gain(now) == AUTO_MODE_GAIN_DAY


def auto_mode_target_gain(now: datetime | None = None) -> int:
    """
    Auto mode gain by solar phase (observatory local day, America/New_York):
    - Civil dawn → sunrise: 80
    - Sunrise → sunset: 0
    - Sunset → civil dusk: 80
    - Civil dusk → next civil dawn: 150
    """
    if now is None:
        now = datetime.now(timezone.utc)
    elif now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    else:
        now = now.astimezone(timezone.utc)

    local_day = observatory_local_calendar_anchor_utc(now)
    next_day = local_day + timedelta(days=1)
    prev_day = local_day - timedelta(days=1)

    civil_dawn = solar_event_utc_for_date(local_day, _ZENITH_CIVIL, is_sunrise=True)
    sunrise = solar_event_utc_for_date(local_day, _ZENITH_SUN, is_sunrise=True)
    sunset = solar_event_utc_for_date(local_day, _ZENITH_SUN, is_sunrise=False)
    civil_dusk = solar_event_utc_for_date(local_day, _ZENITH_CIVIL, is_sunrise=False)
    civil_dusk_prev = solar_event_utc_for_date(prev_day, _ZENITH_CIVIL, is_sunrise=False)

    if civil_dawn <= now < sunrise:
        return AUTO_MODE_GAIN_TWILIGHT
    if sunrise <= now < sunset:
        return AUTO_MODE_GAIN_DAY
    if sunset <= now < civil_dusk:
        return AUTO_MODE_GAIN_TWILIGHT
    if now >= civil_dusk:
        return AUTO_MODE_NIGHT_GAIN
  # Before civil dawn: still previous night (after yesterday's civil dusk)
    if now >= civil_dusk_prev:
        return AUTO_MODE_NIGHT_GAIN
    return AUTO_MODE_NIGHT_GAIN
