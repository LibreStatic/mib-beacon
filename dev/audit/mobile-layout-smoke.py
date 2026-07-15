import os
import re
from collections.abc import Callable, Iterable

from playwright.sync_api import BrowserContext, Page, sync_playwright


BASE = os.environ.get("MIB_BEACON_AUDIT_BASE", "http://127.0.0.1:8899")
PHONE_WIDTHS = (320, 393)
FAILURES: list[str] = []

INTERACTIVE_BOUNDS = r"""() => {
  const visible = (element) => {
    const style = getComputedStyle(element);
    const bounds = element.getBoundingClientRect();
    return style.display !== 'none'
      && style.visibility !== 'hidden'
      && bounds.width > 0
      && bounds.height > 0;
  };
  const selector = [
    'button',
    '[role="button"]',
    '[role="tab"]',
    '[role="adjustable"]',
    'input',
    'textarea',
    'select',
  ].join(',');
  const controls = [...document.querySelectorAll(selector)]
    .filter(visible)
    .map((element) => {
      const bounds = element.getBoundingClientRect();
      return {
        name: (
          element.getAttribute('aria-label')
          || element.innerText
          || element.getAttribute('placeholder')
          || element.tagName
        ).trim().replace(/\s+/g, ' '),
        left: Math.round(bounds.left * 10) / 10,
        right: Math.round(bounds.right * 10) / 10,
      };
    });
  return {
    viewportWidth: innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    clipped: controls.filter((control) => (
      control.left < -1 || control.right > innerWidth + 1
    )),
  };
}"""


def open_route(context: BrowserContext, route: str) -> Page:
    page = context.new_page()
    page.goto(f"{BASE}/#/{route}", wait_until="networkidle")
    page.wait_for_timeout(100)
    return page


def assert_mobile_bounds(page: Page, width: int, stage: str) -> None:
    result = page.evaluate(INTERACTIVE_BOUNDS)
    if result["documentWidth"] > result["viewportWidth"]:
        FAILURES.append(f"{width}px {stage}: document overflow {result}")
    if result["clipped"]:
        FAILURES.append(f"{width}px {stage}: clipped controls {result['clipped']}")


def run_flow(
    context: BrowserContext,
    width: int,
    route: str,
    stages: Iterable[tuple[str, Callable[[Page], None] | None]],
) -> None:
    page = open_route(context, route)
    for stage, action in stages:
        if action:
            action(page)
            page.wait_for_timeout(100)
        assert_mobile_bounds(page, width, stage)
    page.close()


def run_query_states(context: BrowserContext, width: int) -> None:
    page = open_route(context, "results")
    page.get_by_label("Host").fill("127.0.0.1")
    page.get_by_role("button", name="Run Get").click()
    page.get_by_text(re.compile(r"1 varbinds")).wait_for(timeout=10_000)
    assert_mobile_bounds(page, width, "query results")

    page.get_by_role("button", name="Open packet console").click()
    prompt = page.get_by_text("mibbeacon://wire", exact=True).bounding_box()
    if prompt is None or prompt["height"] > 20:
        FAILURES.append(f"{width}px packet console: wrapped prompt {prompt}")
    assert_mobile_bounds(page, width, "packet console with live traffic")
    page.get_by_role("button", name="Collapse packet console").click()

    page.get_by_role("button", name=re.compile(r"PDU log")).click()
    page.wait_for_timeout(100)
    assert_mobile_bounds(page, width, "query PDU log")
    page.close()

    page = open_route(context, "results")
    page.get_by_label("Host").fill("127.0.0.1")
    page.get_by_label("OID").first.fill("1.3.6.1.2.1.1.4.0")
    page.get_by_role("button", name="Set", exact=True).click()
    page.get_by_label("Value").fill("mobile-layout-audit")
    page.get_by_role("button", name="Review Set request").click()
    try:
        page.get_by_text("WRITE CONFIRMATION").wait_for(timeout=10_000)
        assert_mobile_bounds(page, width, "Set review")
    except Exception as error:
        FAILURES.append(f"{width}px Set review: conditional state did not open ({error})")
    page.close()

    page = open_route(context, "results")
    page.get_by_label("Host").fill("192.0.2.1")
    page.get_by_role("button", name="Walk").click()
    page.get_by_role("button", name="Run Walk").click()
    page.wait_for_timeout(100)
    assert_mobile_bounds(page, width, "running or completed walk")
    stop = page.get_by_role("button", name="Stop walk")
    if stop.is_visible(timeout=500):
        stop.click()
    page.close()


