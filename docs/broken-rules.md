# AGENTS.md browser validation findings

Date: 2026-07-20
Target: local LAN web UI at `http://127.0.0.1:8899/`

## Finding: tablet layout overflows and clips the right pane

- **Rule:** `AGENTS.md` requires validating new features on mobile, tablet, and
  desktop for misaligned or unreachable components, unscrollable views, and
  responsive regressions.
- **Viewport:** 800 × 700 CSS pixels (medium/tablet range: 640–1023px).
- **Observed:** The rendered `#app-root` is 990.33px wide even though the
  viewport is 800px wide. `document.body.scrollWidth` is 990px while
  `document.body.clientWidth` is 800px, and the document has horizontal
  overflow hidden. The Browse inspector's right side is therefore clipped and
  unreachable rather than reflowing to the tablet viewport.
- **Evidence:** [tablet screenshot](broken-rules-tablet.png).
- **Fixed evidence:** [tablet screenshot after the fix](broken-rules-tablet-fixed.png).
- **Comparison:** The same runtime measured 390px root/body width at 390px
  mobile and 1440px root/body width at 1440px desktop; the overflow reproduced
  only at the tablet viewport.
- **Reproduction:** Open the local app, set the browser viewport to 800 × 700,
  and load Browse. The split workspace extends beyond the right edge; the
  screenshot shows the truncated “Select a MIB object” inspector.
- **Fix:** Added `min-width: 0` to the web runtime's `#app-root` flex item so it
  can shrink below its contents' intrinsic width.
- **Status:** Fixed and revalidated at 390 × 844, 768 × 1024, 800 × 700, and
  1440 × 900. At every viewport, `#app-root`, `document.body.clientWidth`, and
  `document.body.scrollWidth` matched the viewport width.

## Finding: Settings status pill clips on narrow phones

- **Viewport:** 320 × 844 CSS pixels.
- **Observed:** The “Resolver control room” copy kept its intrinsic width and
  pushed the `DISABLED` status pill beyond the right edge.
- **Evidence:** [clipped Settings header](broken-rules-settings-mobile.png).
- **Fix:** Made the hero copy a shrinkable flex item with `flex: 1` and
  `minWidth: 0`.
- **Fixed evidence:** [Settings header after the fix](broken-rules-settings-mobile-fixed.png).

## Finding: trap receiver action clips in narrow panes

- **Viewports:** 320 × 844 phone and the narrow Receive pane at 768 × 1024.
- **Observed:** The listen-port field retained most of the row width, reducing
  “Start receiver” to a clipped sliver.
- **Evidence:** [clipped trap receiver action](broken-rules-traps-mobile.png).
- **Fix:** Allowed the receiver row to wrap according to its actual pane width
  and gave the action a 120px wrapping basis and minimum.
- **Fixed evidence:** [trap receiver after the fix](broken-rules-traps-mobile-fixed.png).

## Cross-screen follow-up

The Browser, Live MIBs, Results, Agents, Traps, Tools, MIBs, and Settings routes
were rechecked at 320 × 844, 390 × 844, 768 × 1024, and 1440 × 900. Every route
kept `#app-root`, `document.body.clientWidth`, and `document.body.scrollWidth`
equal to the viewport width. Traps Send and all six Tools modes were also
checked at 320px without additional right-edge clipping.
