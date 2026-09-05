"""The agent must identify its observatory on every request."""
from __future__ import annotations

import importlib
import os
import sys
import unittest
from pathlib import Path
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))


def _load_agent(site_id: str):
    previous = os.environ.get("OBSERVATORY_SITE_ID")
    os.environ["OBSERVATORY_SITE_ID"] = site_id
    try:
        module = importlib.import_module("nina_agent")
        return importlib.reload(module)
    finally:
        if previous is None:
            os.environ.pop("OBSERVATORY_SITE_ID", None)
        else:
            os.environ["OBSERVATORY_SITE_ID"] = previous


class SiteQueryTest(unittest.TestCase):
    def test_every_api_url_carries_the_site(self) -> None:
        agent = _load_agent("cygnus")
        for name in (
            "SEQUENCE_JSON_URL",
            "RECONCILE_QUEUE_URL",
            "AGENT_PULSE_URL",
            "ESTOP_DELIVERY_URL",
            "AGENT_EVENTS_URL",
            "UPLOAD_REPORT_URL",
            "PREVIEW_UPLOAD_URL",
        ):
            with self.subTest(url=name):
                url = getattr(agent, name)
                self.assertEqual(parse_qs(urlparse(url).query).get("site"), ["cygnus"])

    def test_headers_carry_the_site(self) -> None:
        agent = _load_agent("cygnus")
        self.assertEqual(agent.build_headers()["X-Observatory-Site"], "cygnus")
        self.assertEqual(agent.reconcile_queue_headers()["X-Observatory-Site"], "cygnus")

    def test_unknown_site_is_refused_before_any_hardware_moves(self) -> None:
        agent = _load_agent("cygnys")
        with self.assertRaises(ValueError) as caught:
            agent.validate_config()
        self.assertIn("not a known observatory", str(caught.exception))

    def test_with_site_replaces_existing_site_query(self) -> None:
        agent = _load_agent("cygnus")
        url = agent._with_site("https://example.com/api?site=pomfret&foo=1")
        qs = parse_qs(urlparse(url).query)
        self.assertEqual(qs.get("site"), ["cygnus"])
        self.assertEqual(qs.get("foo"), ["1"])


if __name__ == "__main__":
    unittest.main()
