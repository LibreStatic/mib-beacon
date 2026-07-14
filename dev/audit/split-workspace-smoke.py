import os

from playwright.sync_api import Locator, Page, sync_playwright


BASE = os.environ.get("MIB_BEACON_AUDIT_BASE", "http://127.0.0.1:8899")


def axis_position(locator: Locator, axis: str) -> float:
    box = locator.bounding_box()
    if box is None:
        raise AssertionError(f"missing bounding box for {locator}")
    return box[axis]


def drag(page: Page, locator: Locator, *, dx: float = 0, dy: float = 0) -> None:
    box = locator.bounding_box()
    if box is None:
        raise AssertionError(f"missing bounding box for {locator}")
    x = box["x"] + box["width"] / 2
    y = box["y"] + box["height"] / 2
    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x + dx, y + dy, steps=12)
    page.mouse.up()
    page.wait_for_timeout(100)


def assert_moved(before: float, after: float, expected_delta: float) -> None:
    actual_delta = after - before
    if expected_delta < 0:
        assert actual_delta < -20, (before, after, expected_delta)
    else:
        assert actual_delta > 20, (before, after, expected_delta)


def open_operation_console(page: Page) -> Locator:
    page.get_by_role("button", name="Focus SNMPv2-MIB").click()
    page.get_by_role("button", name="View details for iso").click()
    page.get_by_role("button", name="Walk here").click()
    vertical = page.get_by_role("slider", name="Resize MIB operation console")
    vertical.wait_for()
    return vertical


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

    vertical = open_operation_console(page)
    assert vertical.evaluate("node => getComputedStyle(node).cursor") == "row-resize"
    vertical_before = axis_position(vertical, "y")
    drag(page, vertical, dy=-80)
    vertical_after = axis_position(vertical, "y")
    assert_moved(vertical_before, vertical_after, -80)
    assert page.evaluate(
        "localStorage.getItem('mibbeacon:browser:dock:mib-navigation')"
    ) is not None

    page.reload(wait_until="networkidle")
    vertical = open_operation_console(page)
    assert abs(axis_position(vertical, "y") - vertical_after) < 2
    assert console_errors == []

    context.close()
    browser.close()

print("split workspace drag, cursor, and persistence checks passed")
