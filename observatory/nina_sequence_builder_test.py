#!/usr/bin/env python3
import json
import unittest
from pathlib import Path

from nina_sequence_builder import (
    JOB_KIND,
    build_estop_sequence,
    build_run_sequence,
    materialize_job,
    parse_job_envelope,
)

ROOT = Path(__file__).resolve().parent


class NinaSequenceBuilderTests(unittest.TestCase):
    def test_single_filter_sets_coords_and_exposure(self):
        root = build_run_sequence(
            {
                "raHoursDecimal": 20.9667,
                "decDegDecimal": 44.3167,
                "filterName": "Ha",
                "exposureSeconds": 180,
                "exposureCount": 12,
                "pomfretQueueId": "queue-1",
                "templateKind": "dso",
                "targetName": "NGC7000",
                "outputMode": "raw_zip",
            }
        )
        blob = json.dumps(root)
        self.assertIn('"RAHours": 20', blob)
        self.assertIn('"Iterations": 12', blob)
        self.assertIn('"ExposureTime": 180', blob)
        self.assertIn("Ha", blob)
        self.assertEqual(root["PomfretAstro"]["QueueId"], "queue-1")
        self.assertIn("NINA.Sequencer", blob)

    def test_multi_filter_repeats_blocks(self):
        root = build_run_sequence(
            {
                "raHoursDecimal": 5.5,
                "decDegDecimal": -5.4,
                "filterName": "L",
                "exposureSeconds": 60,
                "exposureCount": 5,
                "pomfretQueueId": "queue-m",
                "templateKind": "dso",
                "filterPlans": [
                    {"filterName": "L", "exposureSeconds": 60, "exposureCount": 5},
                    {"filterName": "R", "exposureSeconds": 90, "exposureCount": 3},
                    {"filterName": "G", "exposureSeconds": 90, "exposureCount": 3},
                ],
            }
        )
        blob = json.dumps(root)
        self.assertIn("L", blob)
        self.assertIn("R", blob)
        self.assertIn("G", blob)
        self.assertGreaterEqual(blob.count("TakeManyExposures"), 3)

    def test_estop_sets_session_type(self):
        root = build_estop_sequence("estop-1", "ESTOPPED")
        self.assertEqual(root["PomfretAstro"]["SessionType"], "estop")
        self.assertIn("estop-1", json.dumps(root))

    def test_materialize_run_job(self):
        job = {
            "kind": "pomfret-nina-job",
            "version": 7,
            "command": "run",
            "queueId": "q2",
            "params": {
                "raHoursDecimal": 12.0,
                "decDegDecimal": 30.0,
                "filterName": "Sii",
                "exposureSeconds": 120,
                "exposureCount": 4,
                "pomfretQueueId": "q2",
                "templateKind": "dso",
            },
        }
        root = materialize_job(job)
        self.assertEqual(root["PomfretAstro"]["QueueId"], "q2")

    def test_parse_envelope(self):
        self.assertIsNone(parse_job_envelope({"$type": "NINA.Sequencer"}))
        job = parse_job_envelope({"PomfretAstroJob": {"kind": JOB_KIND, "command": "estop"}})
        self.assertEqual(job["command"], "estop")

    def test_templates_exist(self):
        folder = ROOT / "nina_templates"
        for name in (
            "Classic DSO Imaging Sequence.json",
            "Classic DSO Imaging Sequence Multi Filter.json",
            "Variable Star Sequence.json",
            "EStop.json",
            "End Night Session.json",
        ):
            self.assertTrue((folder / name).is_file(), name)


if __name__ == "__main__":
    unittest.main()
