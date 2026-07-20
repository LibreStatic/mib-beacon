# MIB Beacon Design System

This document is the living design contract for MIB Beacon. It records the visual,
interaction, theming, accessibility, and responsive-layout criteria established by
the VS Code-inspired workbench redesign. New UI should extend these rules rather
than introduce a parallel visual language.

`AGENTS.md` remains authoritative for repository workflow and validation
requirements. This document explains the product and implementation intent behind
those requirements.

## Product character

MIB Beacon is a network engineering workbench, not a collection of unrelated
mobile-style forms. It should feel:

- **Dense but legible:** show useful operational context without crowding touch
  targets or reducing readability.
- **Tool-oriented:** prioritize browsing, inspection, comparison, and repeatable
  actions over decorative presentation.
- **Calm under load:** activity, warnings, and live data should be clear without
  causing unnecessary motion or layout shifts.
- **Cross-platform:** desktop, web, tablet, and phone are different compositions of
  the same product, not separate products.
- **Keyboard-first, never keyboard-only:** fast global commands coexist with
  discoverable mouse and touch controls.
- **Theme-faithful and safe:** preserve the character of a selected theme while
  repairing colors that would make the application inaccessible.

The redesign takes interaction and information-architecture cues from the VS Code
workbench. It does not attempt to reproduce VS Code pixel for pixel or turn MIB
Beacon into a code editor.

We adopt the workbench hierarchy, global palette pattern, engineering density, and
color-theme compatibility. We do not adopt editor semantics, extension-provided UI
or executable code, exact VS Code shortcuts, or pixel-for-pixel layout.

## Design principles

### 1. One workbench, adaptive compositions

The information hierarchy stays consistent across form factors, while navigation
and pane composition adapt to available space.

| Mode     |        Width | Primary navigation                   | Composition                                                                |
| -------- | -----------: | ------------------------------------ | -------------------------------------------------------------------------- |
| Compact  |   `<= 639px` | Header actions and bottom navigation | Single primary task; stack or move secondary work into reachable overlays  |
| Medium   | `640–1023px` | Icon activity rail with tooltips     | Split views are allowed; use touch-comfortable density by default          |
| Expanded |  `>= 1024px` | Labeled sidebar                      | Full workbench and split panes; use compact engineering density by default |

The canonical breakpoints live in
[`packages/ui/src/breakpoints.ts`](packages/ui/src/breakpoints.ts). Components must
consume the shared responsive context rather than inventing local device-name
breakpoints. Width means `useWindowDimensions().width`: CSS pixels on web and
logical layout points on native.

Rules:

- Preserve the same task vocabulary across modes even when the navigation surface
  changes.
- Do not make a desktop view by merely stretching a phone screen.
- Use persistent split panes only where the available width keeps both tasks
  useful.
- On compact screens, preserve the workflow by stacking, scrolling, or presenting
  a focused dialog/sheet rather than shrinking required controls beyond usability.
- If content can exceed a viewport or pane, every required control and result must
  remain deliberately scrollable and reachable.
- Pane ratios must be clamped to protect the minimum usable size of both sides.
  `SplitWorkspace` and `VerticalDockWorkspace` own their primary/secondary minimums,
  and all stored, dragged, or keyboard-adjusted ratios must pass through
  `clampSplitRatio`. Shared split behavior belongs in
  [`packages/app/src/responsive-layout.ts`](packages/app/src/responsive-layout.ts).

### 2. Stable workbench chrome

The application shell provides stable landmarks:

- **Activity bar / navigation rail:** switches primary tools.
- **Sidebar:** adds labels, product identity, packet activity, commands, shortcuts,
  window actions, and engine status when space permits.
- **Title/header surface:** carries compact-mode identity and global actions.
- **Workbench body:** owns the active task and its panes.
- **Panel surface:** contains secondary consoles, inspectors, and docked work.
- **Status surface:** communicates persistent global status when present.
- **Command Palette:** is the global, searchable action surface.

Chrome colors must come from `theme.workbench`, not generic card colors or
hard-coded approximations. The semantic workbench token set is defined in
[`packages/ui/src/theme-types.ts`](packages/ui/src/theme-types.ts).

Navigation should remain predictable:

- Desktop and tablet expose the complete workbench tool set.
- Compact mode may consolidate or omit destinations that are represented inside a
  primary workflow, but it must not make the underlying capability unreachable.
- Selection is communicated with color plus structure/state, never color alone.
- Icon-only rail actions require accessible names and visible tooltips.
- Badge counts must remain legible at large values and in every supported theme.

