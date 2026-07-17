# Scroll-reduction layout refactor — overlay dialogs instead of long scrollable flows

Date: 2026-07-16

## Motivation

Several MIB Beacon flows stacked multi-step forms vertically inside a single scroll container, forcing the user to scroll back and forth between an action and its feedback. A baseline browser scan (three parallel agents, headless Chromium at 390×844 / 768×1024 / 1440×900 against the LAN web target) quantified the worst cases on mobile:

- **Tools → inline SNMP target onboarding**: opening the inline v3 form pushed the page to **1.95–2.62 viewports**. The submit button sat ~860 px below the form header, and the "2. Configure the series" step — the reason the user opened the form — moved ~830 px down, entirely off-screen.
- **Traps → Send**: a **2.10-viewport** form where the Send button and validation errors were ~865 px below the destination fields.
- **Agents**: **1.89 viewports**; the create/edit form sat below the profile list and test results rendered at the bottom of the list card, far from the tested row.
- **Mibs (mobile)**: the import card consumed ~510 px (a full first screen) before the module list started (**1.67 viewports**).
- **Query → Set**: the inline "Review Set request" confirmation rendered ~650 px below the operation chips, above a results area that starts at ~1543 px.

This refactor moves those steps into overlay dialogs that float over the active view, so users manage changes in place: **bottom sheets on compact widths (≤639 px), centered cards on medium/expanded**, with a sticky footer that keeps the primary action and errors visible while the form body scrolls.

## The `Dialog` primitive (`packages/ui/src/dialog.tsx`)

A reusable primitive consolidating the patterns of the previous bespoke modals (FileImportReviewModal structure + CommandPalette keyboard/focus handling). Works across web (react-native-web), Electron, and native (Expo) because it is built on RN `<Modal>`.

```ts
interface DialogProps {
  visible: boolean;
  onRequestClose: () => void;      // hardware back, Escape (web), backdrop tap, Close button
  title: string;
  subtitle?: string;
  headerAccessory?: ReactNode;     // e.g. a Pill
  children: ReactNode;             // scrollable body
  footer?: ReactNode;              // sticky action row below the body
  presentation?: 'auto' | 'sheet' | 'center'; // auto: sheet ≤ COMPACT_MAX_WIDTH
  scrollable?: boolean;            // default true
  maxWidth?: number;               // default 720 (center mode)
  fillHeight?: boolean;            // take full 92% height
  dismissable?: boolean;           // false blocks backdrop/Esc during busy states
}
```

Behavior details:

