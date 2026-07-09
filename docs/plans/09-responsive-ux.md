# 09 — Responsive UX, Themes & Accessibility

Status: not-started
Depends on: 03, 04, 05 (can start once any two are merged; finishes after all feature screens exist)

## Objective

One codebase that feels like a dense desktop engineering tool at ≥1024px, a competent two-pane tablet app, and a focused phone app — not a stretched phone UI on desktop or a shrunken desktop UI on phones. Plus dark/light themes and a real accessibility pass.

## Breakpoint system

Tamagui media queries, defined once in `packages/ui/src/layout.ts`:

| Class | Width | Layout |
|---|---|---|
| `desktop` | ≥ 1024 | **3-pane iReasoning-style**: left = MIB tree over node-properties panel (resizable split); center/right = tabbed workspace (results, table views, graphs, trap console, tools); top = agent/OID/operation bar. Persistent sidebar nav collapses to icons. |
| `tablet` | 640–1023 | **2-pane**: collapsible tree drawer (pinned-open in landscape, overlay in portrait); workspace fills the rest; top bar condenses (agent picker + OID field stack). |
| `phone` | < 640 | **Stack navigation** with bottom tabs: Browse (tree → node detail → run op), Results (tabs list → result), Traps, Tools, Settings. Operation bar becomes a bottom sheet launched from a FAB on node detail. |

Rules:
- Breakpoint class is derived from window/screen width, not platform — a narrow desktop window gets the tablet layout (this is also how you develop/test mobile layouts quickly).
- Same screens/components everywhere; only *composition* changes (`packages/app/src/layouts/` owns the three compositions). No `Platform.OS` branching for layout — width only. `Platform.OS` branching is allowed for input affordances (hover menus vs long-press sheets) and OS-specific labels (setcap text etc.).
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

## Test strategy
- Manual audit sweep (T5) is the core; automate what's cheap: unit tests for the breakpoint-derivation logic and semantic-token contrast (programmatic WCAG check over token pairs).
- Screenshot set committed with the audit for regression eyeballing at release time (plan 10 can automate later).

## Out of scope
Full internationalization (structure strings for it — no hardcoded UI literals in components; a `strings.ts` module — but ship English-only v1), RTL, custom theming/user themes, animation polish beyond stock transitions.
