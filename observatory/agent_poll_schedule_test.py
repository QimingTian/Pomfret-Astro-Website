"""Tests for adaptive agent poll schedule (mirrors lib/observatory-poll-schedule.test.ts)."""

from __future__ import annotations

import unittest
from datetime import datetime, timezone

from agent_poll_schedule import (
    DAY_POLL_SECONDS,
    NIGHT_POLL_SECONDS,
    agent_poll_interval_seconds,
    is_observatory_night,
    resolve_agent_site,
)


class AgentPollScheduleTest(unittest.TestCase):
    def test_intervals_slower_by_day_than_at_night(self) -> None:
        site = resolve_agent_site("pomfret")
        day = datetime(2026, 6, 15, 18, 0, tzinfo=timezone.utc)
        night = datetime(2026, 6, 16, 2, 0, tzinfo=timezone.utc)
        self.assertFalse(is_observatory_night(day, site))
        self.assertTrue(is_observatory_night(night, site))
        self.assertGreater(agent_poll_interval_seconds(site, day), agent_poll_interval_seconds(site, night))
        self.assertEqual(agent_poll_interval_seconds(site, night), float(NIGHT_POLL_SECONDS))
        self.assertEqual(agent_poll_interval_seconds(site, day), float(DAY_POLL_SECONDS))

    def test_cygnus_site_resolves(self) -> None:
        site = resolve_agent_site("cygnus")
        self.assertEqual(site.id, "cygnus")
        self.assertEqual(site.timezone, "Europe/Amsterdam")


if __name__ == "__main__":
    unittest.main()