### 3. Progressive disclosure over page sprawl

Keep the primary workspace focused. Use:

- tabs for peer views within the same tool;
- split panes for related tasks that benefit from simultaneous visibility;
- docked panels for ongoing secondary activity;
- dialogs or sheets for bounded, multi-step, or destructive work;
- expandable advanced sections for uncommon configuration.

Do not solve complexity with an indefinitely long settings-style page. Do not hide
critical state in hover-only surfaces. On touch devices, every disclosed surface
must have an explicit way to open, scroll, and close it.

### 4. State must remain trustworthy

Visual polish cannot obscure operational truth.

- Loading, empty, stale, success, warning, and error states must be distinct.
- Prefer skeletons or stable placeholders when content is expected to arrive;
  avoid controls jumping as data loads.
- Routine success feedback should be non-blocking and must not shift the main
  layout.
- Destructive or high-impact actions require explicit wording and confirmation.
- Remote-backed editable controls keep the draft value separate from the last
  confirmed value.
- Remote updates expose queued, updating, success, error, and uncertain states.
- Authoritative rejection restores the last confirmed value.
- Uncertain outcomes reconcile with the remote system.
- Stale responses must never overwrite newer user intent.

## Theme architecture

### Theme selection

MIB Beacon maintains independent selected themes for light and dark schemes.
Appearance mode is:

- `system` — follow the operating-system color scheme;
- `light` — always use the selected light theme;
- `dark` — always use the selected dark theme.

System mode is the default. Dark Modern and Light Modern from the bundled Code-OSS
theme set are the default scheme themes. The pre-React web shell and native root
fallback use matching Modern surfaces to prevent a legacy-color flash during theme
hydration.

Applying a theme persists it as the selection for its light or dark scheme and
switches appearance mode to that explicit scheme. Previewing temporarily renders
the candidate scheme without persistence; canceling restores the previously
selected mode and theme.

Users may choose density independently:

- `auto` — compact rows in expanded mode and comfortable controls in medium and
  compact modes;
- `compact` — denser engineering controls;
- `comfortable` — larger touch-oriented controls.

Theme, density, import, and catalog behavior must remain configurable in Settings,
even when also exposed through faster global commands.

### Theme sources

The supported theme sources are:

1. **Bundled MIB Beacon fallbacks** for normalization and safe semantic defaults;
   these are not the selectable Code-OSS catalog entries.
2. **Bundled Code-OSS themes** with pinned upstream revision and license metadata.
3. **Imported VS Code JSON/JSONC themes.**
4. **Imported VSIX theme extensions.**
5. **Licensed Open VSX catalog themes**, when the catalog setting is enabled.

Imported themes store provenance such as file name or extension identity, version,
license declaration, and import time. Installed theme storage is validated and
bounded before use.

MIB Beacon maps VS Code workbench color keys into its semantic palette. Syntax
highlighting token rules are not a design requirement because MIB Beacon is not a
source editor. Missing colors fall back to the active MIB Beacon scheme rather than
leaking undefined or platform-default colors into the UI.

An imported scheme is resolved from the theme document's `type` or a VSIX
contribution's `uiTheme`, then from `editor.background` luminance, then from a
light-name match; the final fallback is dark. When several VS Code keys can fill one
semantic role, the ordered key list in `mapVscodeThemeToPalette` is authoritative.
Inherited theme colors are resolved before this mapping.

Theme parsing and import are untrusted-input boundaries:

- enforce file, archive, entry-count, expanded-size, compression-ratio, and include
  depth limits;
- reject unsafe paths, include cycles, encrypted archives, unsupported ZIP64
  archives, and malformed manifests;
- stream and count network downloads where supported;
- require trustworthy upfront size metadata where a platform cannot stream;
- accept catalog download and icon URLs only from the expected Open VSX origin;
- never execute extension code from a VSIX.

The relevant implementation is in
[`packages/ui/src/vscode-theme.ts`](packages/ui/src/vscode-theme.ts),
[`packages/app/src/theme-import.ts`](packages/app/src/theme-import.ts), and
[`packages/app/src/open-vsx-themes.ts`](packages/app/src/open-vsx-themes.ts).

### Semantic tokens

Components consume `useTheme()` and semantic tokens; they do not select arbitrary
colors from an imported theme document.

Core token groups:

- `bg`, `surface`, `surfaceAlt`, and `border` for content hierarchy;
- `text`, `textDim`, `mono`, `accent`, and `focus` for communication and
  interaction;
- `ok`, `warn`, `error`, plus semantic status, diff, and severity tokens;
- MIB object-kind colors for tables, entries, columns, scalars, notifications,
  subtrees, and modules;
