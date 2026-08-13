"""Focused contract tests for ui-browser-audit.py; no browser/server required."""

from __future__ import annotations

import importlib.util
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPT = Path(__file__).with_name("ui-browser-audit.py")
SPEC = importlib.util.spec_from_file_location("ui_browser_audit", SCRIPT)
assert SPEC and SPEC.loader
audit = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = audit
SPEC.loader.exec_module(audit)


class BrowserAuditContractTests(unittest.TestCase):
    def test_dirty_snapshot_is_explicit_and_cannot_attest_expected_commit(self) -> None:
        with patch.object(
            audit.subprocess,
            "check_output",
            side_effect=["abc123\n", " M packages/app/src/AppRoot.tsx\n?? generated.txt\n"],
        ):
            snapshot = audit.git_snapshot()

        self.assertEqual(snapshot["commit"], "abc123")
        self.assertEqual(snapshot["state"], "dirty")
        self.assertEqual(snapshot["changedPathCount"], 2)
        self.assertRegex(str(snapshot["statusFingerprint"]), r"^[0-9a-f]{64}$")
        with patch.dict(os.environ, {"MIB_BEACON_AUDIT_COMMIT": "abc123"}, clear=True):
            with self.assertRaisesRegex(audit.AuditFailure, "dirty worktree"):
                audit.assert_commit_freshness(snapshot)

    def test_remaining_scenarios_respects_an_only_filtered_plan(self) -> None:
        chosen = audit.Scenario("chosen", "Chosen", "browse", "phone", "light", "", lambda _page: None)
        skipped = audit.Scenario("skipped", "Skipped", "tools", "desktop", "dark", "", lambda _page: None)
        remaining = audit.remaining_scenarios([chosen], {"chosen"})
        self.assertEqual(remaining, [])
        self.assertEqual(audit.remaining_scenarios([chosen, skipped], {"chosen"})[0]["id"], "skipped")

    def test_existing_output_requires_explicit_overwrite(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "audit"
            output.mkdir()
            (output / "coverage.json").write_text("stale\n")
            with self.assertRaisesRegex(RuntimeError, "already exists"):
                audit.Audit("http://127.0.0.1:8899", output)

    def test_expected_commit_rejection_preserves_existing_output(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "audit"
            output.mkdir()
            marker = output / "coverage.json"
            marker.write_text("preserve me\n")
            with patch.object(audit, "git_snapshot", return_value={"commit": "abc", "state": "dirty"}):
                with patch.dict(os.environ, {"MIB_BEACON_AUDIT_COMMIT": "abc"}, clear=True):
                    with self.assertRaisesRegex(audit.AuditFailure, "dirty worktree"):
                        audit.Audit("http://127.0.0.1:8899", output, overwrite=True)
            self.assertEqual(marker.read_text(), "preserve me\n")

    def test_route_and_legacy_coverage_include_all_required_modes(self) -> None:
        routes = audit.route_scenarios("http://example.test")
        self.assertEqual(len(routes), len(audit.ROUTES) * len(audit.VIEWPORTS) * len(audit.THEMES))
        interactions = audit.interaction_scenarios("http://example.test")
        legacy = [item for item in interactions if item.id.startswith("legacy-mibs-")]
        self.assertEqual(
            {item.id for item in legacy},
            {f"legacy-mibs-{viewport}-{theme}" for viewport in audit.VIEWPORTS for theme in audit.THEMES},
        )

    def test_command_palette_scenario_exercises_off_route_handoff(self) -> None:
        scenario = next(
            item
            for item in audit.interaction_scenarios("http://example.test")
            if item.id == "command-palette-navigation"
        )
        self.assertIn("off-route catalog fallback", scenario.expected)
        self.assertIn("hands ownership", scenario.expected)


if __name__ == "__main__":
    unittest.main()
