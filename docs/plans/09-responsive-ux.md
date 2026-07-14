# 09 — Responsive UX, Themes & Accessibility

Status: implemented (automated acceptance, browser matrix, and packaged desktop keyboard/AX core
audit complete; physical-device and full assistive-technology journeys pending)
Depends on: 03, 04, 05 (can start once any two are merged; finishes after all feature screens exist)

## Objective

One codebase that feels like a dense desktop engineering tool at ≥1024px, a competent two-pane tablet app, and a focused phone app — not a stretched phone UI on desktop or a shrunken desktop UI on phones. Plus dark/light themes and a real accessibility pass.

## Breakpoint system

Tamagui media queries, defined once in `packages/ui/src/layout.ts`:

| Class     | Width    | Layout                                                                                                                                                                                                                                                    |
| --------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `desktop` | ≥ 1024   | **3-pane iReasoning-style**: left = MIB tree over node-properties panel (resizable split); center/right = tabbed workspace (results, table views, graphs, trap console, tools); top = agent/OID/operation bar. Persistent sidebar nav collapses to icons. |
| `tablet`  | 640–1023 | **2-pane**: collapsible tree drawer (pinned-open in landscape, overlay in portrait); workspace fills the rest; top bar condenses (agent picker + OID field stack).                                                                                        |
| `phone`   | < 640    | **Stack navigation** with bottom tabs: Browse (tree → node detail → run op), Results (tabs list → result), Traps, Tools, Settings. Operation bar becomes a bottom sheet launched from a FAB on node detail.                                               |

Rules:

- Breakpoint class is derived from window/screen width, not platform — a narrow desktop window gets the tablet layout (this is also how you develop/test mobile layouts quickly).
- Same screens/components everywhere; only _composition_ changes (`packages/app/src/layouts/` owns the three compositions). No `Platform.OS` branching for layout — width only. `Platform.OS` branching is allowed for input affordances (hover menus vs long-press sheets) and OS-specific labels (setcap text etc.).
- State (open tabs, selected node, running ops) lives in zustand independent of layout, so rotating a tablet or resizing a window re-composes without losing anything.

## Tasks

### T1 — Layout shells

The three compositions above; resizable split panes on desktop (persisted sizes); tree drawer behavior on tablet; bottom-tab + stack navigation on phone (react-navigation, also driving the tab-strip on desktop workspace). Deep-linkable routes for main screens (helps testing).

### T2 — Input affordances

- Desktop: full keyboard shortcut map (finalize the table started in plan 04; shortcuts overlay on `?`), context menus on right-click, hover tooltips, drag-and-drop MIB import.
- Touch: long-press context sheets everywhere right-click exists, swipe actions on list rows (trap read/delete, tab close), pull-to-refresh on tables/lists where natural, minimum 44pt touch targets.

### T3 — Themes & visual polish

- Dark + light themes (Tamagui tokens; follow system by default, manual override in settings). Verify every screen incl. charts, diff colors, severity colors — define semantic color tokens (`severity.error`, `diff.added`, `status.up`…) not raw palette refs, so both themes and future color-blind adjustments touch one file.
- Density: desktop uses compact row heights/typography (engineering-tool density), phone uses standard; a token-level density switch, not per-screen tweaks.
- App icon + basic brand pass (simple, original mark; no trademark collisions).

### T4 — Accessibility

- Screen-reader labels on all interactive elements (RN `accessibilityLabel`/roles; react-native-web maps to ARIA); focus order sanity on desktop web renderer; visible focus rings; full keyboard operability of tree/table/tabs on desktop.
- Color contrast ≥ WCAG AA in both themes (check the semantic tokens, incl. diff/severity colors on their backgrounds); never color-only status (icons/text accompany the up/down/error colors).
- Dynamic type: layouts survive OS font scaling up to 130% on mobile without truncating critical data (OIDs may middle-ellipsize with tap-to-copy-full).

### T5 — Cross-cutting audit sweep

Walk EVERY screen from plans 03–08 at all three breakpoints × both themes; file/fix issues. Deliverable: a checklist table in this doc (screen × breakpoint × theme = pass/fail) fully green, with screenshots archived in the PR.

## Acceptance criteria

1. Checklist table complete: every screen passes at all three breakpoints in both themes (desktop Linux + Android phone + Android tablet or resized-window equivalents).
2. Resizing desktop window across breakpoints re-composes live without losing open tabs/results/running operations.
3. Phone: full core journey touch-only — import MIB (document picker), resolve missing deps, walk a device, open Table View (rotated), receive a trap — no dead-ends, no hover-only affordances.
4. Desktop: same journey keyboard-only (plus file dialog); shortcuts overlay accurate.
5. Accessibility spot-check: TalkBack (Android) and a desktop screen reader traverse the tree, results table, and trap console meaningfully; contrast check on both themes passes AA.

## Implementation record (2026-07-13)