- chart series colors;
- `workbench.*` for activity bar, sidebar, panels, title bar, status bar, inputs,
  selection, and hover;
- density, spacing, and type ramps.

Use the narrowest semantic token that matches the role. For example, selection
background is not an enabled-switch track, and a generic accent is not
automatically a warning color.

Hard-coded colors are allowed only for a deliberate, centralized exception with
contrast tests. The packet console is one such exception: it uses the shared fixed
dark `consolePalette` so it continues to read as a hardware terminal in light and
dark application themes.

### Runtime contrast repair

Every bundled, imported, installed, and previewed theme is normalized before
rendering. WCAG 2.2 AA is a runtime invariant, not an import-time suggestion.

- Normal text, including labels, values, placeholders, chips, and button copy:
  at least **4.5:1** against its actual rendered background.
- Large text—at least 24 CSS px/points, or about 18.7 CSS px/points when bold: at
  least **3:1**.
- Focus indicators, control boundaries, meaningful icons, and other required
  non-text UI: at least **3:1**.
- Disabled controls remain readable even when the WCAG exemption for inactive
  controls would permit lower contrast.

Contrast must be measured against the final composited background. Translucent
colors are resolved before comparison. If an imported theme declares backgrounds
that contradict its light/dark scheme, normalize those backgrounds before choosing
shared foregrounds. Do not use reduced opacity when it makes content unreadable.

Repair should preserve theme intent in this order:

1. keep the supplied token when it passes;
2. use the scheme fallback for that semantic role;
3. use a contrast-safe black or white emergency value;
4. for controls with incompatible simultaneous contrast needs, preserve the
   theme-derived fill and add a separately contrast-safe boundary.

The shared normalizer lives in
[`packages/ui/src/theme-values.ts`](packages/ui/src/theme-values.ts). Contrast
utilities live in
[`packages/ui/src/vscode-theme.ts`](packages/ui/src/vscode-theme.ts), with hostile
theme regression coverage in
[`packages/app/src/theme-contrast.test.ts`](packages/app/src/theme-contrast.test.ts).

### Controls and text

Use shared UI primitives from `@mibbeacon/ui` instead of styling raw platform
controls independently.

- Text must declare an intentional semantic tone.
- Fields use the verified workbench input foreground and background as a pair.
- Focus treatment remains visible in light, dark, and high-contrast themes.
- Buttons distinguish default, primary, and destructive intent without relying on
  color alone.
- Switches use `ThemedSwitch`. Web uses the custom accessible switch because
  React Native Web does not reliably honor native switch color props; native uses
  the platform switch with an explicit themed boundary.
- Enabled switches derive from an interactive theme accent, while the thumb and
  boundary independently maintain required contrast.
- Touch controls should provide at least a 44-point target in comfortable density.

## Interaction model

### Command Palette

Any action that can reasonably be performed faster, more precisely, or repeatedly
with a keyboard must be registered as a discoverable global Command Palette
command. Mouse and touch affordances remain available near the relevant content.

The palette supports:

- searchable application commands;
- recent commands;
- `@` OID/object search;
- theme selection;
- licensed theme catalog browsing;
- theme import.

Commands should use stable IDs, plain-language labels, a meaningful group, and
search keywords. A dedicated keyboard shortcut is optional; palette discoverability
is required.

### Preview versus apply

Theme exploration is reversible:

- hover or keyboard focus previews a theme;
- arrow-key movement previews the focused result;
- click or `Enter` applies it;
- on touch or pen input, the first tap previews and arms the same item;
- a second tap on that item applies it;
- closing or backing out clears transient preview state.

Focus events must never accidentally count as the first touch apply intent.
Persistence occurs only after explicit apply. Async catalog previews must be
request-ordered so an older response cannot replace a newer preview.

### Input parity and accessibility

- Every interactive control has an accessible role, name, and state.
- Keyboard focus order follows visual and task order.
- Hover-only information has a focus and touch equivalent.
- Icon-only buttons provide an accessible label.
- Pointer, keyboard, and touch paths produce the same authoritative outcome.
- Motion is brief, purposeful, and not required to understand a state change.
- Avoid layout-shifting confirmation banners for routine actions; use the shared
  toast surface when feedback is still needed.

## Content and visual language

### Typography

- Use the shared type ramp rather than isolated font sizes.
- Use monospace only for values that benefit from fixed-width scanning: OIDs,
  addresses, payloads, commands, and protocol values.
