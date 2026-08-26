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

    def test_variable_star_keeps_g_and_autofocus_before_exposure(self):
        root = build_run_sequence(
            {
                "raHoursDecimal": 14.2,
                "decDegDecimal": 20.1,
                "filterName": "Ha",
                "exposureSeconds": 30,
                "exposureCount": 1,
                "pomfretQueueId": "var-1",
                "templateKind": "variable_star",
                "targetName": "CR Boo",
                "variableStarWindow": {"end": {"hours": 4, "minutes": 30, "seconds": 0}},
                "variableStarTargetAdu": 0.4,
            }
        )
        target = None
        stack = [root]
        while stack:
            node = stack.pop()
            if isinstance(node, dict):
                t = str(node.get("$type") or "")
                if "VariableStarObjectContainer" in t:
                    target = node
                    break
                stack.extend(node.values())
            elif isinstance(node, list):
                stack.extend(node)
        self.assertIsNotNone(target)
        values = target["Items"]["$values"]
        types = [str(v.get("$type") or "").split(",")[0].rsplit(".", 1)[-1] for v in values if isinstance(v, dict)]
        switch_i = types.index("SwitchFilter")
        af_i = types.index("RunAutofocus")
        calc_i = next(i for i, t in enumerate(types) if t == "CalculateExposureTime")
        self.assertLess(switch_i, af_i)
        self.assertLess(af_i, calc_i)
        self.assertEqual(values[switch_i]["Filter"]["_name"], "G")
        self.assertEqual(values[switch_i]["Filter"]["_position"], 5)
        calc = next(v for v in values if isinstance(v, dict) and "CalculateExposureTime" in str(v.get("$type") or ""))
        self.assertEqual(calc["ExposureTimeFirst"], 10.0)
        self.assertEqual(calc["ExposureTimeMax"], 180.0)
        self.assertEqual(calc["TargetADU"], 0.4)
        posts = []
        for v in values:
            if not isinstance(v, dict) or "HTTP.HttpClient" not in str(v.get("$type") or ""):
                continue
            body = v.get("HttpPostBody")
            if isinstance(body, str) and body.startswith("{"):
                body = json.loads(body).get("text")
            posts.append(body)
        self.assertEqual(
            posts,
            ["Target Centered", "Filter Switched", "Autofocus Finished", "Guiding Started | Imaging Started"],
        )
        centered = next(
            v
            for v in values
            if isinstance(v, dict) and "HTTP.HttpClient" in str(v.get("$type") or "") and "Target Centered" in str(v.get("HttpPostBody"))
        )
        self.assertEqual(centered["HttpAuthUsername"], "pomfretastro")
        self.assertEqual(centered["HttpUri"], "https://www.pomfretastro.org/api/imaging/session-progress")
        self.assertEqual(root["PomfretAstro"]["FilterName"], "G")
        self.assertFalse(any("WaitForTransit" in str(v.get("$type") or "") for v in values))
        loop = values[-1]
        cond = loop["Conditions"]["$values"][0]
        self.assertEqual(cond["Hours"], 4)
        self.assertEqual(cond["Minutes"], 30)
        self.assertEqual(cond["Seconds"], 0)
        self.assertIn("TimeCondition", str(cond.get("$type") or ""))
        self.assertNotIn("TransitCondition", str(cond.get("$type") or ""))
        self.assertIn("TimeProvider", str(cond.get("SelectedProvider", {}).get("$type") or ""))
        self.assertNotIn("ObservationEndProvider", str(cond.get("SelectedProvider", {}).get("$type") or ""))
        exo = target["ExoPlanetDSO"]
        self.assertIn("$ref", exo["Coordinates"])
        moon_coords = exo["Moon"]["Coordinates"]
        self.assertEqual(moon_coords.get("$id"), "45")
        self.assertEqual(moon_coords.get("RA"), 0.0)

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