- Breakpoints match the contract exactly: phone `<640`, tablet `640–1023`, desktop `≥1024`,
  derived only from width and covered by boundary tests.
- Desktop retains persisted keyboard/drag-resizable workbench splits and collapsible icon rail.
  Tablet portrait presents the MIB tree as an overlay drawer while landscape keeps it pinned.
  Phone uses the five planned destinations (Browse, Results, Traps, Tools, Settings), a
  tree-to-detail Browse stack, MIB import access, and an operation FAB/bottom sheet.
- Main screens have stable web/native routes. Zustand operation/result/selection state is outside
  the compositions, so live resize preserves work.
- The app deliberately keeps its lightweight Zustand navigation rather than adding
  `react-navigation`; route, back-stack, tab, and deep-link behavior required by v1 are implemented
  without a second state owner.
- `?` opens a tested shortcut inventory. Tree expansion/selection and split dividers are keyboard
  operable. MIB actions use one right-click/long-press sheet; trap rows and result tabs expose swipe
  actions plus screen-reader actions; MIB/trap lists support pull refresh.
- Shared controls expose roles, labels, selection/disabled state, visible focus borders, 130%
  font scaling, and density-based minimum heights (44 points in comfortable/touch density).
- System/light/dark mode and auto/compact/comfortable density are selectable in Settings.
  Semantic status/diff/severity/focus tokens replace raw feature colors in the critical tools and
  trap paths. Programmatic tests require WCAG AA (4.5:1) in both themes.
- An original beacon-plus-OID-tree vector mark is wired to desktop and Android launcher assets.
- `dev/audit/capture-plan09.py` is the reproducible 42-image screen × breakpoint × theme audit. It
  also checks the shortcut modal, five phone tabs, console errors, and resize state preservation.
- `pnpm audit:flatpak-interactive` runs the packaged Wayland Flatpak with Chromium accessibility
  enabled. Tab/Enter and documented shortcuts completed native portal import, search, SNMP Get,
  a 1,761-row Walk, trap receive, and settings changes. It retained full accessibility-tree
  snapshots for Browse (398 nodes), Query (725), and Traps (434), with required names/roles, then
  proved imported-MIB and preference persistence across restart. A table-specific Walk opened Table
  View, and a second native portal import resolved the fixture's missing IF-MIB dependency after the
  two explicitly opt-in resolver switches were enabled by keyboard.

## Audit matrix

`✓/✓` means both implementation/unit checks and the archived browser screenshot pass. The retained
`docs/audits/plan09/browser-audit.json` records 92 passing checks with no console or in-page engine
errors across the full 42-capture matrix.

| Screen                                                        | Phone light/dark | Tablet light/dark | Desktop light/dark |
| ------------------------------------------------------------- | ---------------- | ----------------- | ------------------ |
| Browse / import / object detail                              | ✓/✓              | ✓/✓               | ✓/✓                |
| Results / operations / Table View                             | ✓/✓              | ✓/✓               | ✓/✓                |
| Agent profiles                                                | ✓/✓              | ✓/✓               | ✓/✓                |
| Trap receive/send console                                     | ✓/✓              | ✓/✓               | ✓/✓                |
| Graphs / watches / discovery / compare / ports / reachability | ✓/✓              | ✓/✓               | ✓/✓                |
| MIB catalog                                                   | ✓/✓              | ✓/✓               | ✓/✓                |
| Settings / resolver sources                                   | ✓/✓              | ✓/✓               | ✓/✓                |

### Remaining release-time evidence

- [x] Run `dev/audit/capture-plan09.py` through the documented localhost helper and archive all 42
      screenshots with a clean `browser-audit.json`.
- [ ] Complete the phone touch-only core journey on a physical Android device.
- [x] Complete the desktop keyboard-only core journey in a packaged build. The retained Flatpak
      audit proves native file selection/import, explicitly opted-in missing-dependency resolution,
      search shortcut, Get, 1,761-row Walk, Table View, trap receive, and settings using Tab/Enter,
      Space, and documented shortcuts.
- [ ] Record TalkBack and a human desktop screen-reader traversal of tree, results table, and trap
      console. Packaged Chromium AX snapshots now directly prove meaningful named nodes on all three,
      but are not represented as a human screen-reader observation.
- [ ] Record 130% dynamic-type screenshots on Android phone/tablet.

These are explicit visual/device/assistive-technology observations; automated implementation and
contrast checks are green.

## Test strategy

- Manual audit sweep (T5) is the core; automate what's cheap: unit tests for the breakpoint-derivation logic and semantic-token contrast (programmatic WCAG check over token pairs).
- Screenshot set committed with the audit for regression eyeballing at release time (plan 10 can automate later).

## Out of scope

Full internationalization (structure strings for it — no hardcoded UI literals in components; a `strings.ts` module — but ship English-only v1), RTL, custom theming/user themes, animation polish beyond stock transitions.