def run_tool_outputs(context: BrowserContext, width: int) -> None:
    page = open_route(context, "tools")
    page.get_by_role("button", name="Ping / trace").click()
    page.get_by_role("button", name="Run", exact=True).click()
    page.wait_for_timeout(1_500)
    assert_mobile_bounds(page, width, "ping output")
    page.close()

    page = open_route(context, "tools")
    page.get_by_role("button", name="Discovery").click()
    page.get_by_label("CIDR or inclusive range").fill("127.0.0.1/32")
    page.get_by_label(re.compile(r"Ad-hoc v2c")).fill("public")
    page.get_by_role("button", name="Start", exact=True).click()
    page.get_by_role("button", name="Save agent").wait_for(timeout=10_000)
    assert_mobile_bounds(page, width, "discovery results")
    page.close()

    page = open_route(context, "tools")
    page.get_by_role("button", name="Compare").click()
    page.get_by_label("Walk A (-On numeric output)").fill(
        '.1.3.6.1 = INTEGER: 1\n.1.3.6.2 = STRING: "a"'
    )
    page.get_by_label("Walk B (-On numeric output)").fill(
        '.1.3.6.1 = INTEGER: 2\n.1.3.6.3 = STRING: "b"'
    )
    page.get_by_role("button", name="Parse & diff").click()
    page.wait_for_timeout(200)
    assert_mobile_bounds(page, width, "walk diff results")
    page.close()


def run_trap_outputs(context: BrowserContext, width: int) -> None:
    page = open_route(context, "traps")
    start = page.get_by_role("button", name="Start receiver")
    if start.count():
        start.click()
        page.get_by_text("LIVE", exact=True).wait_for(timeout=5_000)
    assert_mobile_bounds(page, width, "live trap receiver")
    page.get_by_role("button", name="Send", exact=True).click()
    page.get_by_label("Host").fill("127.0.0.1")
    page.get_by_role("button", name=re.compile(r"^Send (trap|inform)$")).click()
    page.wait_for_timeout(1_500)
    assert_mobile_bounds(page, width, "trap send result or history")
    page.close()


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    for width in PHONE_WIDTHS:
        context = browser.new_context(
            viewport={"width": width, "height": 800},
            is_mobile=True,
            has_touch=True,
        )
        run_flow(
            context,
            width,
            "browse",
            [
                ("browse", None),
                (
                    "command palette",
                    lambda page: page.get_by_role(
                        "button", name="Open command palette"
                    ).click(),
                ),
            ],
        )
        run_flow(
            context,
            width,
            "browse",
            [
                (
                    "packet console",
                    lambda page: page.get_by_role(
                        "button", name="Open packet console"
                    ).click(),
                )
            ],
        )
        run_flow(
            context,
            width,
            "browse",
            [
                (
                    "MIB import",
                    lambda page: page.get_by_role("button", name="Import MIB").click(),
                )
            ],
        )
        run_flow(
            context,
            width,
            "browse",
            [
                (
                    "browse detail",
                    lambda page: page.get_by_role(
                        "button", name="View details for iso"
                    ).click(),
                ),
                (
                    "operation sheet",
                    lambda page: page.get_by_role(
                        "button", name="Open operation controls"
                    ).click(),
                ),
            ],
        )
        run_flow(
            context,
            width,
            "results",
            [
                ("results", None),
                (
                    "results SNMPv3",
                    lambda page: page.get_by_role("button", name="v3").click(),
                ),
            ],
        )
        run_flow(
            context,
            width,
            "agents",
            [
                ("agents", None),
                (
                    "agent editor SNMPv3",
                    lambda page: page.get_by_role("button", name="v3").click(),
                ),
            ],
        )
        run_flow(context, width, "mibs", [("MIB catalog", None)])
        run_flow(
            context,
            width,
            "traps",
            [
                ("trap receiver", None),
                (
                    "trap sender",
                    lambda page: page.get_by_role("button", name="Send").click(),
                ),
            ],
        )

        tools = open_route(context, "tools")
        for label in ("Graphs", "Watches", "Discovery", "Compare", "Ports", "Ping / trace"):
            tools.get_by_role("button", name=label, exact=True).click()
            tools.wait_for_timeout(100)
            assert_mobile_bounds(tools, width, f"tools: {label}")
        tools.close()

        run_flow(
            context,
            width,
            "settings",
            [
                ("settings", None),
                (
                    "custom resolver source",
                    lambda page: page.get_by_role("button", name="Add source").click(),
                ),
            ],
        )
        run_query_states(context, width)
        run_tool_outputs(context, width)
        if width == PHONE_WIDTHS[0]:
            run_trap_outputs(context, width)
        context.close()
    browser.close()

assert not FAILURES, "\n".join(FAILURES)
print("mobile layout flow keeps every interactive control within phone viewports")
