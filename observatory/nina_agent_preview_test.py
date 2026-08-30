"""Tests for variable-star live preview throttling in nina_agent."""

from __future__ import annotations

import json
import unittest

from nina_agent import (
    PREVIEW_VARIABLE_STAR_MIN_INTERVAL_SECONDS,
    is_variable_star_sequence,
    preview_throttle_allows,
)


class VariableStarPreviewTests(unittest.TestCase):
    def test_is_variable_star_sequence_from_metadata(self) -> None:
        payload = {
            "PomfretAstro": {
                "QueueId": "abc",
                "SequenceTemplate": "variable_star",
            }
        }
        self.assertTrue(is_variable_star_sequence(json.dumps(payload).encode("utf-8")))

    def test_is_variable_star_sequence_from_template_markers(self) -> None:
        payload = {
            "Items": {
                "$values": [
                    {
                        "$type": "NINA.Plugin.ExoPlanets.Sequencer.Utility.CalculateExposureTime, ExoPlanets",
                    }
                ]
            }
        }
        self.assertTrue(is_variable_star_sequence(json.dumps(payload).encode("utf-8")))

    def test_is_not_variable_star_dso(self) -> None:
        payload = {
            "PomfretAstro": {"QueueId": "abc", "SequenceTemplate": "dso"},
            "Items": {
                "$values": [
                    {
                        "$type": "NINA.Sequencer.SequenceItem.Imaging.TakeManyExposures, NINA.Sequencer",
                    }
                ]
            },
        }
        self.assertFalse(is_variable_star_sequence(json.dumps(payload).encode("utf-8")))

    def test_preview_throttle_allows_dso_every_time(self) -> None:
        session_id = "sess-dso"
        for t in (0.0, 1.0, 999.0):
            self.assertTrue(
                preview_throttle_allows(
                    session_id,
                    variable_star=False,
                    now_monotonic=t,
                )
            )

    def test_preview_throttle_first_variable_star_always_allowed(self) -> None:
        self.assertTrue(
            preview_throttle_allows(
                "sess-vs",
                variable_star=True,
                now_monotonic=100.0,
            )
        )

    def test_preview_throttle_variable_star_blocks_within_interval(self) -> None:
        session_id = "sess-vs"
        interval = float(PREVIEW_VARIABLE_STAR_MIN_INTERVAL_SECONDS)
        from nina_agent import _preview_last_upload_monotonic, mark_preview_uploaded

        _preview_last_upload_monotonic.clear()
        mark_preview_uploaded(session_id, when_monotonic=100.0)
        self.assertFalse(
            preview_throttle_allows(
                session_id,
                variable_star=True,
                now_monotonic=100.0 + interval - 1.0,
            )
        )
        self.assertTrue(
            preview_throttle_allows(
                session_id,
                variable_star=True,
                now_monotonic=100.0 + interval,
            )
        )
        _preview_last_upload_monotonic.clear()

    def test_preview_throttle_force_bypasses_interval(self) -> None:
        session_id = "sess-vs"
        from nina_agent import _preview_last_upload_monotonic, mark_preview_uploaded

        _preview_last_upload_monotonic.clear()
        mark_preview_uploaded(session_id, when_monotonic=100.0)
        self.assertTrue(
            preview_throttle_allows(
                session_id,
                variable_star=True,
                force=True,
                now_monotonic=101.0,
            )
        )
        _preview_last_upload_monotonic.clear()


if __name__ == "__main__":
    unittest.main()
