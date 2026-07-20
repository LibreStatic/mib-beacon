from pathlib import Path
import json
import os
from playwright.sync_api import sync_playwright

BASE = os.environ.get("MIB_BEACON_AUDIT_URL", "http://127.0.0.1:8899")
OUT = Path("docs/audits/vscode-themes")
OUT.mkdir(parents=True, exist_ok=True)

VIEWPORTS = {
    "phone": {"width": 390, "height": 844},
    "tablet": {"width": 820, "height": 900},
    "desktop": {"width": 1440, "height": 900},
}
SCHEMES = {
    "dark": {
        "mode": "dark",
        "light": "code-oss-light-modern",
        "dark": "code-oss-dark-modern",
    },
    "light": {
        "mode": "light",
        "light": "code-oss-light-modern",
        "dark": "code-oss-dark-modern",
    },
}

report = {"captures": [], "checks": {}, "console_errors": []}


def check(name, condition):
    report["checks"][name] = bool(condition)


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    for viewport_name, viewport in VIEWPORTS.items():
        for scheme_name, preference in SCHEMES.items():
            context = browser.new_context(viewport=viewport, color_scheme=scheme_name)
            context.add_init_script(
                script=f"""
                    localStorage.setItem('mibbeacon:theme', {json.dumps(preference["mode"])});
                    localStorage.setItem('mibbeacon:theme-light', {json.dumps(preference["light"])});
                    localStorage.setItem('mibbeacon:theme-dark', {json.dumps(preference["dark"])});
                    localStorage.setItem('mibbeacon:density', 'auto');
                """
            )
            page = context.new_page()
            page.on(
                "console",
                lambda message, v=viewport_name, s=scheme_name: (
                    report["console_errors"].append(
                        {"viewport": v, "scheme": s, "text": message.text}
                    )
                    if message.type == "error"
                    else None
                ),
            )
            page.goto(f"{BASE}/#/settings", wait_until="networkidle")
            page.wait_for_timeout(250)
            check(
                f"appearance-visible-{viewport_name}-{scheme_name}",
                page.get_by_text("Appearance & accessibility", exact=True).count() == 1,
            )
            check(
                f"dark-modern-visible-{viewport_name}-{scheme_name}",
                page.get_by_text("Dark Modern", exact=True).count() == 1,
            )
            check(
                f"light-modern-visible-{viewport_name}-{scheme_name}",
                page.get_by_text("Light Modern", exact=True).count() == 1,
            )
            check(
                f"no-body-overflow-{viewport_name}-{scheme_name}",
                page.locator("body").evaluate(
                    "body => body.scrollWidth <= body.clientWidth + 1"
                ),
            )
            theme_import = page.get_by_text("Import VS Code theme", exact=True)
            theme_import.scroll_into_view_if_needed()
            check(
                f"theme-import-reachable-{viewport_name}-{scheme_name}",
                theme_import.is_visible(),
            )
            target = OUT / f"settings-{viewport_name}-{scheme_name}.png"
            page.screenshot(path=str(target), full_page=True)
            report["captures"].append(str(target))
            context.close()

    context = browser.new_context(viewport=VIEWPORTS["desktop"], color_scheme="dark")
    context.add_init_script(
        """
        localStorage.setItem('mibbeacon:theme', 'dark');
        localStorage.setItem('mibbeacon:theme-dark', 'code-oss-dark-modern');
        localStorage.setItem('mibbeacon:theme-light', 'code-oss-light-modern');
        """
    )
    page = context.new_page()
    page.goto(f"{BASE}/#/settings", wait_until="networkidle")
    page.get_by_text("Dark 2026", exact=True).click()
    check(
        "dark-selection-persists",
        page.evaluate("localStorage.getItem('mibbeacon:theme-dark')")
        == "code-oss-dark-2026",
    )

    with page.expect_file_chooser() as chooser:
        page.get_by_text("Import VS Code theme", exact=True).click()
    chooser.value.set_files(
        {
            "name": "audit-night.jsonc",
            "mimeType": "application/json",
            "buffer": b"""
            {
              // JSONC is intentional.
              "name": "Audit Night",
              "type": "dark",
              "colors": {
                "editor.background": "#111111",
                "foreground": "#eeeeee",
                "button.background": "#0066aa",
                "button.foreground": "#ffffff",
              },
            }
            """,
        }
    )
    page.get_by_role("button", name="Audit Night").wait_for()
    check("jsonc-import-installs", page.get_by_text("Audit Night", exact=True).count() >= 1)
    check(
        "jsonc-import-persists",
        "Audit Night"
        in page.evaluate("localStorage.getItem('mibbeacon:installed-themes-v1') || ''"),
    )

    page.get_by_role("button", name="Disabled").click()
    check(
        "open-vsx-opt-in-reveals-search",
        page.get_by_placeholder("e.g. solarized").is_visible(),
    )
    page.screenshot(path=str(OUT / "settings-desktop-imported-dark.png"), full_page=True)
    report["captures"].append(str(OUT / "settings-desktop-imported-dark.png"))
    context.close()
    browser.close()

Path(OUT / "audit.json").write_text(json.dumps(report, indent=2) + "\n")
if report["console_errors"] or not all(report["checks"].values()):
    raise SystemExit(json.dumps(report, indent=2))
print(json.dumps({"checks": len(report["checks"]), "captures": len(report["captures"])}))
