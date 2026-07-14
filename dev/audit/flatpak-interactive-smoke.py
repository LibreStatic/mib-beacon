#!/usr/bin/env python3
"""Exercise the real Flatpak file portal and persistent application state.

This audit intentionally runs only in an active Wayland user session.  It
temporarily restarts the KDE portal backend with AT-SPI enabled so the native
file chooser can be driven reproducibly, then restores the previous service
environment during cleanup.
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from typing import Any, Iterable
from urllib.request import urlopen

import gi

gi.require_version("Atspi", "2.0")
from gi.repository import Atspi  # noqa: E402
from playwright.sync_api import Browser, Page, sync_playwright  # noqa: E402


ROOT = Path(__file__).resolve().parents[2]
APP_ID = "com.librestatic.mibbeacon"
ARTIFACTS = ROOT / "apps" / "desktop" / "release"
FIXTURE = ROOT / "dev" / "ftp-fixture" / "mibs" / "FIXTURE-MIB.mib"
MISSING_DEPENDENCY_FIXTURE = ROOT / "dev" / "audit" / "fixtures" / "NEEDS-IF-MIB.mib"
REPORT = ROOT / "docs" / "audits" / "flatpak-interactive.json"
SCREENSHOT = ROOT / "docs" / "audits" / "flatpak-interactive-settings.png"
CHART_SCREENSHOT = ROOT / "docs" / "audits" / "flatpak-interactive-chart.png"
CHART_EXPORT = ROOT / "docs" / "audits" / "flatpak-interactive-chart-export.png"
PORTAL_SERVICE = "plasma-xdg-desktop-portal-kde.service"
ACCESSIBILITY_ENV = "QT_LINUX_ACCESSIBILITY_ALWAYS_ON"


class AuditFailure(RuntimeError):
    pass


def run(*args: str, check: bool = True, capture: bool = False) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        check=check,
        text=True,
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.STDOUT if capture else None,
    )


def one_artifact() -> Path:
    matches = sorted(ARTIFACTS.glob("MIB-Beacon-*-linux-x86_64.flatpak"))
    if len(matches) != 1:
        raise AuditFailure(f"expected one x86_64 Flatpak in {ARTIFACTS}, found {len(matches)}")
    return matches[0]


def free_port() -> int:
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


def wait_for_cdp(port: int, process: subprocess.Popen[str], timeout: float = 30) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise AuditFailure(f"Flatpak exited before DevTools became ready ({process.returncode})")
        try:
            with urlopen(f"http://127.0.0.1:{port}/json/version", timeout=0.5) as response:
                if response.status == 200:
                    return
        except OSError:
            time.sleep(0.2)
    raise AuditFailure("timed out waiting for the packaged renderer DevTools endpoint")


def launch(port: int, log: Path) -> subprocess.Popen[str]:
    stream = log.open("a", encoding="utf-8")
    process = subprocess.Popen(
        [
            "flatpak",
            "run",
            "--user",
            "--env=ACCESSIBILITY_ENABLED=1",
            "--nosocket=x11",
            "--socket=wayland",
            APP_ID,
            f"--remote-debugging-port={port}",
            "--force-renderer-accessibility",
        ],
        text=True,
        stdout=stream,
        stderr=subprocess.STDOUT,
    )
    process._mibbeacon_log_stream = stream  # type: ignore[attr-defined]
    wait_for_cdp(port, process)
    return process


def stop_after_window_close(process: subprocess.Popen[str]) -> None:
    try:
        process.wait(timeout=15)
    except subprocess.TimeoutExpired as cause:
        raise AuditFailure("packaged app did not exit after its last window closed") from cause
    stream = getattr(process, "_mibbeacon_log_stream", None)
    if stream:
        stream.close()
    if process.returncode != 0:
        raise AuditFailure(f"packaged app exited with status {process.returncode}")


def children(node: Any) -> Iterable[Any]:
    for index in range(node.get_child_count()):
        try:
            yield node.get_child_at_index(index)
        except Exception:
            continue


def descendants(node: Any) -> Iterable[Any]:
    yield node
    for child in children(node):
        yield from descendants(child)


def portal_dialog(timeout: float = 15) -> Any:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        desktop = Atspi.get_desktop(0)
        for application in children(desktop):
            if application.get_name() != "xdg-desktop-portal-kde":
                continue
            for node in descendants(application):
                if node.get_role_name() == "dialog" and node.get_name() == "Open Files":
                    return node
        time.sleep(0.2)
    raise AuditFailure("the KDE Open Files portal did not become accessible through AT-SPI")


def portal_select_file(path: Path) -> None:
    dialog = portal_dialog()
    editable = None
    open_button = None
    for node in descendants(dialog):
        role = node.get_role_name()
        name = node.get_name()
        if role == "combo box" and name == "Name:":
            for candidate in descendants(node):
                try:
                    editable = candidate.get_editable_text_iface()
                except Exception:
                    continue
                if editable:
                    break
        if role == "button" and name == "Open":
            open_button = node
    if not editable or not open_button:
        raise AuditFailure("the portal did not expose its filename field and Open action")
    if not editable.set_text_contents(str(path)):
        raise AuditFailure("the portal filename field rejected the fixture path")
    action = open_button.get_action_iface()
    if not action or not action.do_action(0):
        raise AuditFailure("the portal Open action failed")


def connect_page(playwright: Any, port: int) -> tuple[Browser, Page]:
    browser = playwright.chromium.connect_over_cdp(f"http://127.0.0.1:{port}")
    if len(browser.contexts) != 1 or len(browser.contexts[0].pages) != 1:
        raise AuditFailure("expected exactly one packaged renderer page")
    page = browser.contexts[0].pages[0]
    page.get_by_text("Engine ready", exact=True).wait_for(timeout=20_000)
    return browser, page


def close_window(page: Page, browser: Browser) -> None:
    page.close()
    browser.close()


def active_identity(page: Page) -> dict[str, str]:
    return page.evaluate(
        """() => {
          const element = document.activeElement;
          return {
            aria: element?.getAttribute('aria-label') ?? '',
            placeholder: element?.getAttribute('placeholder') ?? '',
            text: (element?.innerText ?? '').trim(),
          };
        }"""
    )


def keyboard_focus(page: Page, name: str, limit: int = 2_000) -> None:
    # Reset to the document entry point without activating any control; every
    # subsequent traversal and activation is still performed with Tab/Enter.
    page.evaluate(
        """() => {
          document.body.setAttribute('tabindex', '-1');
          document.body.focus();
          document.body.removeAttribute('tabindex');
        }"""
    )
    for _ in range(limit):
        page.keyboard.press("Tab")
        identity = active_identity(page)
        if name in (identity["aria"], identity["placeholder"], identity["text"]):
            return
    raise AuditFailure(f"keyboard focus order did not reach {name!r}")


def keyboard_activate(page: Page, name: str) -> None:
    keyboard_focus(page, name)
    page.keyboard.press("Enter")


def keyboard_replace(page: Page, name: str, value: str) -> None:
    keyboard_focus(page, name)
    page.keyboard.press("Control+A")
    page.keyboard.type(value)


def keyboard_toggle(page: Page, name: str, checked: bool) -> None:
    control = page.get_by_role("switch", name=name)
    # React Native Web renders Switch as a native checkbox with role=switch.
    # Its checked state is implicit and is not mirrored to an aria-checked
    # attribute, so inspect the native checked property through Playwright.
    current = control.is_checked()
    if current != checked:
        keyboard_focus(page, name)
        page.keyboard.press("Space")
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        if control.is_checked() == checked:
            return
        time.sleep(0.05)
    raise AuditFailure(f"keyboard did not set {name!r} to {checked}")


def accessibility_snapshot(page: Page, expected_names: tuple[str, ...]) -> dict[str, Any]:
    session = page.context.new_cdp_session(page)
    tree = session.send("Accessibility.getFullAXTree")["nodes"]
    nodes = [
        {
            "role": node.get("role", {}).get("value", ""),
            "name": node.get("name", {}).get("value", ""),
        }
        for node in tree
        if not node.get("ignored", False)
    ]
    names = {str(node["name"]) for node in nodes}
    missing = [name for name in expected_names if name not in names]
    if missing:
        raise AuditFailure(f"packaged accessibility tree is missing: {missing}")
    return {"nodeCount": len(nodes), "requiredNames": list(expected_names)}


def send_fixture_trap() -> None:
    script = """
