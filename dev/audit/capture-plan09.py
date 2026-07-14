from pathlib import Path
import json
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8899"
OUT = Path("docs/audits/plan09/screenshots")
OUT.mkdir(parents=True, exist_ok=True)

VIEWPORTS = {
    "phone": {"width": 390, "height": 844},
    "tablet": {"width": 820, "height": 900},
    "desktop": {"width": 1280, "height": 800},
}
ROUTES = ["browse", "results", "agents", "traps", "tools", "mibs", "settings"]
THEMES = ["light", "dark"]

report = {"captures": [], "console_errors": [], "ui_errors": [], "checks": {}}

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    for viewport_name, viewport in VIEWPORTS.items():
        for theme in THEMES:
            context = browser.new_context(viewport=viewport, color_scheme=theme)
            context.add_init_script(
                script=(
                    f"localStorage.setItem('mibbeacon:theme', {json.dumps(theme)}); "
                    "localStorage.setItem('mibbeacon:density', 'auto');"
                )
            )
            page = context.new_page()
            page.on(
                "console",
                lambda message, v=viewport_name, t=theme: report["console_errors"].append(
                    {"viewport": v, "theme": t, "text": message.text}
                ) if message.type == "error" else None,
            )
            for route in ROUTES:
                page.goto(f"{BASE}/#/{route}", wait_until="networkidle")
                page.wait_for_timeout(200)
                body_text = page.locator("body").inner_text()
                for marker in ("unknown method:", "undefined is not a function"):
                    if marker in body_text.lower():
                        report["ui_errors"].append(
                            {
                                "viewport": viewport_name,
                                "theme": theme,
                                "route": route,
                                "marker": marker,
                            }
                        )
                unnamed_controls = page.locator('[role="button"], button').evaluate_all(
                    "nodes => nodes.filter(node => "
                    "!(node.getAttribute('aria-label') || node.textContent || '').trim()).length"
                )
                report["checks"][
                    f"named-controls-{route}-{viewport_name}-{theme}"
                ] = unnamed_controls == 0
                report["checks"][
                    f"no-body-overflow-{route}-{viewport_name}-{theme}"
                ] = page.locator("body").evaluate(
                    "body => body.scrollWidth <= body.clientWidth + 1"
                )
                target = OUT / f"{route}-{viewport_name}-{theme}.jpg"
                page.screenshot(path=str(target), type="jpeg", quality=72)
                report["captures"].append(str(target))

            page.goto(f"{BASE}/#/browse", wait_until="networkidle")
            page.keyboard.press("?")
            report["checks"][f"shortcut-{viewport_name}-{theme}"] = page.get_by_text(
                "Keyboard shortcuts", exact=True
            ).count() > 0
            context.close()

    context = browser.new_context(viewport=VIEWPORTS["desktop"])
    context.add_init_script("localStorage.setItem('mibbeacon:theme', 'light')")
    page = context.new_page()
    page.goto(f"{BASE}/#/tools", wait_until="networkidle")
    page.set_viewport_size(VIEWPORTS["phone"])
    page.wait_for_timeout(250)
    report["checks"]["resize-preserves-tools-route"] = page.get_by_text("Graphs", exact=True).count() > 0
    report["checks"]["phone-has-five-tabs"] = page.locator("#app-bottom-navigation").get_by_role("button").count() == 5
    context.close()
    browser.close()

Path("docs/audits/plan09/browser-audit.json").write_text(json.dumps(report, indent=2) + "\n")
if report["console_errors"] or report["ui_errors"] or not all(report["checks"].values()):
    raise SystemExit(json.dumps(report, indent=2))
