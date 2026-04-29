#!/usr/bin/env python3
"""
Outputs two PNGs:

1) Light curve only — two photometric periods (no altitude).
2) Tonight at Pomfret — civil night (~sun −6° dusk→dawn US/Eastern): altitude + magnitude.

Catalog: index.csv (Star Name, RA/Dec sexagesimal, Period (d), Min/Max Mag).

Without a photometry file, magnitude is a simple sinusoid between catalog Min/Max Mag.
Use --mag-csv for real JD + magnitude columns.

Example:
  python plot_variable_star.py "DX And"
  python plot_variable_star.py "FN And" --period-days 1.5
  python plot_variable_star.py "Z And" --mag-csv my_obs.csv --mag-time-col jd --mag-mag-col mag
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import warnings
from pathlib import Path
from zoneinfo import ZoneInfo

# Writable caches when ~/.matplotlib or ~/.astropy are not writable (CI, sandboxes).
_repo = Path(__file__).resolve().parent
_mpl_cfg = _repo / ".mplconfig"
_mpl_cfg.mkdir(parents=True, exist_ok=True)
os.environ.setdefault("MPLCONFIGDIR", str(_mpl_cfg))
_astro_cache = _repo / ".astropy_cache"
_astro_cache.mkdir(parents=True, exist_ok=True)
os.environ.setdefault("ASTROPY_CACHE_DIR", str(_astro_cache))

import matplotlib.dates as mdates
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
import numpy as np
import pandas as pd
from astropy import units as u
from astropy.coordinates import AltAz, EarthLocation, SkyCoord, get_sun
from astropy.time import Time
from astropy.utils.exceptions import AstropyWarning

try:
    from erfa import ErfaWarning
except ImportError:
    ErfaWarning = None  # type: ignore[misc, assignment]

# Pomfret School, Pomfret CT (campus approximate; geodetic WGS84)
POMFRET_LOCATION = EarthLocation.from_geodetic(
    lon=-71.9610 * u.deg,
    lat=41.8674 * u.deg,
    height=180 * u.m,
)
# Local civil time for axes / “tonight”
POMFRET_TZ = ZoneInfo("America/New_York")
CIVIL_ALT_DEG = -6.0
# Tonight plot: shade while star altitude ≥ this (degrees)
ALT_FILL_THRESHOLD_DEG = 30.0


def _parse_catalog_float(s: str) -> float | None:
    """Extract leading float from strings like '17.6 V' or 'None V'."""
    if s is None or (isinstance(s, float) and np.isnan(s)):
        return None
    s = str(s).strip()
    m = re.match(r"^([+-]?\d*\.?\d+(?:[eE][+-]?\d+)?)", s)
    if not m:
        return None
    try:
        return float(m.group(1))
    except ValueError:
        return None


def _parse_period_days(raw) -> float | None:
    if raw is None or (isinstance(raw, float) and np.isnan(raw)):
        return None
    s = str(raw).strip()
    if not s or s.lower() == "none":
        return None
    try:
        return float(s)
    except ValueError:
        return None


def load_star_row(csv_path: Path, star_query: str) -> pd.Series:
    df = pd.read_csv(csv_path, dtype=str, keep_default_na=False)
    if "Star Name" not in df.columns:
        sys.exit(f"CSV missing 'Star Name' column: {csv_path}")

    q = star_query.strip().lower()
    mask = df["Star Name"].str.strip().str.lower() == q
    if not mask.any():
        partial = df[df["Star Name"].str.strip().str.lower().str.contains(re.escape(q), na=False)]
        if len(partial) == 1:
            return partial.iloc[0]
        if len(partial) > 1:
            names = partial["Star Name"].head(15).tolist()
            sys.exit(
                "Ambiguous name; matches:\n  "
                + "\n  ".join(names)
                + ("\n  ..." if len(partial) > 15 else "")
            )
        sys.exit(f"No star named '{star_query}' in {csv_path}")
    return df.loc[mask].iloc[0]


def row_to_skycoord(row: pd.Series) -> SkyCoord:
    ra = str(row["RA (J2000.0)"]).strip()
    dec = str(row["Dec (J2000.0)"]).strip()
    return SkyCoord(f"{ra} {dec}", unit=(u.hourangle, u.deg), frame="icrs")


def _time_to_matplotlib_dates(times: Time) -> np.ndarray:
    """Convert astropy Time to matplotlib day numbers (UTC).

    Uses ``plot_date`` so we avoid ``to_datetime()`` (slow for huge arrays and can
    trip ERFA leap-second tables far in the future / odd combos with cutting-edge Python).
    """
    mpl_days = times.plot_date
    return np.atleast_1d(np.asarray(mpl_days, dtype=float))


def _interp_crossing_jd(jd0: float, jd1: float, alt0: float, alt1: float, threshold: float) -> float:
    """Linear interpolation JD where altitude crosses ``threshold``."""
    if alt1 == alt0:
        return 0.5 * (jd0 + jd1)
    t = (threshold - alt0) / (alt1 - alt0)
    return jd0 + t * (jd1 - jd0)


def sun_altitudes_deg(location: EarthLocation, times: Time) -> np.ndarray:
    sun = get_sun(times)
    altaz_frame = AltAz(obstime=times, location=location)
    with warnings.catch_warnings():
        if ErfaWarning is not None:
            warnings.simplefilter("ignore", ErfaWarning)
        warnings.simplefilter("ignore", AstropyWarning)
        sun_aa = sun.transform_to(altaz_frame)
    return sun_aa.alt.deg


def civil_twilight_night(location: EarthLocation, t_ref: Time) -> tuple[Time, Time]:
    """
    Evening civil dusk (−6° descent) through morning civil dawn (−6° ascent).
    Chooses the night that contains ``t_ref``, or if daytime, the **next** night after dusk.
    """
    step = 8 * u.minute
    span_back = 48 * u.hour
    span_fwd = 96 * u.hour
    total_h = (span_back + span_fwd).to(u.hour).value
    step_h = step.to(u.hour).value
    n_blocks = int(total_h / step_h) + 4
    # Uniform JD samples (scalar obstime arrays supported by astropy get_sun/transform)
    jd_start = (t_ref - span_back).jd
    jd_end = (t_ref + span_fwd).jd
    jd_grid = np.linspace(jd_start, jd_end, min(max(n_blocks, 500), 8000))
    tt = Time(jd_grid, format="jd", scale="utc")
    alt = sun_altitudes_deg(location, tt)

    dusk_jds: list[float] = []
    dawn_jds: list[float] = []
    for i in range(len(jd_grid) - 1):
        a0, a1 = alt[i], alt[i + 1]
        j0, j1 = jd_grid[i], jd_grid[i + 1]
        # Evening: crosses downward through −6°
        if a0 >= CIVIL_ALT_DEG and a1 < CIVIL_ALT_DEG:
            dusk_jds.append(_interp_crossing_jd(j0, j1, a0, a1, CIVIL_ALT_DEG))
        # Morning: crosses upward through −6°
        if a0 < CIVIL_ALT_DEG and a1 >= CIVIL_ALT_DEG:
            dawn_jds.append(_interp_crossing_jd(j0, j1, a0, a1, CIVIL_ALT_DEG))

    nights: list[tuple[float, float]] = []
    i_dawn = 0
    for dj in dusk_jds:
        while i_dawn < len(dawn_jds) and dawn_jds[i_dawn] <= dj:
            i_dawn += 1
        if i_dawn < len(dawn_jds):
            nights.append((dj, dawn_jds[i_dawn]))
            i_dawn += 1

    if not nights:
        sys.exit(
            "Could not find civil dusk/dawn (−6°) in search window; "
            "try again or check polar-edge paths."
        )

    ref_jd = t_ref.jd
    chosen = None
    for dj, aj in nights:
        if dj <= ref_jd < aj:
            chosen = (dj, aj)
            break
    if chosen is None:
        for dj, aj in nights:
            if dj >= ref_jd:
                chosen = (dj, aj)
                break
    if chosen is None:
        chosen = nights[-1]

    return Time(chosen[0], format="jd", scale="utc"), Time(chosen[1], format="jd", scale="utc")


def star_altitudes_deg(coord: SkyCoord, location: EarthLocation, times: Time) -> np.ndarray:
    altaz_frame = AltAz(obstime=times, location=location)
    with warnings.catch_warnings():
        if ErfaWarning is not None:
            warnings.simplefilter("ignore", ErfaWarning)
        warnings.simplefilter("ignore", AstropyWarning)
        aa = coord.transform_to(altaz_frame)
    return aa.alt.deg


def sample_count_for_span(span_days: float) -> int:
    dur_min = span_days * 24 * 60
    max_points = 25_000
    if dur_min <= max_points:
        return int(min(max_points, max(2_000, dur_min)))
    return min(max_points, max(2_000, int(span_days * 48)))


def synthetic_magnitude(
    times: Time,
    period_days: float,
    mag_faint: float,
    mag_bright: float,
    t0: Time,
) -> np.ndarray:
    """
    Simple sinusoid in magnitude between mag_bright (smaller number) and mag_faint (larger).
    phase 0 at t0.
    """
    phase = ((times - t0).to(u.day).value % period_days) / period_days
    mid = 0.5 * (mag_bright + mag_faint)
    amp = 0.5 * (mag_faint - mag_bright)
    return mid + amp * np.sin(2 * np.pi * phase)


def load_mag_csv(
    path: Path,
    time_col: str,
    mag_col: str,
    time_scale: str,
) -> tuple[Time, np.ndarray]:
    mdf = pd.read_csv(path)
    if time_col not in mdf.columns or mag_col not in mdf.columns:
        sys.exit(f"{path}: need columns {time_col!r} and {mag_col!r}")

    if time_scale.lower() in ("jd", "bjd", "hjd"):
        jd = pd.to_numeric(mdf[time_col], errors="coerce").to_numpy()
        ok = np.isfinite(jd)
        times = Time(jd[ok], format="jd", scale="utc")
        mag = pd.to_numeric(mdf[mag_col], errors="coerce").to_numpy()[ok]
    elif time_scale.lower() == "iso":
        times = Time(pd.to_datetime(mdf[time_col], utc=True).to_numpy())
        mag = pd.to_numeric(mdf[mag_col], errors="coerce").to_numpy()
        ok = np.isfinite(mag)
        times, mag = times[ok], mag[ok]
    else:
        sys.exit(f"Unknown --mag-time-scale {time_scale!r} (use jd or iso)")

    order = np.argsort(times.jd)
    return times[order], mag[order]


def resolve_two_outputs(base_out: Path | None, star_safe: str) -> tuple[Path, Path]:
    repo = Path(__file__).resolve().parent
    sfx = ".png"
    if base_out is None:
        return repo / f"{star_safe}_lc_2P{sfx}", repo / f"{star_safe}_tonight{sfx}"
    stem = base_out.stem
    sfx = base_out.suffix if base_out.suffix else sfx
    parent = base_out.parent
    return parent / f"{stem}_lc_2P{sfx}", parent / f"{stem}_tonight{sfx}"


def main() -> None:
    if ErfaWarning is not None:
        warnings.filterwarnings("ignore", category=ErfaWarning)

    p = argparse.ArgumentParser(
        description="Two PNGs: (1) light curve for 2 periods (2) tonight Pomfret altitude + mag."
    )
    p.add_argument("star", help='Star name as in CSV, e.g. "DX And"')
    p.add_argument("--csv", type=Path, default=Path(__file__).resolve().parent / "index.csv")
    p.add_argument(
        "-o",
        "--output",
        type=Path,
        default=None,
        help="Basename for outputs: stem_lc_2P.png and stem_tonight.png (default: star name)",
    )
    p.add_argument("--period-days", type=float, default=None, help="Override period when catalog has None")
    p.add_argument("--start", type=str, default=None, help="Start time ISO UTC for 2P plot (default: now)")
    p.add_argument("--mag-csv", type=Path, default=None, help="Optional photometry CSV")
    p.add_argument("--mag-time-col", type=str, default="jd")
    p.add_argument("--mag-mag-col", type=str, default="mag")
    p.add_argument("--mag-time-scale", type=str, default="jd", choices=("jd", "iso"))
    args = p.parse_args()

    if not args.csv.is_file():
        sys.exit(f"Catalog not found: {args.csv}")

    row = load_star_row(args.csv, args.star)
    name = str(row["Star Name"]).strip()
    period = args.period_days if args.period_days is not None else _parse_period_days(row.get("Period (d)"))
    if period is None or period <= 0:
        sys.exit(
            f"{name}: no positive period in catalog. Pass --period-days (days) or fix CSV."
        )

    span_days = 2.0 * period
    t0 = Time(args.start, format="isot", scale="utc") if args.start else Time.now()
    t1 = t0 + span_days * u.day

    mag_faint = _parse_catalog_float(row.get("Min Mag"))
    mag_bright = _parse_catalog_float(row.get("Max Mag"))
    if mag_faint is None or mag_bright is None:
        mag_faint, mag_bright = 15.0, 12.0

    coord = row_to_skycoord(row)

    # ========= Figure 1: light curve only (two periods) =========
    n_lc = sample_count_for_span(span_days)
    jd_lc = np.linspace(t0.jd, t1.jd, n_lc)
    times_lc = Time(jd_lc, format="jd", scale="utc")

    use_csv = args.mag_csv is not None
    if use_csv:
        times_obs, mag_obs = load_mag_csv(
            args.mag_csv,
            args.mag_time_col,
            args.mag_mag_col,
            args.mag_time_scale,
        )
        in_2p = (times_obs >= t0) & (times_obs <= t1)
        times_obs_2p, mag_obs_2p = times_obs[in_2p], mag_obs[in_2p]
        if len(times_obs_2p) == 0:
            sys.exit("No photometry points fall inside the 2-period window.")
        mag_label_1 = "Magnitude (data)"
        mag_src_1 = str(args.mag_csv)
    else:
        mag_synth = synthetic_magnitude(times_lc, period, mag_faint, mag_bright, t0)
        mag_label_1 = "Magnitude (sinusoid from Min/Max Mag)"
        mag_src_1 = "synthetic"

    safe = re.sub(r"[^\w\-]+", "_", name)[:80].strip("_")
    out_2p, out_night = resolve_two_outputs(args.output, safe)

    fig1, ax = plt.subplots(figsize=(14, 4.5), constrained_layout=True)
    if use_csv:
        x_o = _time_to_matplotlib_dates(times_obs_2p)
        ax.plot(x_o, mag_obs_2p, ".", color="C0", ms=2.5, alpha=0.9)
    else:
        x_s = _time_to_matplotlib_dates(times_lc)
        ax.plot(x_s, mag_synth, "-", color="C0", lw=1.0)
    ax.set_ylabel(mag_label_1)
    ax.set_xlabel("Time (UTC)")
    ax.invert_yaxis()
    ax.grid(True, alpha=0.3)
    ax.set_title(
        f"{name} — light curve only, span {span_days:.6g} d (2×P), P={period:.6g} d\nmag: {mag_src_1}",
        fontsize=10,
    )
    loc1 = mdates.AutoDateLocator()
    ax.xaxis.set_major_locator(loc1)
    ax.xaxis.set_major_formatter(mdates.ConciseDateFormatter(loc1))
    ax.xaxis.set_minor_locator(mticker.AutoMinorLocator())
    fig1.savefig(out_2p, dpi=160)

    # ========= Figure 2: tonight civil night — altitude + magnitude =========
    t_now = Time.now()
    t_dusk, t_dawn = civil_twilight_night(POMFRET_LOCATION, t_now)
    span_night_h = (t_dawn - t_dusk).to(u.hour).value
    n_n = int(max(2_000, min(20_000, span_night_h * 60 + 1)))
    jd_n = np.linspace(t_dusk.jd, t_dawn.jd, n_n)
    times_n = Time(jd_n, format="jd", scale="utc")
    alt_n = star_altitudes_deg(coord, POMFRET_LOCATION, times_n)

    mag_label_2 = ""
    have_night_obs = False
    night_note = ""
    if use_csv:
        in_n = (times_obs >= t_dusk) & (times_obs <= t_dawn)
        times_n_obs, mag_n_obs = times_obs[in_n], mag_obs[in_n]
        have_night_obs = len(times_n_obs) > 0
        if not have_night_obs:
            print(
                "No photometry in tonight's civil window; using synthetic magnitude for the night plot.",
                file=sys.stderr,
            )
            mag_n = synthetic_magnitude(times_n, period, mag_faint, mag_bright, t0)
            mag_label_2 = "Magnitude (sinusoid; no data tonight)"
            night_note = " mag fallback synthetic"
        else:
            mag_label_2 = "Magnitude (data)"
    else:
        mag_n = synthetic_magnitude(times_n, period, mag_faint, mag_bright, t0)
        mag_label_2 = "Magnitude (sinusoid from Min/Max Mag)"

    fig2, ax_a = plt.subplots(figsize=(14, 5.5), constrained_layout=True)
    x_n_t = _time_to_matplotlib_dates(times_n)
    ax_b = ax_a.twinx()

    ax_a.set_ylim(-5, 90)

    high_alt = alt_n >= ALT_FILL_THRESHOLD_DEG

    if use_csv and have_night_obs:
        mag_fill = np.interp(times_n.jd, times_n_obs.jd, mag_n_obs)
        fill_mag_ok = high_alt & np.isfinite(mag_fill)
    else:
        mag_fill = np.asarray(mag_n, dtype=float)
        fill_mag_ok = high_alt

    mag_top = mag_bright
    mag_bot = mag_faint
    mag_span_m = float(np.nanmax(mag_fill) - np.nanmin(mag_fill))
    pad = max(0.5, 0.05 * mag_span_m)
    mag_plot_min = min(mag_top, np.nanmin(mag_fill)) - pad
    mag_plot_max = max(mag_bot, np.nanmax(mag_fill)) + pad

    # Orange fill only (right axis): magnitude curve ↔ catalog faint mag where altitude ≥ threshold.
    ax_b.fill_between(
        x_n_t,
        mag_fill,
        mag_bot,
        where=fill_mag_ok,
        alpha=0.22,
        color="C1",
        interpolate=True,
        linewidth=0,
        zorder=1,
    )
    ax_b.set_ylim(mag_plot_max, mag_plot_min)

    ax_a.plot(x_n_t, alt_n, "-", color="C0", lw=1.0, label="Altitude", zorder=3)

    if use_csv and have_night_obs:
        x_no = _time_to_matplotlib_dates(times_n_obs)
        ax_b.plot(x_no, mag_n_obs, ".", color="C1", ms=3.0, alpha=0.9, zorder=3)
    else:
        ax_b.plot(x_n_t, mag_n, "-", color="C1", lw=1.0, alpha=0.9, zorder=3)

    ax_a.set_ylabel("Altitude (deg, Pomfret)", color="C0")
    ax_a.tick_params(axis="y", labelcolor="C0")
    ax_a.grid(True, alpha=0.3)
    ax_b.set_ylabel(mag_label_2, color="C1")
    ax_b.tick_params(axis="y", labelcolor="C1")

    dusk_et = t_dusk.to_datetime(timezone=POMFRET_TZ)
    dawn_et = t_dawn.to_datetime(timezone=POMFRET_TZ)
    ax_a.set_xlabel("Time (America/New_York)")
    ax_a.set_title(
        f"{name} — tonight (civil dusk −6° → dawn −6°, Pomfret){night_note}\n"
        f"{dusk_et.strftime('%Y-%m-%d %H:%M')} → {dawn_et.strftime('%Y-%m-%d %H:%M')} ET\n"
        f"Magnitude shaded where altitude ≥ {ALT_FILL_THRESHOLD_DEG:.0f}° (Mag→faint {mag_bot:.2f})",
        fontsize=10,
    )
    loc2 = mdates.AutoDateLocator()
    ax_a.xaxis.set_major_locator(loc2)
    ax_a.xaxis.set_major_formatter(mdates.ConciseDateFormatter(loc2, tz=POMFRET_TZ))
    ax_a.xaxis.set_minor_locator(mticker.AutoMinorLocator())

    fig2.savefig(out_night, dpi=160)

    print(f"Wrote {out_2p}")
    print(f"Wrote {out_night}")


if __name__ == "__main__":
    main()