- Keep headings compact and task-oriented.
- Prefer sentence case for labels and commands.
- Do not truncate the only available copy of an operationally important value;
  provide wrapping, a detail view, or a copy action.

### Spacing and density

- Use the shared spacing ramp for new work.
- Favor alignment and grouping over extra decoration.
- Dense tables may use compact rows, but their actions and focus targets must
  remain operable.
- Do not reduce spacing so far that status, selection, or hierarchy becomes
  ambiguous.

### Borders, elevation, and color

- Borders define workbench regions and control boundaries.
- Avoid stacking cards inside cards when pane structure already provides
  hierarchy.
- Use shadows sparingly, primarily for overlays that must separate from the
  workbench.
- Reserve semantic colors for their named meaning.
- Never rely on color as the sole carrier of status, severity, selection, or
  validation.

### Empty, loading, and error states

- Empty states explain what the area is for and identify the next useful action.
- Loading states preserve the expected layout when practical.
- Errors state what failed, retain safe user input, and offer a recovery path.
- A missing platform capability should be explained or replaced with a supported
  alternative; it must not appear as a dead control.

## Settings contract

If users may reasonably want to change a new behavior, expose it in Settings.
Global commands may accelerate configuration but do not replace the durable
Settings surface.

Settings controls must:

- use the same terminology as the feature they govern;
- explain non-obvious defaults and platform differences;
- persist only confirmed choices;
- remain reachable and scrollable at compact widths;
- display installed-item provenance and safe removal actions where applicable;
- restore a safe default if a selected imported item is removed.

## Validation contract

Visual work is incomplete until it is validated in the rendered application.
Source review alone does not prove responsive behavior, accessibility, or
platform parity.

For every new or changed UI:

1. Exercise compact phone, medium tablet, and expanded desktop layouts. The
   canonical theme audit viewports are `390x844`, `820x900`, and `1440x900`.
2. Check light and dark schemes.
3. Check at least one high-contrast or deliberately hostile low-contrast theme
   when tokens or shared controls changed.
4. Verify required content is reachable by deliberate scrolling.
5. Verify keyboard, pointer, and touch paths as applicable.
6. Check focus visibility, accessible names/states, control boundaries, text
   contrast, disabled copy, and large-text behavior.
7. Test loading, empty, success, error, and overflow states that the feature can
   produce.
8. Compare browser and native behavior for shared React Native controls.
9. Make a quick Android emulator pass for native features when an emulator or SDK
   AVD is available.
10. Review screenshots and runtime console/log output, not only test assertions.

Theme work additionally verifies:

- default and imported theme persistence after reload/relaunch;
- transient preview cancellation;
- first-tap preview and second-tap apply on touch;
- safe removal and fallback;
- web boot and native safe-area chrome;
- no raw platform-default control colors;
- no stale async preview winning over a newer selection.

Existing automated coverage includes theme parsing, mapping, storage, contrast,
quick-pick intent, switch colors, source guards, and desktop release checks.
Rendered theme audit artifacts belong under
[`docs/audits/`](docs/audits/).

Use focused Vitest files for the changed contract, run the applicable package
typecheck, and use
[`dev/audit/vscode-theme-workbench-smoke.py`](dev/audit/vscode-theme-workbench-smoke.py)
for the canonical browser theme matrix. Theme or layout changes are material when
they alter tokens, shared primitives, workbench chrome, breakpoints, pane behavior,
or the rendered appearance of a supported mode; record their screenshots and
machine-readable audit report under a named `docs/audits/` directory.

Follow the review gate in `AGENTS.md`: use the required responsive-validation
subagent path where applicable, then have the parent independently inspect both the
rendered evidence and the findings before completion or commit.

## Implementation checklist

Before submitting a UI change, confirm:

- [ ] It follows the workbench information hierarchy rather than adding a
      one-off shell.
- [ ] It uses shared responsive modes and remains reachable in compact, medium,
      and expanded layouts.
- [ ] User-configurable behavior is represented in Settings.
- [ ] Keyboard-suitable actions are registered in the Command Palette.
- [ ] It uses semantic theme tokens and shared primitives.
- [ ] Text and non-text contrast meet the runtime criteria on actual backgrounds.
- [ ] Loading, empty, error, success, and uncertain states are intentional.
- [ ] Remote edits preserve draft/confirmed separation and reject stale results.
- [ ] Pointer, keyboard, touch, and accessibility behavior agree.
- [ ] Rendered browser/native validation and relevant automated checks were run.
- [ ] Evidence is recorded when the change materially affects layout or themes.

When a new design decision changes these criteria, update this file in the same
change so the implementation and its design contract do not drift.
