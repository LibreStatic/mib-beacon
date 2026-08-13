#!/usr/bin/env python3
"""Fail-fast browser audit for the complete MIB Beacon web UI.

The audit deliberately writes its checkpoint after every scenario. The first
reproducible application failure captures evidence, marks all later scenarios
as not tested, and terminates without generating the user guide.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable
from urllib.parse import urlparse

from playwright.sync_api import Browser, BrowserContext, Page, Playwright, sync_playwright


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_BASE = os.environ.get("MIB_BEACON_AUDIT_BASE", "http://127.0.0.1:8899")
DEFAULT_OUTPUT = ROOT / "docs/audits/ui-browser"
ROUTES = (
    ("browse", "Browse"),
    ("live-mibs", "Live MIBs"),
    ("results", "Operation"),
    ("agents", "Agent profiles"),
    ("traps", "Receive"),
    ("tools", "Graphs"),
    ("settings", "Appearance"),
)
VIEWPORTS = {
    "phone": {"width": 390, "height": 844},
    "tablet": {"width": 820, "height": 900},
    "desktop": {"width": 1280, "height": 800},
}
THEMES = ("light", "dark")
APP_ERROR_MARKERS = (
    "unknown method:",
    "undefined is not a function",
    "cannot read properties of undefined",
    "unhandled promise rejection",
)


@dataclass
class Scenario:
    id: str
    title: str
    route: str
    viewport: str
    theme: str
    expected: str
    run: Callable[[Page], None]


class AuditFailure(AssertionError):
    pass


def git_snapshot() -> dict[str, object]:
    """Return the exact source state that the browser can have exercised.

    HEAD alone is not sufficient for local audits: a built server can include
    tracked or untracked worktree changes.  Keep the commit for CI comparison,
    but make the worktree state and a reproducible status fingerprint explicit
    in every report.
    """

    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    status = subprocess.check_output(
        ["git", "status", "--porcelain=v1", "--untracked-files=all"],
        cwd=ROOT,
        text=True,
    )
    changed_paths = [line[3:] for line in status.splitlines() if len(line) >= 4]
    dirty = bool(changed_paths)
    return {
        "commit": commit,
        "state": "dirty" if dirty else "clean",
        "statusFingerprint": hashlib.sha256(status.encode()).hexdigest() if dirty else None,
        "changedPathCount": len(changed_paths),
    }


def assert_commit_freshness(snapshot: dict[str, object]) -> None:
    """Require a clean, expected revision when CI supplies one."""

    expected = os.environ.get("MIB_BEACON_AUDIT_COMMIT") or os.environ.get("GITHUB_SHA")
    if not expected:
        return
    if snapshot["state"] != "clean":
        raise AuditFailure(
            "cannot attest MIB_BEACON_AUDIT_COMMIT from a dirty worktree; "
            "build and audit a clean checkout instead"
        )
    if snapshot["commit"] != expected:
        raise AuditFailure(f"tested commit {snapshot['commit']} does not match expected {expected}")


def remaining_scenarios(planned: list[Scenario], executed: set[str]) -> list[dict[str, str]]:
    return [
        {**Audit._scenario_fields(item), "status": "not-tested-after-first-defect"}
        for item in planned
        if item.id not in executed
    ]


class Audit:
    def __init__(self, base_url: str, output: Path, overwrite: bool = False):
        self.base_url = base_url.rstrip("/")
        self.output = output
        self.raw = output / "raw"
        snapshot = git_snapshot()
        assert_commit_freshness(snapshot)
        if output.exists() and any(output.iterdir()):
            if not overwrite:
                raise RuntimeError(
                    f"audit output already exists at {output}; preserve it or rerun with --overwrite"
                )
            shutil.rmtree(output)
        self.output.mkdir(parents=True, exist_ok=True)
        self.raw.mkdir(parents=True, exist_ok=True)
        self.report: dict[str, object] = {
            "schemaVersion": 2,
            "startedAt": datetime.now(timezone.utc).isoformat(),
            "testedCommit": snapshot["commit"],
            "testedWorktree": {
                "state": snapshot["state"],
                "statusFingerprint": snapshot["statusFingerprint"],
                "changedPathCount": snapshot["changedPathCount"],
            },
            "baseUrl": self.base_url,
            "stopPolicy": "first-reproducible-application-defect",
            "status": "running",
            "scenarios": [],
            "firstDefect": None,
        }
        self.console: list[dict[str, str]] = []
        self.network: list[dict[str, str | int]] = []
        self.current: Scenario | None = None
        self.planned_scenarios: list[Scenario] = []
        self._write_checkpoint()

    def set_plan(self, planned: list[Scenario]) -> None:
        self.planned_scenarios = planned

    def attach(self, page: Page) -> None:
        page.on(
            "console",
            lambda message: self.console.append(
                {"type": message.type, "text": message.text}
            )
            if message.type in {"error", "warning"}
            else None,
        )
        page.on(
            "pageerror",
            lambda error: self.console.append(
                {"type": "pageerror", "text": str(error)}
            ),
        )
        page.on(
            "requestfailed",
            lambda request: self.network.append(
                {
                    "kind": "requestfailed",
                    "url": request.url,
                    "error": request.failure or "unknown",
                }
            ),
        )
        page.on(
            "response",
            lambda response: self.network.append(
                {"kind": "response", "url": response.url, "status": response.status}
            )
            if response.status >= 400
            else None,
        )

    def run(self, page: Page, scenario: Scenario) -> None:
        self.current = scenario
        self.console = []
        self.network = []
        started = datetime.now(timezone.utc).isoformat()
        try:
            scenario.run(page)
            self._assert_no_runtime_errors(page)
            result = {
                **self._scenario_fields(scenario),
                "status": "pass",
                "startedAt": started,
                "finishedAt": datetime.now(timezone.utc).isoformat(),
            }
            self.report["scenarios"].append(result)  # type: ignore[union-attr]
            self._write_checkpoint()
        except Exception as error:
            self._capture_failure(page, scenario, started, error)
            raise
        finally:
            self.current = None

    @staticmethod
    def _scenario_fields(scenario: Scenario) -> dict[str, str]:
        fields = asdict(scenario)
        fields.pop("run")
        return fields

    def _assert_no_runtime_errors(self, page: Page) -> None:
        body = page.locator("body").inner_text().lower()
        marker = next((item for item in APP_ERROR_MARKERS if item in body), None)
        if marker:
            raise AuditFailure(f"application rendered error marker: {marker}")
        console_errors = [item for item in self.console if item["type"] != "warning"]
        if console_errors:
            raise AuditFailure(f"unexpected browser error: {console_errors[0]['text']}")
        failed = [
            item
            for item in self.network
            if item["kind"] == "requestfailed"
            or (item["kind"] == "response" and int(item["status"]) >= 500)
        ]
        if failed:
            raise AuditFailure(f"unexpected network failure: {failed[0]}")

    @staticmethod
    def _assert_page_layout(page: Page) -> None:
        layout = page.locator("html").evaluate(
            r"""node => ({
              viewportWidth: innerWidth,
              documentWidth: node.scrollWidth,
              unnamed: [...document.querySelectorAll('button,[role=button],[role=tab],input,textarea,select')]
                .filter(el => {
                  const s = getComputedStyle(el), b = el.getBoundingClientRect();
                  return s.display !== 'none' && s.visibility !== 'hidden' && b.width > 0 && b.height > 0;
                })
                .filter(el => !(el.getAttribute('aria-label') || el.innerText || el.getAttribute('placeholder') || '').trim())
                .length
            })"""
        )
        if layout["documentWidth"] > layout["viewportWidth"] + 1:
            raise AuditFailure(f"document has horizontal overflow: {layout}")
        if layout["unnamed"]:
            raise AuditFailure(f"visible interactive controls without names: {layout['unnamed']}")
        assert_required_content_reachable(page)

    def _capture_failure(
        self, page: Page, scenario: Scenario, started: str, error: Exception
    ) -> None:
        slug = re.sub(r"[^a-z0-9-]+", "-", scenario.id.lower()).strip("-")
        screenshot = self.raw / f"{slug}.png"
        html = self.raw / f"{slug}.html"
        aria = self.raw / f"{slug}-aria.txt"
        events = self.raw / f"{slug}-events.json"
        reproduction = self.raw / f"{slug}-reproduction.md"
        failure = {
            **self._scenario_fields(scenario),
            "status": "fail",
            "startedAt": started,
            "finishedAt": datetime.now(timezone.utc).isoformat(),
            "error": str(error),
            "evidence": {},
            "evidenceErrors": {},
        }
        self.report["scenarios"].append(failure)  # type: ignore[union-attr]
        self.report["firstDefect"] = failure
        executed = {item["id"] for item in self.report["scenarios"]}  # type: ignore[index]
        remaining = remaining_scenarios(self.planned_scenarios, executed)
        self.report["scenarios"].extend(remaining)  # type: ignore[union-attr]
        self.report["status"] = "stopped-on-first-defect"
        self.report["finishedAt"] = datetime.now(timezone.utc).isoformat()
        self._write_checkpoint()

        def capture(name: str, path: Path, operation: Callable[[], None]) -> None:
            try:
                operation()
                failure["evidence"][name] = str(path.relative_to(self.output))
            except Exception as capture_error:
                failure["evidenceErrors"][name] = str(capture_error)
            self._write_checkpoint()

        capture(
            "screenshot",
            screenshot,
            lambda: page.screenshot(path=str(screenshot), full_page=True),
        )
        capture("html", html, lambda: html.write_text(page.content()))
        capture(
            "accessibility",
            aria,
            lambda: aria.write_text(page.locator("body").aria_snapshot()),
        )
        capture(
            "events",
            events,
            lambda: events.write_text(
                json.dumps({"console": self.console, "network": self.network}, indent=2)
                + "\n"
            ),
        )
        capture(
            "reproduction",
            reproduction,
            lambda: reproduction.write_text(
                "\n".join(
                    [
                        f"# First defect: {scenario.title}",
                        "",
                        f"- Scenario: `{scenario.id}`",
                        f"- Route: `{scenario.route}`",
                        f"- Viewport: `{scenario.viewport}`",
                        f"- Theme: `{scenario.theme}`",
                        f"- Expected: {scenario.expected}",
                        f"- Observed: {error}",
                        f"- URL: `{page.url}`",
                        "",
                        "The audit stopped here by policy; later scenarios were not executed.",
                        "",
                    ]
                )
            ),
        )

    def _write_checkpoint(self) -> None:
        coverage = self.output / "coverage.json"
        coverage.write_text(json.dumps(self.report, indent=2) + "\n")
        scenarios = self.report["scenarios"]  # type: ignore[assignment]
        rows = [
            f"| {item['id']} | {item['viewport']} | {item['theme']} | {item['status']} |"
            for item in scenarios
        ]
        defect = self.report.get("firstDefect")
        report_lines = [
            "# Browser UI audit",
            "",
            f"Status: **{self.report['status']}**",
            f"Tested commit: `{self.report['testedCommit']}`",
            "Tested worktree: "
            f"**{self.report['testedWorktree']['state']}**"
            f" ({self.report['testedWorktree']['changedPathCount']} changed paths)",
            f"Base URL: `{self.report['baseUrl']}`",
            "",
            "| Scenario | Viewport | Theme | Status |",
            "| --- | --- | --- | --- |",
            *rows,
        ]
        if defect:
            reproduction_path = defect["evidence"].get("reproduction")
            report_lines.extend(
                [
                    "",
                    "## First defect",
                    "",
                    f"- **Scenario:** `{defect['id']}`",
                    f"- **Observed:** {defect['error']}",
                    *(
                        [
                            f"- **Evidence:** [{reproduction_path}]({reproduction_path})"
                        ]
                        if reproduction_path
                        else ["- **Evidence:** capture pending or unavailable; see coverage.json." ]
                    ),
                    "- Remaining scenarios were not executed.",
                ]
            )
        (self.output / "report.md").write_text("\n".join(report_lines) + "\n")

    def complete(self) -> None:
        self.report["status"] = "pass"
        self.report["finishedAt"] = datetime.now(timezone.utc).isoformat()
        self._write_checkpoint()


def open_route(page: Page, base: str, route: str) -> None:
    page.goto(f"{base}/#/{route}", wait_until="domcontentloaded")


def assert_route(page: Page, base: str, route: str, identity: str) -> None:
    open_route(page, base, route)
    if urlparse(page.url).fragment != f"/{route}":
        raise AuditFailure(f"route identity changed to {page.url}")
    page.get_by_text(identity, exact=False).first.wait_for(timeout=5_000)
    Audit._assert_page_layout(page)


def assert_required_content_reachable(page: Page) -> None:
    result = page.locator(
        "button,[role=button],[role=tab],[role=slider],input,textarea,select"
    ).evaluate_all(
        r"""nodes => {
          const visible = nodes.filter(el => {
            const s = getComputedStyle(el), b = el.getBoundingClientRect();
            return s.display !== 'none' && s.visibility !== 'hidden' && b.width > 0 && b.height > 0 && !el.disabled;
          });
          const last = visible.at(-1);
          if (!last) return {ok: false, reason: 'no reachable controls'};
          last.scrollIntoView({block: 'center', inline: 'nearest'});
          const b = last.getBoundingClientRect();
          const x = Math.max(0, Math.min(innerWidth - 1, b.left + b.width / 2));
          const y = Math.max(0, Math.min(innerHeight - 1, b.top + b.height / 2));
          const hits = document.elementsFromPoint(x, y);
          return {
            ok: b.left >= -1 && b.right <= innerWidth + 1 && b.top >= -1 && b.bottom <= innerHeight + 1
              && hits.some(hit => hit === last || last.contains(hit) || hit.contains(last)),
            reason: (last.getAttribute('aria-label') || last.innerText || last.tagName).trim()
          };
        }"""
    )
    if not result["ok"]:
        raise AuditFailure(f"last required control is unreachable: {result['reason']}")


def context_for(browser: Browser, viewport: str, theme: str) -> BrowserContext:
    size = VIEWPORTS[viewport]
    context = browser.new_context(
        viewport=size,
        color_scheme=theme,
        is_mobile=viewport == "phone",
        has_touch=viewport != "desktop",
        accept_downloads=True,
    )
    context.add_init_script(
        script=(
            f"localStorage.setItem('mibbeacon:theme', {json.dumps(theme)});"
            "localStorage.setItem('mibbeacon:density', 'auto');"
        )
    )
    return context


def route_scenarios(base: str) -> list[Scenario]:
    scenarios: list[Scenario] = []
    for viewport in VIEWPORTS:
        for theme in THEMES:
            for route, identity in ROUTES:
                scenarios.append(
                    Scenario(
                        id=f"route-{route}-{viewport}-{theme}",
                        title=f"{identity} route layout",
                        route=route,
                        viewport=viewport,
                        theme=theme,
                        expected="Route loads without errors, overflow, unnamed controls, or unreachable content.",
                        run=lambda page, r=route, i=identity: assert_route(page, base, r, i),
                    )
                )
    return scenarios


def scenarios(base: str) -> list[Scenario]:
    return [*route_scenarios(base), *interaction_scenarios(base)]


def interaction_scenarios(base: str) -> list[Scenario]:
    def legacy_mibs_route(page: Page) -> None:
        open_route(page, base, "mibs")
        if urlparse(page.url).fragment != "/mibs":
            raise AuditFailure(f"legacy route was rewritten to {page.url}")
        expected = "Loaded modules" if page.viewport_size["width"] < 640 else "Browse"
        page.get_by_text(expected, exact=False).first.wait_for()
        Audit._assert_page_layout(page)

    def phone_more(page: Page) -> None:
        open_route(page, base, "browse")
        page.get_by_role("tab", name="More", exact=True).click()
        for label in ("Live MIBs", "Agent profiles", "Settings"):
            page.get_by_text(label, exact=True).wait_for()

    def command_palette(page: Page) -> None:
        open_route(page, base, "browse")
        page.get_by_role("button", name=re.compile(r"^(Open )?Command palette$")).click()
        palette_input = page.get_by_label("Command palette input")
        palette_input.fill("start ports")
        page.get_by_text("Open tools for start ports", exact=True).click()
        page.wait_for_url(re.compile(r"#/tools$"))
        palette_input.wait_for()
        page.get_by_text("Load interface table", exact=True).wait_for()
        page.keyboard.press("Escape")

    def browse_validation(page: Page) -> None:
        open_route(page, base, "browse")
        search = page.get_by_placeholder("Search name, OID, or description…")
        search.fill("definitely-not-a-real-mib-node")
        page.get_by_text("No matches", exact=True).wait_for()
        search.fill("iso")
        page.get_by_role(
            "button", name=re.compile(r"Open internet at 1\.3\.6\.1")
        ).wait_for()

    def live_prerequisite(page: Page) -> None:
        open_route(page, base, "live-mibs")
        page.get_by_text("Live MIBs", exact=True).first.wait_for()
        if page.get_by_role("button", name="New profile", exact=True).count():
            page.get_by_role("button", name="New profile", exact=True).click()
            page.get_by_text("Create Live MIB agent", exact=True).wait_for()

    def query_get(page: Page) -> None:
        open_route(page, base, "results")
        page.get_by_label("Host").fill("127.0.0.1")
        port = page.get_by_label("Port")
        if port.count():
            port.fill("1611")
        community = page.get_by_label("Community")
        if community.count():
            community.fill("public")
        page.get_by_label("OID").first.fill("1.3.6.1.2.1.1.1.0")
        page.get_by_role("button", name="Run Get").click()
        page.get_by_text(re.compile(r"1 varbinds")).wait_for(timeout=10_000)

    def agents_validation(page: Page) -> None:
        open_route(page, base, "agents")
        page.get_by_role("button", name="New profile", exact=True).click()
        page.get_by_role("button", name=re.compile(r"Save|Create"), exact=True).last.click()
        page.get_by_text(re.compile(r"required|enter|missing", re.I)).first.wait_for()

    def trap_validation(page: Page) -> None:
        open_route(page, base, "traps")
        page.get_by_role("button", name="Send", exact=True).click()
        page.get_by_role("button", name="Compose trap", exact=True).click()
        page.get_by_label("Trap OID").fill("invalid")
        page.get_by_text("Trap OID must be a complete numeric OID.", exact=True).wait_for()
        submit = page.get_by_role("button", name=re.compile(r"^Send (trap|inform)$"))
        if submit.is_enabled():
            raise AuditFailure("invalid trap OID did not disable notification submission")

    def tools_discovery(page: Page) -> None:
        open_route(page, base, "tools")
        page.get_by_role("button", name="Discovery", exact=True).click()
        page.get_by_label("CIDR or inclusive range").fill("127.0.0.1/32")
        page.get_by_label(re.compile(r"Ad-hoc v2c communities")).fill("public")
        page.get_by_role("button", name="Start", exact=True).click()
        page.get_by_role("button", name="Save agent").wait_for(timeout=15_000)

    def mib_paste_validation(page: Page) -> None:
        open_route(page, base, "mibs")
        if page.viewport_size["width"] < 640:
            page.get_by_role("button", name="Import MIBs", exact=True).click()
        else:
            page.get_by_role("button", name="Import", exact=True).click()
        page.get_by_label("Or paste MIB text").fill("not a mib")
        page.get_by_role("button", name=re.compile(r"Import pasted text|Import")).last.click()
        page.get_by_text(re.compile(r"error|diagnostic|failed|invalid", re.I)).first.wait_for()

    def settings_theme(page: Page) -> None:
        open_route(page, base, "settings")
        page.get_by_text(re.compile(r"^Appearance(?: & accessibility)?$", re.I)).first.scroll_into_view_if_needed()
        page.get_by_role("button", name=re.compile(r"Dark", re.I)).first.click()
        mode = page.evaluate("localStorage.getItem('mibbeacon:theme')")
        if mode != "dark":
            raise AuditFailure(f"theme selection was not persisted: {mode!r}")

    legacy = [
        Scenario(
            id=f"legacy-mibs-{viewport}-{theme}",
            title=f"Legacy MIB route on {viewport}",
            route="mibs",
            viewport=viewport,
            theme=theme,
            expected=(
                "Legacy compact route opens loaded modules."
                if viewport == "phone"
                else "Legacy non-compact route resolves to the unified Browse workspace."
            ),
            run=legacy_mibs_route,
        )
        for viewport in VIEWPORTS
        for theme in THEMES
    ]
    return [
        *legacy,
        Scenario("phone-more-navigation", "Phone More navigation", "browse", "phone", "light", "All overflow destinations are reachable.", phone_more),
        Scenario("command-palette-navigation", "Command palette", "browse", "desktop", "light", "An off-route catalog fallback navigates safely, preserves the palette, and hands ownership to the route action.", command_palette),
        Scenario("browse-search-validation", "Browse search", "browse", "desktop", "light", "Empty and successful searches render correctly.", browse_validation),
        Scenario("live-mibs-prerequisite", "Live MIBs prerequisite", "live-mibs", "phone", "light", "Missing target state provides inline creation.", live_prerequisite),
        Scenario("query-local-get", "SNMP Get against local fixture", "results", "desktop", "light", "Fixture sysDescr returns one varbind.", query_get),
        Scenario("agents-required-fields", "Agent validation", "agents", "desktop", "light", "Invalid profile shows actionable validation.", agents_validation),
        Scenario("traps-required-fields", "Trap sender validation", "traps", "desktop", "light", "Invalid send shows actionable validation.", trap_validation),
        Scenario("tools-local-discovery", "Localhost discovery", "tools", "desktop", "dark", "Discovery finds the local SNMP fixture.", tools_discovery),
        Scenario("mib-invalid-paste", "Invalid pasted MIB", "mibs", "phone", "light", "Invalid input produces diagnostics without breaking layout.", mib_paste_validation),
        Scenario("settings-theme", "Theme preference", "settings", "phone", "light", "Dark theme selection persists.", settings_theme),
    ]


def execute(playwright: Playwright, audit: Audit) -> None:
    browser = playwright.chromium.launch(headless=True)
    try:
        all_scenarios = scenarios(audit.base_url)
        only = os.environ.get("MIB_BEACON_AUDIT_ONLY")
        if only:
            all_scenarios = [item for item in all_scenarios if item.id == only]
            if not all_scenarios:
                raise RuntimeError(f"unknown audit scenario: {only}")
        audit.set_plan(all_scenarios)
        for scenario in all_scenarios:
            context = context_for(browser, scenario.viewport, scenario.theme)
            page = context.new_page()
            audit.attach(page)
            try:
                audit.run(page, scenario)
            finally:
                context.close()
    finally:
        browser.close()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default=DEFAULT_BASE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--overwrite", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    output = args.output if args.output.is_absolute() else ROOT / args.output
    audit = Audit(args.base, output, overwrite=args.overwrite)
    try:
        with sync_playwright() as playwright:
            execute(playwright, audit)
    except Exception as error:
        print(f"UI audit stopped on first defect: {error}", file=sys.stderr)
        raise SystemExit(1) from error
    audit.complete()
    print(f"UI audit passed; report: {audit.output / 'report.md'}")


if __name__ == "__main__":
    main()
