#!/usr/bin/env python3
"""Execute the versioned AGENTS.md responsive validation matrix."""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

from playwright.sync_api import Page, sync_playwright


ROOT = Path(__file__).resolve().parents[2]
MATRIX_PATH = ROOT / "dev/audit/validation-matrix.v1.json"
REPORT_PATH = ROOT / "docs/audits/validation-matrix-v1.json"
BASE = os.environ.get("MIB_BEACON_AUDIT_BASE", "http://127.0.0.1:8899")


def git_commit() -> str:
    return subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True
    ).strip()


def assert_commit_freshness(commit: str) -> None:
    expected = os.environ.get("MIB_BEACON_AUDIT_COMMIT") or os.environ.get("GITHUB_SHA")
    if expected and commit != expected:
        raise AssertionError(f"tested commit {commit} does not match expected {expected}")


def visible_control_failures(page: Page) -> list[str]:
    return page.locator("button, [role=button], [role=tab], [role=slider], input, textarea, select").evaluate_all(
        r"""nodes => nodes.flatMap((node) => {
          const style = getComputedStyle(node);
          const box = node.getBoundingClientRect();
          const visible = style.display !== 'none' && style.visibility !== 'hidden'
            && box.width > 0 && box.height > 0 && box.left >= 0 && box.right <= innerWidth
            && box.top >= 0 && box.bottom <= innerHeight;
          if (!visible) return [];
          const name = (node.getAttribute('aria-label') || node.innerText
            || node.getAttribute('placeholder') || node.tagName).trim().replace(/\s+/g, ' ');
          const failures = [];
          const x = Math.max(0, Math.min(innerWidth - 1, box.left + box.width / 2));
          const y = Math.max(0, Math.min(innerHeight - 1, box.top + box.height / 2));
          const hits = document.elementsFromPoint(x, y);
          if (!hits.some(hit => hit === node || node.contains(hit) || hit.contains(node)))
            failures.push(`${name}: occluded`);
          return failures;
        })"""
    )


def assert_last_control_reachable(page: Page) -> None:
    result = page.locator("button, [role=button], [role=tab], [role=slider], input, textarea, select").evaluate_all(
        """nodes => {
          const candidates = nodes.filter(node => {
            const style = getComputedStyle(node);
            const box = node.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden'
              && box.width > 0 && box.height > 0 && !node.disabled;
          });
          const node = candidates.at(-1);
          if (!node) return { ok: false, reason: 'no interactive control' };
          node.scrollIntoView({ block: 'center', inline: 'nearest' });
          const box = node.getBoundingClientRect();
          const x = Math.max(0, Math.min(innerWidth - 1, box.left + box.width / 2));
          const y = Math.max(0, Math.min(innerHeight - 1, box.top + box.height / 2));
          const hit = document.elementFromPoint(x, y);
          return {
            ok: box.left >= -1 && box.right <= innerWidth + 1 && box.top >= -1
              && box.bottom <= innerHeight + 1 && !!hit
              && (hit === node || node.contains(hit) || hit.contains(node)),
            reason: (node.getAttribute('aria-label') || node.innerText || node.tagName).trim(),
          };
        }"""
    )
    if not result["ok"]:
        raise AssertionError(f"last control is unreachable: {result['reason']}")


def audit_route(page: Page, route: dict[str, str], viewport: dict[str, int | str]) -> None:
    page.goto(f"{BASE}/#/{route['id']}", wait_until="networkidle")
    page.wait_for_timeout(150)
    if page.url.split("#", 1)[-1] != f"/{route['id']}":
        raise AssertionError(f"route identity changed: {page.url}")
    if route["identity"].lower() not in page.locator("body").inner_text().lower():
        raise AssertionError(f"missing {route['identity']!r} route identity")
    overflow = page.locator("html").evaluate("node => node.scrollWidth > node.clientWidth + 1")
    if overflow:
        raise AssertionError("document has horizontal overflow")
    failures = visible_control_failures(page)
    if failures:
        raise AssertionError("; ".join(failures[:8]))
    assert_last_control_reachable(page)
    if viewport["width"] >= 1024 and route["id"] in {"browse", "results", "traps", "mibs", "settings"}:
        sliders = page.get_by_role("slider")
        for index in range(sliders.count()):
            box = sliders.nth(index).bounding_box()
            if box is None or box["width"] <= 0 or box["height"] <= 0:
                raise AssertionError("nested pane divider is not reachable")


def main() -> None:
    matrix = json.loads(MATRIX_PATH.read_text())
    commit = git_commit()
    assert_commit_freshness(commit)
    report: dict[str, object] = {
        "schemaVersion": matrix["schemaVersion"],
        "testedCommit": commit,
        "baseUrl": BASE,
        "checks": [],
        "failures": [],
    }
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        for viewport in matrix["viewports"]:
            context = browser.new_context(
                viewport={"width": viewport["width"], "height": viewport["height"]},
                is_mobile=viewport["width"] <= 639,
                has_touch=viewport["width"] <= 1023,
            )
            page = context.new_page()
            for route in matrix["routes"]:
                label = f"{viewport['id']}:{route['id']}"
                try:
                    audit_route(page, route, viewport)
                    report["checks"].append(label)
                except Exception as error:  # Playwright adds useful locator context.
                    report["failures"].append({"check": label, "error": str(error)})
            context.close()
        for dialog in matrix["dialogs"]:
            context = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
            page = context.new_page()
            label = f"dialog:{dialog['route']}:{dialog['openButton']}"
            try:
                page.goto(f"{BASE}/#/{dialog['route']}", wait_until="networkidle")
                page.get_by_role("button", name=dialog["openButton"], exact=True).click()
                page.get_by_text(dialog["identity"], exact=False).first.wait_for()
                page.wait_for_timeout(500)
                failures = visible_control_failures(page)
                if failures:
                    raise AssertionError("; ".join(failures[:8]))
                assert_last_control_reachable(page)
                report["checks"].append(label)
            except Exception as error:
                report["failures"].append({"check": label, "error": str(error)})
            context.close()
        browser.close()
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(json.dumps(report, indent=2) + "\n")
    if report["failures"]:
        raise SystemExit(json.dumps(report, indent=2))
    print(f"validation matrix v1 passed for {commit}")


if __name__ == "__main__":
    main()