- Presentation resolves from `useWindowDimensions()` + `getResponsiveMode` (moved to `packages/ui/src/breakpoints.ts`, re-exported by `packages/app/src/responsive-layout.ts` and available as the RN-free subpath `@mibbeacon/ui/breakpoints` so node-environment tests don't pull in react-native).
- Web: Escape-to-close (capturing listener), focus save/restore to the previously focused element, heading focus on open via `AccessibilityInfo.setAccessibilityFocus`.
- Native: wrapped in `KeyboardAvoidingView` with `behavior="padding"` on iOS **and Android** — Android 15 edge-to-edge (Expo SDK 54) ignores `windowSoftInputMode="adjustResize"` for RN Modal windows, so padding-based avoidance is required (verified on the emulator, see below).
- Body is a `ScrollView` with `keyboardShouldPersistTaps="handled"`; the footer renders outside it, so submit buttons and error labels never scroll away.

## Per-flow changes

| Flow | Before | After |
|---|---|---|
| Tools target onboarding | `InlineAgentProfileSetup` card inline in Graphs/Compare/Ports | One `AgentProfileDialog` per screen (`ToolsScreen.tsx`), opened by the existing CTAs; auto-select on save unchanged |
| Agents create/edit | Inline form card below the list; test results at card bottom | `AgentProfileDialog` (New profile / row Edit / empty-state CTA); test results render inside the tested row (`testState` keyed by `profileId`) |
| Traps send | Whole compose form as list header | Summary card + **Compose trap** button → `TrapComposerDialog` (store-driven `trapComposerOpen`); presets load and Browse "Send this trap" / trap Replay prefills open it automatically; sends close it on success |
| Mibs import (compact) | ~510 px import card above the module list | Small summary card + **Import MIBs** button → shared `MibImportModal`, rebuilt on `Dialog` with the full `ImportProgressPanel` (extracted, also reused by the split-view inline pane) |
| Query Set review | Inline confirmation block in the operation card | **Confirm Set request** `Dialog` with WRITE pill, staged old→new list, sticky Cancel/Send Set footer |

New/renamed files: `packages/ui/src/{dialog.tsx,breakpoints.ts}`, `packages/app/src/components/{AgentProfileDialog.tsx,TrapComposerDialog.tsx,ImportProgressPanel.tsx}`, `InlineAgentProfileSetup.tsx` → `AgentProfileFormFields.tsx` (Card wrapper deleted; fields shared by the dialog). Net diff in modified files: **+272 / −623 lines**.

## Results — before/after metrics

Main scroll container `scrollHeight / clientHeight` (browser, dialog open for "form" states):

| State | Mobile 390 before → after | Tablet 768 | Desktop 1440 |
|---|---|---|---|
| Tools graphs + form (v3) | 1.95 → **1.00** | 1.38 → 1.00 | 1.45 → 1.00 |
| Tools compare + form (v3) | 2.62 → **1.35**¹ | 1.85 → 1.00 | 1.98 → 1.00 |
| Tools ports + form (v3) | 1.78 → **1.00** | 1.26 → 1.00 | 1.32 → 1.00 |
| Traps send | 2.10 → **1.00** | 1.16 → 1.00 | 1.21 → 1.00 |
| Agents | 1.89 → **1.00** | 1.26 → 1.00 | 1.30 → 1.00 |
| Mibs | 1.67 → **1.09** | 1.00 (unchanged) | 1.00 (unchanged) |

¹ Compare's remaining 1.35 is its base empty-state page height; the dialog no longer adds anything to the page.

Other wins: mobile Mibs "Loaded modules" header moved from y≈639 to **y≈238**; the Tools submit button went from ~860 px below the form header (off-screen) to always visible in the sticky footer (18/18 state×viewport combinations); Agents test results render inside the tested row at all widths.

The form content now scrolls inside the dialog body where needed (e.g. mobile v3 target form body 804/647 ≈ 1.24; Traps compose 903/647 ≈ 1.40) with the footer pinned — that is the intended trade: the *page* no longer scrolls, and action + errors stay on screen.

### Interaction verification (headless Chromium, 390 and 1440)

All passed: Escape closes (web) · backdrop tap closes · focus returns to the trigger · busy states block dismissal · Tools target save auto-selects the new target and reveals "2. Configure the series" · Traps send closes the dialog and appends to Send history · Agents create/edit/test flows · Mibs paste-import shows progress inside the dialog and the imported module appears in the list · Query "Review Set request" opens the confirm dialog.

### Screenshots

- Browser before: [`baseline/`](scroll-reduction-layout-refactor/baseline/) — e.g. `tools-compare-form-390.png` (+ `-bottom.png`), `traps-send-390.png`, `agents-390.png`, `mibs-390.png`, `query-390.png`, each also at 768/1440 with metrics JSON.
- Browser after: [`after/`](scroll-reduction-layout-refactor/after/) — same names; `-form` states show the dialogs (bottom sheet at 390, centered card at 768/1440).
- Android (Pixel 9 Pro emulator, Expo dev client):
  - [`android-smoke/tools-graphs-page.png`](scroll-reduction-layout-refactor/android-smoke/tools-graphs-page.png) — Tools fits one screen
  - [`android-smoke/tools-target-sheet.png`](scroll-reduction-layout-refactor/android-smoke/tools-target-sheet.png) / [`tools-target-sheet-v3.png`](scroll-reduction-layout-refactor/android-smoke/tools-target-sheet-v3.png) — native bottom sheet, sticky footer
  - [`android-smoke/keyboard-before-fix.png`](scroll-reduction-layout-refactor/android-smoke/keyboard-before-fix.png) vs [`keyboard-after-fix.png`](scroll-reduction-layout-refactor/android-smoke/keyboard-after-fix.png) — the keyboard fix (below)
  - [`android-smoke/traps-send-page.png`](scroll-reduction-layout-refactor/android-smoke/traps-send-page.png) / [`traps-compose-sheet.png`](scroll-reduction-layout-refactor/android-smoke/traps-compose-sheet.png) / [`traps-compose-keyboard.png`](scroll-reduction-layout-refactor/android-smoke/traps-compose-keyboard.png)

## Android keyboard smoke (emulator)

Run on the host `Pixel_9_Pro` AVD with the Expo dev client (JDK 17, Metro on port 8082 — 8081 was held by another project's container). Findings:

1. **Bug found and fixed:** with the original `behavior={ios ? 'padding' : undefined}`, the soft keyboard overlaid the bottom half of the sheet, hiding the focused field and the footer (`keyboard-before-fix.png`). Android 15 edge-to-edge ignores `adjustResize` for RN Modal windows. Fix: `behavior="padding"` on all native platforms (`keyboard-after-fix.png` — focused Community field and Save/Cancel footer fully visible above the keyboard).
2. Taps register while the keyboard is up (`keyboardShouldPersistTaps="handled"`): tapping the v3 chip expanded the full authPriv form correctly.
3. The dialog body auto-scrolls the focused field into view above the sticky footer (Traps compose, sysUpTime field).
4. Hardware back closes the dialog. Note: when the keyboard is open inside the compose sheet, back closes the dialog rather than only the keyboard — a known RN `Modal` nuance on Android, acceptable since drafts persist in the store and reopen intact.

## Automated checks

- `pnpm typecheck` — clean (all workspaces, including the new `packages/ui` files).
- `pnpm lint` — clean (scan scripts under `docs/**/scripts/` are ESLint-ignored).
- `pnpm test` — 590 passed / 4 skipped. `tools-target-onboarding.test.ts` was rewritten for the dialog architecture (asserts a single `AgentProfileDialog`, section CTAs, and the draft-reset behavior). One unrelated flaky timeout (`file-import-quality.test.ts` large-ZIP decode) appeared once while the machine was under emulator + scan load and passes consistently otherwise.

## Known limitations / follow-ups

- **Traps receive workspace** still stacks receiver/filters/v3-users/rules cards (baseline ratio 2.5–3.4 with a nested capped scroller on wide viewports). It was outside the confirmed scope; same dialog treatment would apply well.
- **Query compact** page (agent + operation + results in one list) still scrolls ~1.6–2.3 viewports; only the Set confirmation moved into a dialog in this pass.
- Nested-modal path (Query embedded in Browse's phone sheet → Set confirm dialog) renders fine on react-native-web; native iOS historically mis-stacks nested modals — if that surfaces, keep the inline confirm when `embedded`.
- Android back-press closes the dialog instead of dismissing the keyboard first (see smoke findings).
- The eight pre-existing bespoke modals (CommandPalette, FileImportReviewModal, Browse sheets, Settings SourceEditor, …) were intentionally not migrated to `Dialog`; only `MibImportModal` was rebuilt because the Mibs flow required it.

## Reproduction

```bash
# web target
MIB_BEACON_SERVER_GENERATE_SECRET_KEY=true MIB_BEACON_SERVER_DATA=$(mktemp -d) pnpm dev:server
# scans (need playwright-core staged; see scripts)
node docs/scroll-reduction-layout-refactor/scripts/scan-tools.mjs        # baseline capture
node docs/scroll-reduction-layout-refactor/scripts/after-tools.mjs      # after capture
# android smoke
JAVA_HOME=/usr/lib/jvm/java-17-openjdk ANDROID_HOME=$HOME/Android/Sdk pnpm dev:mobile
```
