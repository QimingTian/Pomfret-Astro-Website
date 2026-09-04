"""
Adaptive NINA agent poll intervals — mirrors lib/observatory-poll-schedule.ts.

Night (outside nautical dawn→dusk): poll nina-sequence every 45s.
Daytime closed window: poll every 20 minutes.
Emergency STOP while NINA runs stays at a fixed fast interval (see nina_agent.py).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import TypedDict

DAY_POLL_SECONDS = 20 * 60
NIGHT_POLL_SECONDS = 45
MIN_PHASE_WAIT_SECONDS = 60

_ZENITH_NAUTICAL = 102


@dataclass(frozen=True)
class AgentObservatorySite:
    id: str
    timezone: str
    observer_lat_deg: float
    observer_lon_deg: float


POMFRET_SITE = AgentObservatorySite(
    id="pomfret",
    timezone="America/New_York",
    observer_lat_deg=41 + 53 / 60 + 10 / 3600,
    observer_lon_deg=-(71 + 57 / 60 + 54 / 3600),
)

CYGNUS_SITE = AgentObservatorySite(
    id="cygnus",
    timezone="Europe/Amsterdam",
    observer_lat_deg=52.3547,
    observer_lon_deg=4.912,
)

_SITES: dict[str, AgentObservatorySite] = {
    "pomfret": POMFRET_SITE,
    "cygnus": CYGNUS_SITE,
}


def resolve_agent_site(site_id: str | None = None) -> AgentObservatorySite:
    key = (site_id or "pomfret").strip().lower()
    return _SITES.get(key, POMFRET_SITE)


def _deg_to_rad(deg: float) -> float:
    return deg * math.pi / 180.0


def _rad_to_deg(rad: float) -> float:
    return rad * 180.0 / math.pi


def _day_of_year_utc(dt: datetime) -> int:
    start = datetime(dt.year, 1, 1, tzinfo=timezone.utc)
    current = datetime(dt.year, dt.month, dt.day, tzinfo=timezone.utc)
    return (current - start).days + 1


def _solar_event_utc_for_date(
    anchor_utc: datetime,
    zenith_deg: float,
    is_sunrise: bool,
    lat_deg: float,
    lon_deg: float,
) -> datetime:
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

    lat_rad = _deg_to_rad(lat_deg)
    zenith_rad = _deg_to_rad(zenith_deg)
    cos_h = (math.cos(zenith_rad) - math.sin(lat_rad) * math.sin(decl)) / (
        math.cos(lat_rad) * math.cos(decl)
    )
    cos_h = max(-1.0, min(1.0, cos_h))
    hour_angle_deg = _rad_to_deg(math.acos(cos_h))

    solar_noon_min = 720 - 4 * lon_deg - eq_time
    event_min = solar_noon_min - 4 * hour_angle_deg if is_sunrise else solar_noon_min + 4 * hour_angle_deg

    midnight = datetime(anchor_utc.year, anchor_utc.month, anchor_utc.day, tzinfo=timezone.utc)
    return midnight + timedelta(minutes=event_min)


def _observatory_local_calendar_anchor_utc(now: datetime, site: AgentObservatorySite) -> datetime:
    try:
        from zoneinfo import ZoneInfo

        local = now.astimezone(ZoneInfo(site.timezone))
        return datetime(local.year, local.month, local.day, tzinfo=timezone.utc)
    except Exception:
        return datetime(now.year, now.month, now.day, tzinfo=timezone.utc)


class DaytimeClosedWindowDetail(TypedDict):
    within: bool
    nautical_dawn_utc: datetime
    nautical_dusk_utc: datetime


def get_daytime_closed_window_detail(
    now: datetime | None = None,
    site: AgentObservatorySite | None = None,
) -> DaytimeClosedWindowDetail:
    """Nautical dawn→dusk band when the observatory is in its daytime closed window."""
    site = site or POMFRET_SITE
    if now is None:
        now = datetime.now(timezone.utc)
    elif now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    else:
        now = now.astimezone(timezone.utc)

    anchor = _observatory_local_calendar_anchor_utc(now, site)
    nautical_dawn = _solar_event_utc_for_date(
        anchor, _ZENITH_NAUTICAL, True, site.observer_lat_deg, site.observer_lon_deg
    )
    nautical_dusk = _solar_event_utc_for_date(
        anchor, _ZENITH_NAUTICAL, False, site.observer_lat_deg, site.observer_lon_deg
    )
    return {
        "within": nautical_dawn <= now <= nautical_dusk,
        "nautical_dawn_utc": nautical_dawn,
        "nautical_dusk_utc": nautical_dusk,
    }


def is_observatory_night(
    now: datetime | None = None,
    site: AgentObservatorySite | None = None,
) -> bool:
    """True between nautical dusk and next nautical dawn (observatory operating night)."""
    return not get_daytime_closed_window_detail(now, site)["within"]


def seconds_until_observatory_phase_change(
    now: datetime | None = None,
    site: AgentObservatorySite | None = None,
) -> float:
    """Seconds until daytime ↔ night flip (min 60s)."""
    site = site or POMFRET_SITE
    if now is None:
        now = datetime.now(timezone.utc)
    elif now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    else:
        now = now.astimezone(timezone.utc)

    detail = get_daytime_closed_window_detail(now, site)
    dawn = detail["nautical_dawn_utc"]
    dusk = detail["nautical_dusk_utc"]
    t = now.timestamp()

    if detail["within"]:
        next_ts = dusk.timestamp()
    elif t < dawn.timestamp():
        next_ts = dawn.timestamp()
    else:
        tomorrow = now + timedelta(days=1)
        next_dawn = get_daytime_closed_window_detail(tomorrow, site)["nautical_dawn_utc"]
        next_ts = next_dawn.timestamp()

    return max(float(MIN_PHASE_WAIT_SECONDS), next_ts - t)


def agent_poll_interval_seconds(
    site: AgentObservatorySite | None = None,
    now: datetime | None = None,
) -> float:
    """Idle nina-sequence poll interval: slow by day, responsive at night."""
    site = site or POMFRET_SITE
    if is_observatory_night(now, site):
        return float(NIGHT_POLL_SECONDS)
    return float(DAY_POLL_SECONDS)