const snmp = require('net-snmp');
const session = snmp.createSession('127.0.0.1', 'public', { trapPort: 1162 });
session.trap(snmp.TrapType.ColdStart, [], { upTime: 1 }, (error) => {
  if (error) { console.error(error); process.exitCode = 1; }
  setTimeout(() => session.close(), 100);
});
"""
    run("node", "-e", script)


def environment_value(name: str) -> str | None:
    output = run("systemctl", "--user", "show-environment", capture=True).stdout
    prefix = f"{name}="
    return next((line[len(prefix) :] for line in output.splitlines() if line.startswith(prefix)), None)


def configure_accessible_portal() -> str | None:
    previous = environment_value(ACCESSIBILITY_ENV)
    run("systemctl", "--user", "set-environment", f"{ACCESSIBILITY_ENV}=1")
    run("systemctl", "--user", "restart", PORTAL_SERVICE)
    return previous


def restore_portal(previous: str | None) -> None:
    if previous is None:
        run("systemctl", "--user", "unset-environment", ACCESSIBILITY_ENV, check=False)
    else:
        run("systemctl", "--user", "set-environment", f"{ACCESSIBILITY_ENV}={previous}", check=False)
    run("systemctl", "--user", "restart", PORTAL_SERVICE, check=False)


def main() -> int:
    if os.environ.get("XDG_SESSION_TYPE") != "wayland" or not os.environ.get("WAYLAND_DISPLAY"):
        raise AuditFailure("this interactive audit requires an active Wayland desktop session")
    for command in ("flatpak", "dbus-monitor", "gio", "systemctl", "xdg-mime"):
        if not shutil.which(command):
            raise AuditFailure(f"required command is missing: {command}")
    if run("flatpak", "info", "--user", APP_ID, check=False).returncode == 0:
        raise AuditFailure(f"refusing to replace an existing user installation of {APP_ID}")
    data_dir = Path.home() / ".var" / "app" / APP_ID
    if data_dir.exists():
        raise AuditFailure(f"refusing to replace existing Flatpak application data at {data_dir}")

    artifact = one_artifact()
    for fixture in (FIXTURE, MISSING_DEPENDENCY_FIXTURE):
        if not fixture.is_file():
            raise AuditFailure(f"missing fixture: {fixture}")
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    previous_portal_env: str | None = None
    installed = False
    process: subprocess.Popen[str] | None = None
    monitor: subprocess.Popen[str] | None = None
    notification_monitor: subprocess.Popen[str] | None = None
    started = time.time()

    with tempfile.TemporaryDirectory(prefix="mibbeacon-flatpak-interactive-") as temp_name:
        temp = Path(temp_name)
        app_log = temp / "app.log"
        portal_log = temp / "portal.log"
        notification_log = temp / "notifications.log"
        association_files = []
        for extension in ("mib", "my", "smi"):
            path = temp / f"ASSOCIATION-MIB.{extension}"
            shutil.copyfile(FIXTURE, path)
            association_files.append(path)
        try:
            previous_portal_env = configure_accessible_portal()
            run("flatpak", "install", "--user", "--noninteractive", "--no-deps", "--reinstall", str(artifact))
            installed = True

            port = free_port()
            process = launch(port, app_log)
            monitor_stream = portal_log.open("w", encoding="utf-8")
            monitor = subprocess.Popen(
                ["stdbuf", "-oL", "dbus-monitor", "interface='org.freedesktop.portal.FileChooser'"],
                text=True,
                stdout=monitor_stream,
                stderr=subprocess.STDOUT,
            )
            notification_stream = notification_log.open("w", encoding="utf-8")
            notification_monitor = subprocess.Popen(
                [
                    "stdbuf",
                    "-oL",
                    "dbus-monitor",
                    "interface='org.freedesktop.Notifications'",
                ],
                text=True,
                stdout=notification_stream,
                stderr=subprocess.STDOUT,
            )
            with sync_playwright() as playwright:
                browser, page = connect_page(playwright, port)
                keyboard_activate(page, "Import")
                keyboard_activate(page, "Choose files")
                portal_select_file(FIXTURE)
                page.get_by_text("Review file import", exact=True).wait_for(timeout=20_000)
                page.get_by_text("FIXTURE-MIB.mib", exact=False).wait_for(timeout=10_000)
                keyboard_activate(page, "Import 1 files")
                page.get_by_text("Loaded: FIXTURE-MIB", exact=True).wait_for(timeout=20_000)
                keyboard_activate(page, "Close")

                expected_mime = {
                    "mib": "application/x-mib",
                    "my": "application/x-mib",
                    # shared-mime-info owns .smi as SMIL. Flatpak intentionally
                    # strips exported magic and lowers custom glob priority, so
                    # the desktop entry explicitly claims this host MIME name.
                    "smi": "application/smil+xml",
                }
                desktop_file = (
                    Path.home()
                    / ".local/share/flatpak/exports/share/applications"
                    / f"{APP_ID}.desktop"
                )
                if not desktop_file.is_file():
                    raise AuditFailure(f"Flatpak did not export its desktop entry: {desktop_file}")
                desktop_contents = desktop_file.read_text(encoding="utf-8")
                for path in association_files:
                    detected = run(
                        "xdg-mime", "query", "filetype", str(path), capture=True
                    ).stdout.strip()
                    if detected != expected_mime[path.suffix[1:]]:
                        raise AuditFailure(
                            f"{path.name} registered as {detected!r}, expected "
                            f"{expected_mime[path.suffix[1:]]!r}"
                        )
                    if detected not in desktop_contents:
                        raise AuditFailure(
                            f"exported desktop entry does not claim detected MIME {detected!r}"
                        )
                    run("gio", "launch", str(desktop_file), str(path))
                    page.get_by_text("Review file import", exact=True).wait_for(timeout=15_000)
                    page.get_by_text(path.name, exact=False).wait_for(timeout=10_000)
                    keyboard_activate(page, "Close review")

                page.keyboard.type("?")
                shortcut_heading = page.get_by_text("Keyboard shortcuts", exact=True).last
                shortcut_heading.wait_for(timeout=5_000)
                page.keyboard.press("Escape")
                shortcut_heading.wait_for(state="hidden", timeout=5_000)
                page.keyboard.press("Control+F")
                page.locator("input[placeholder='Search name, OID, or description…']:focus").wait_for(
                    timeout=5_000
                )
                browse_accessibility = accessibility_snapshot(
                    page,
                    ("Browse", "Import", "Search name, OID, or description…", "Expand iso"),
                )
                page.keyboard.type("sysDescr")
                page.get_by_text("sysDescr", exact=True).first.wait_for(timeout=10_000)

                keyboard_activate(page, "Query")
                keyboard_replace(page, "Host", "127.0.0.1")
                keyboard_replace(page, "Port", "1611")
                keyboard_replace(page, "OID", "1.3.6.1.2.1.1.1.0")
                keyboard_activate(page, "Run Get")
                page.get_by_text(re.compile("spike test agent", re.IGNORECASE)).first.wait_for(
                    timeout=20_000
                )
                keyboard_replace(page, "OID", "1.3.6.1.2.1")
                keyboard_activate(page, "Walk")
                keyboard_activate(page, "Run Walk")
                page.get_by_text(re.compile(r"^1[0-9]{3} varbinds")).wait_for(timeout=30_000)
                query_accessibility = accessibility_snapshot(
                    page,
                    ("Query", "Host", "Port", "OID", "Run Walk", "CSV", "JSON"),
                )

                keyboard_replace(page, "OID", "1.3.6.1.2.1.2.2")
                keyboard_activate(page, "Run Walk")
                page.get_by_text(re.compile(r"^(?!1761 )[1-9][0-9]* varbinds")).wait_for(
                    timeout=30_000
                )
                table_view_opened = False
                if page.get_by_role("button", name="Open table").count() > 0:
                    keyboard_activate(page, "Open table")
                    page.get_by_text(re.compile("Table View", re.IGNORECASE)).first.wait_for(
                        timeout=10_000
                    )
                    table_view_opened = True

                keyboard_activate(page, "Settings")
                keyboard_toggle(page, "Enable resolver", True)
                keyboard_toggle(page, "Resolve missing imports automatically", True)
                keyboard_activate(page, "Browse")
                keyboard_activate(page, "Import")
                keyboard_activate(page, "Choose files")
                portal_select_file(MISSING_DEPENDENCY_FIXTURE)
                page.get_by_text("Review file import", exact=True).wait_for(timeout=20_000)
                page.get_by_text("NEEDS-IF-MIB.mib", exact=False).wait_for(timeout=10_000)
                keyboard_activate(page, "Import 1 files")
                page.get_by_text("Search configured external sources?", exact=True).wait_for(
                    timeout=10_000
                )
                keyboard_activate(page, "Continue")
                page.get_by_text(re.compile(r"Loaded:.*NEEDS-IF-MIB")).wait_for(timeout=60_000)
                if page.get_by_text("IF-MIB", exact=True).count() == 0:
                    raise AuditFailure("the packaged resolver did not load missing IF-MIB")
                keyboard_activate(page, "Close")

                keyboard_activate(page, "Traps")
                keyboard_activate(page, "Receive")
                if page.get_by_role("button", name=re.compile(r"^Stop \(")).count() > 0:
                    stop_name = page.get_by_role("button", name=re.compile(r"^Stop \(")).first.get_attribute(
                        "aria-label"
                    )
                    if stop_name:
                        keyboard_activate(page, stop_name)
                keyboard_replace(page, "Listen port", "1162")
                keyboard_activate(page, "udp4")
                keyboard_activate(page, "Start receiver")
                page.get_by_role("button", name=re.compile(r"^Stop \(")).first.wait_for(timeout=10_000)
                send_fixture_trap()
                page.get_by_text(re.compile(r"[1-9][0-9]* stored")).first.wait_for(timeout=20_000)
                traps_accessibility = accessibility_snapshot(
                    page,
                    ("Traps", "Receive", "Send", "Listen port", "udp4"),
                )
                stop_name = page.get_by_role("button", name=re.compile(r"^Stop \(")).first.get_attribute(
                    "aria-label"
                )
                if stop_name:
                    keyboard_activate(page, stop_name)

                keyboard_activate(page, "Agents")
                keyboard_replace(page, "Name", "Audit agent")
                keyboard_replace(page, "Host", "127.0.0.1")
                keyboard_replace(page, "Port", "1611")
                keyboard_replace(page, "Community", "public")
                keyboard_activate(page, "Create profile")
                try:
                    page.get_by_text("Audit agent", exact=True).first.wait_for(timeout=10_000)
                except Exception as cause:
                    visible = page.locator("body").inner_text()[-2_000:]
                    raise AuditFailure(
                        f"packaged agent profile creation failed; visible tail: {visible!r}"
                    ) from cause

                keyboard_activate(page, "Tools")
                keyboard_activate(page, "Audit agent")
                keyboard_replace(page, "Name", "Audit sysUpTime")
                keyboard_activate(page, "Create series")
                chart = page.get_by_label("Performance history line chart")
                chart.wait_for(timeout=15_000)
                keyboard_activate(page, "Sample now")
                chart.wait_for(timeout=15_000)
                time.sleep(0.25)
                keyboard_activate(page, "Sample now")
                chart.click(position={"x": 80, "y": 100})
                page.get_by_text(re.compile(r"Audit sysUpTime · [0-9]")).wait_for(
                    timeout=10_000
                )
                page.screenshot(path=str(CHART_SCREENSHOT), full_page=True)
                page.evaluate(
                    """() => {
                      const original = URL.createObjectURL.bind(URL);
                      window.__mibBeaconAuditPng = null;
                      URL.createObjectURL = (value) => {
                        if (value instanceof Blob && value.type === 'image/png') {
                          window.__mibBeaconAuditPng = value;
                        }
                        return original(value);
                      };
                    }"""
                )
                with page.expect_download(timeout=15_000) as download_info:
                    keyboard_activate(page, "PNG")
                download = download_info.value
                if download.suggested_filename != "performance-history.png":
                    raise AuditFailure(
                        f"unexpected chart download name: {download.suggested_filename!r}"
                    )
                png = bytes(
                    page.evaluate(
                        """async () => {
                          const blob = window.__mibBeaconAuditPng;
                          return blob ? Array.from(new Uint8Array(await blob.arrayBuffer())) : [];
                        }"""
                    )
                )
                CHART_EXPORT.write_bytes(png)
                if len(png) < 1_000 or not png.startswith(b"\x89PNG\r\n\x1a\n"):
                    raise AuditFailure(
                        "the packaged chart PNG export is invalid "
                        f"({len(png)} bytes; failure={download.failure()!r})"
                    )

                keyboard_activate(page, "Watches")
                keyboard_activate(page, "Audit sysUpTime")
                keyboard_replace(page, "Name", "Audit watch")
                keyboard_activate(page, "Save watch")
                page.get_by_text("Audit watch", exact=True).wait_for(timeout=10_000)
                keyboard_activate(page, "Graphs")
                keyboard_activate(page, "Sample now")
                keyboard_activate(page, "Watches")
                page.get_by_text("BREACH", exact=True).wait_for(timeout=15_000)

                keyboard_activate(page, "Settings")
                keyboard_activate(page, "dark")
                keyboard_activate(page, "comfortable")
                preferences = page.evaluate(
                    "[localStorage.getItem('mibbeacon:theme'), localStorage.getItem('mibbeacon:density')]"
                )
                if preferences != ["dark", "comfortable"]:
                    raise AuditFailure(f"settings were not written: {preferences!r}")
                close_window(page, browser)
            stop_after_window_close(process)
            process = None

            if monitor:
                monitor.terminate()
                monitor.wait(timeout=5)
                monitor = None
                monitor_stream.close()
            if notification_monitor:
                notification_monitor.terminate()
                notification_monitor.wait(timeout=5)
                notification_monitor = None
                notification_stream.close()
            portal_text = portal_log.read_text(encoding="utf-8")
            required_portal_evidence = (
                "org.freedesktop.portal.FileChooser",
                "member=OpenFile",
                'string "Open Files"',
                'string "*.[mM][iI][bB]"',
                'string "multiple"',
            )
            missing = [item for item in required_portal_evidence if item not in portal_text]
            if missing:
                raise AuditFailure(f"portal call evidence is incomplete: {missing}")
            notification_text = notification_log.read_text(encoding="utf-8")
            required_notification_evidence = (
                "org.freedesktop.Notifications",
                "member=Notify",
                "Watch threshold: Audit watch",
            )
            missing = [
                item for item in required_notification_evidence if item not in notification_text
            ]
            if missing:
                raise AuditFailure(f"desktop notification evidence is incomplete: {missing}")

            port = free_port()
            process = launch(port, app_log)
            with sync_playwright() as playwright:
                browser, page = connect_page(playwright, port)
                preferences = page.evaluate(
                    "[localStorage.getItem('mibbeacon:theme'), localStorage.getItem('mibbeacon:density')]"
                )
                if preferences != ["dark", "comfortable"]:
                    raise AuditFailure(f"settings did not survive a graceful restart: {preferences!r}")
                if page.get_by_text("FIXTURE-MIB", exact=True).count() != 1:
                    raise AuditFailure("the portal-imported MIB did not survive restart")
                page.get_by_role("button", name="Settings").click()
                page.screenshot(path=str(SCREENSHOT), full_page=True)
                close_window(page, browser)
            stop_after_window_close(process)
            process = None

            log_text = app_log.read_text(encoding="utf-8")
            if log_text.count("ENGINE_READY") != 2:
                raise AuditFailure("both packaged launches did not report ENGINE_READY")
            report = {
                "schemaVersion": 1,
                "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "durationMs": round((time.time() - started) * 1000),
                "artifact": artifact.name,
                "artifactSha256": hashlib.sha256(artifact.read_bytes()).hexdigest(),
                "session": "Wayland-only Flatpak",
                "portal": {
                    "interface": "org.freedesktop.portal.FileChooser",
                    "method": "OpenFile",
                    "multiple": True,
                    "mibFilterObserved": True,
                    "nativeSelectionCompletedViaAtSpi": True,
                },
                "import": {
                    "fixture": FIXTURE.name,
                    "reviewObserved": True,
                    "loadedModule": "FIXTURE-MIB",
                    "persistedAcrossRestart": True,
                },
                "fileAssociations": {
                    "desktopEntry": f"{APP_ID}.desktop",
                    "extensions": [".mib", ".my", ".smi"],
                    "mimeTypes": expected_mime,
                    "reviewFlowOpenedViaGio": True,
                },
                "settings": {
                    "theme": "dark",
                    "density": "comfortable",
                    "persistedAcrossRestart": True,
                },
                "keyboardOnly": {
                    "nativePortalImport": True,
                    "shortcutOverlay": True,
                    "searchShortcut": True,
                    "snmpGet": True,
                    "streamedWalk": True,
                    "tableViewOpened": table_view_opened,
                    "missingDependencyResolved": True,
                    "trapReceive": True,
                    "settingsChanged": True,
                },
                "accessibilitySnapshots": {
                    "browse": browse_accessibility,
                    "query": query_accessibility,
                    "traps": traps_accessibility,
                },
                "packagedVisuals": {
                    "chartRendered": True,
                    "chartScreenshot": str(CHART_SCREENSHOT.relative_to(ROOT)),
                    "tooltipObserved": True,
                    "pngExported": True,
                    "pngExport": str(CHART_EXPORT.relative_to(ROOT)),
                    "watchBreached": True,
                    "desktopNotificationObservedViaDbus": True,
                },
                "launches": 2,
                "screenshot": str(SCREENSHOT.relative_to(ROOT)),
                "result": "passed",
            }
            REPORT.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
            print(json.dumps(report, indent=2))
            print("Flatpak portal import and settings persistence passed")
            return 0
        finally:
            if monitor and monitor.poll() is None:
                monitor.terminate()
                monitor.wait(timeout=5)
            if notification_monitor and notification_monitor.poll() is None:
                notification_monitor.terminate()
                notification_monitor.wait(timeout=5)
            if process and process.poll() is None:
                run("flatpak", "kill", APP_ID, check=False)
                process.wait(timeout=10)
            if installed:
                run(
                    "flatpak",
                    "uninstall",
                    "--user",
                    "--noninteractive",
                    "--delete-data",
                    APP_ID,
                    check=False,
                )
            if previous_portal_env is not None or environment_value(ACCESSIBILITY_ENV) == "1":
                restore_portal(previous_portal_env)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except AuditFailure as error:
        print(f"flatpak-interactive-smoke: {error}", file=sys.stderr)
        raise SystemExit(1)
