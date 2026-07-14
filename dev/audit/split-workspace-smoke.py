import os

from playwright.sync_api import Locator, Page, sync_playwright


BASE = os.environ.get("MIB_BEACON_AUDIT_BASE", "http://127.0.0.1:8899")


def axis_position(locator: Locator, axis: str) -> float:
    box = locator.bounding_box()
    if box is None:
        raise AssertionError(f"missing bounding box for {locator}")
    return box[axis]


def drag(
    page: Page, locator: Locator, *, dx: float = 0, dy: float = 0, steps: int = 12
) -> None:
    box = locator.bounding_box()
    if box is None:
        raise AssertionError(f"missing bounding box for {locator}")
    x = box["x"] + box["width"] / 2
    y = box["y"] + box["height"] / 2
    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x + dx, y + dy, steps=steps)
    page.mouse.up()
    page.wait_for_timeout(100)


def assert_moved(before: float, after: float, expected_delta: float) -> None:
    actual_delta = after - before
    if expected_delta < 0:
        assert actual_delta < -20, (before, after, expected_delta)
    else:
        assert actual_delta > 20, (before, after, expected_delta)


def open_operation_console(page: Page) -> tuple[Locator, Locator]:
    page.get_by_role("button", name="Focus SNMPv2-MIB").click()
    page.get_by_role("button", name="View details for iso").click()
    page.get_by_role("button", name="Walk here").click()
    vertical = page.get_by_role("slider", name="Resize MIB operation console")
    vertical.wait_for()
    console_split = page.get_by_role(
        "slider", name="Resize SNMP operation console panes"
    )
    console_split.wait_for(timeout=3_000)
    return vertical, console_split


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context(viewport={"width": 1600, "height": 1000})
    page = context.new_page()
    console_errors: list[str] = []
    page.on(
        "console",
        lambda message: console_errors.append(message.text)
        if message.type == "error"
        else None,
    )
    page.goto(f"{BASE}/#/browse", wait_until="networkidle")

    outer = page.get_by_role("slider", name="Resize mibModules workspace panes")
    inner = page.get_by_role("slider", name="Resize browse workspace panes")

    outer_before = axis_position(outer, "x")
    drag(page, outer, dx=-80)
    outer_after = axis_position(outer, "x")
    assert_moved(outer_before, outer_after, -80)

    inner_before = axis_position(inner, "x")
    drag(page, inner, dx=80)
    inner_after = axis_position(inner, "x")
    assert_moved(inner_before, inner_after, 80)
    assert outer.evaluate("node => getComputedStyle(node).cursor") == "col-resize"
    assert inner.evaluate("node => getComputedStyle(node).cursor") == "col-resize"

    stored_horizontal = page.evaluate(
        "[localStorage.getItem('mibbeacon:split:browser:mibModules'), "
        "localStorage.getItem('mibbeacon:split:browser:browse')]"
    )
    assert all(value is not None for value in stored_horizontal)

    page.reload(wait_until="networkidle")
    assert abs(axis_position(outer, "x") - outer_after) < 2
    assert abs(axis_position(inner, "x") - inner_after) < 2

    vertical, console_split = open_operation_console(page)
    assert vertical.evaluate("node => getComputedStyle(node).cursor") == "row-resize"
    assert console_split.evaluate("node => getComputedStyle(node).cursor") == "col-resize"
    vertical_box = vertical.bounding_box()
    assert vertical_box is not None
    assert vertical_box["height"] >= 16, vertical_box
    page.evaluate(
        "window.__setPointerCapture = Element.prototype.setPointerCapture; "
        "Element.prototype.setPointerCapture = undefined"
    )
    vertical_before = axis_position(vertical, "y")
    drag(page, vertical, dy=-80, steps=1)
    vertical_after = axis_position(vertical, "y")
    assert_moved(vertical_before, vertical_after, -80)
    page.evaluate(
        "Element.prototype.setPointerCapture = window.__setPointerCapture; "
        "delete window.__setPointerCapture"
    )
    console_split_before = axis_position(console_split, "x")
    drag(page, console_split, dx=100)
    console_split_after = axis_position(console_split, "x")
    assert_moved(console_split_before, console_split_after, 100)
    assert page.evaluate(
        "localStorage.getItem('mibbeacon:browser:dock:mib-navigation')"
    ) is not None
    assert page.evaluate(
        "localStorage.getItem('mibbeacon:split:browser:operationConsole')"
    ) is not None

    page.reload(wait_until="networkidle")
    vertical, console_split = open_operation_console(page)
    assert abs(axis_position(vertical, "y") - vertical_after) < 2
    assert abs(axis_position(console_split, "x") - console_split_after) < 2
    assert console_errors == []

    context.close()
    browser.close()

print("split workspace drag, cursor, and persistence checks passed")
