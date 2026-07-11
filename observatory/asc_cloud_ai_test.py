#!/usr/bin/env python3
"""Smoke tests for ASC all-sky AI (skip inference when TensorFlow is unavailable)."""

from __future__ import annotations

import os
import sys
import unittest
from datetime import datetime, timezone

# Allow running from repo root or observatory/
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


class TestAscModelsPresent(unittest.TestCase):
    def test_model_directories_exist(self):
        models_dir = os.path.join(_HERE, 'models')
        for name in (
            'Day_Cloud_Model',
            'Night_Cloud_Model',
            'Day_Rain_Model',
            'Night_Rain_Model',
        ):
            path = os.path.join(models_dir, name)
            self.assertTrue(os.path.isdir(path), path)
            self.assertTrue(os.path.isfile(os.path.join(path, 'model.json')))
            self.assertTrue(os.path.isfile(os.path.join(path, 'metadata.json')))
            self.assertTrue(os.path.isfile(os.path.join(path, 'weights.bin')))


class TestCloudCoverMath(unittest.TestCase):
    def test_cloud_cover_argmax_when_confident(self):
        import asc_cloud_ai

        labels = ['0', '10', '20', '30']
        probs = [0.05, 0.55, 0.30, 0.10]
        cover, conf = asc_cloud_ai._cloud_expected_percent(probs, labels)
        self.assertEqual(cover, 10)
        self.assertAlmostEqual(conf, 0.55)

    def test_cloud_cover_weighted_when_uncertain(self):
        import asc_cloud_ai

        labels = ['0', '10', '20']
        probs = [0.40, 0.35, 0.25]
        cover, conf = asc_cloud_ai._cloud_expected_percent(probs, labels)
        self.assertEqual(cover, 8)  # weighted 8.5 → 8
        self.assertAlmostEqual(conf, 0.40)


class TestAscPreprocess(unittest.TestCase):
    def test_preprocess_tm_normalization(self):
        try:
            import asc_cloud_ai
            import numpy as np
            from PIL import Image
        except ImportError:
            self.skipTest('asc_cloud_ai or Pillow not importable')

        img = Image.new('RGB', (1920, 1080), color=(128, 128, 128))
        batch = asc_cloud_ai._preprocess(img)
        self.assertEqual(batch.shape, (1, 224, 224, 3))
        self.assertGreaterEqual(float(batch.min()), -1.01)
        self.assertLessEqual(float(batch.max()), 1.01)
        # Mid-gray → ~0 after (x/127 - 1)
        self.assertAlmostEqual(float(batch[0, 112, 112, 0]), 0.0, delta=0.05)


class TestAscInference(unittest.TestCase):
    def test_analyze_frame_with_dummy_image(self):
        try:
            import asc_cloud_ai
            from PIL import Image
        except ImportError:
            self.skipTest('asc_cloud_ai or Pillow not importable')

        try:
            import tensorflow  # noqa: F401
        except ImportError:
            self.skipTest('tensorflow not installed')

        img = Image.new('RGB', (640, 480), color=(40, 40, 80))
        result = asc_cloud_ai.analyze_frame(img)
        self.assertIn('cloudCoverPercent', result)
        self.assertIn('modelPhase', result)
        self.assertIn('rain', result)
        if result.get('lastError'):
            self.skipTest(f"inference unavailable: {result['lastError']}")
        self.assertIsInstance(result['cloudCoverPercent'], int)
        self.assertGreaterEqual(result['cloudCoverPercent'], 0)
        self.assertLessEqual(result['cloudCoverPercent'], 100)
        self.assertIn(result['modelPhase'], ('day', 'night'))


if __name__ == '__main__':
    unittest.main()
