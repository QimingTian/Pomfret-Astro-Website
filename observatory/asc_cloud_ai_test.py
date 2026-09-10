#!/usr/bin/env python3
"""Smoke tests for ASC all-sky AI v1 (skip inference when torch is unavailable)."""

from __future__ import annotations

import os
import sys
import unittest
from datetime import datetime, timezone

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

import observatory_solar as obs_solar  # noqa: E402


class TestAscSolar(unittest.TestCase):
    def test_nautical_dawn_before_dusk_same_day(self):
        now = datetime(2026, 6, 15, 18, 0, tzinfo=timezone.utc)
        dawn, dusk = obs_solar.nautical_dawn_and_dusk_utc(now)
        self.assertLess(dawn, dusk)

    def test_is_asc_model_daytime_noon(self):
        now = datetime(2026, 6, 15, 17, 0, tzinfo=timezone.utc)
        self.assertTrue(obs_solar.is_asc_model_daytime(now))

    def test_is_asc_model_daytime_midnight(self):
        now = datetime(2026, 6, 15, 6, 0, tzinfo=timezone.utc)
        self.assertFalse(obs_solar.is_asc_model_daytime(now))


class TestAscV1CheckpointPresent(unittest.TestCase):
    def test_checkpoint_and_manifest(self):
        models_dir = os.path.join(_HERE, 'models')
        ckpt = os.path.join(models_dir, 'ASC_AI_v1', 'best.pt')
        version = os.path.join(models_dir, 'ASC_AI_MODEL_VERSION.json')
        self.assertTrue(os.path.isfile(ckpt), ckpt)
        self.assertTrue(os.path.isfile(version), version)
        import json

        with open(version, encoding='utf-8') as f:
            data = json.load(f)
        self.assertEqual(data.get('version'), 'v1')


class TestAscStatusPayloadShape(unittest.TestCase):
    def test_sequence_active_marks_stale(self):
        import asc_cloud_ai

        payload = asc_cloud_ai.status_payload(sequence_active=True)
        self.assertIsNotNone(payload)
        assert payload is not None
        self.assertTrue(payload.get('stale'))
        self.assertEqual(payload.get('staleReason'), 'sequence_active')
        self.assertIsNone(payload.get('sky'))


class TestAscInferenceOptional(unittest.TestCase):
    def test_analyze_frame_when_torch_available(self):
        try:
            import torch  # noqa: F401
            from PIL import Image
            import asc_cloud_ai
        except ImportError:
            self.skipTest('torch or Pillow not installed')

        ckpt = os.path.join(_HERE, 'models', 'ASC_AI_v1', 'best.pt')
        if not os.path.isfile(ckpt):
            self.skipTest('checkpoint missing')

        img = Image.new('RGB', (640, 480), color=(20, 20, 40))
        result = asc_cloud_ai.analyze_frame(img, datetime(2026, 6, 15, 6, 0, tzinfo=timezone.utc))
        if result.get('lastError'):
            self.fail(result['lastError'])
        self.assertIn(result.get('sky'), ('clear', 'cloudy'))
        self.assertIsInstance(result.get('skyConfidence'), float)
        rain = result.get('rain') or {}
        self.assertIn('detected', rain)
        self.assertIn(rain.get('label'), ('Rain', 'No Rain'))
        self.assertEqual(result.get('modelVersion', {}).get('version'), 'v1')


if __name__ == '__main__':
    unittest.main()
