# AGENTS.md Compliance Failures

**Original audit date:** 2026-07-20
**Latest revalidation:** 2026-08-13
**Scope:** Repository-wide validation against the root `AGENTS.md` rules  
**Status:** Remediation and dirty-worktree revalidation are complete, and the historical v0.6.0 release remains successfully published. All 58 browser scenarios, all 58 versioned matrix checks, the full 1,292-test inventory (1,288 passed, 4 skipped), and the rebuilt Android notification/share harness pass. Goal completion is still **not yet proven** only because AF-003/AF-009 require the same browser/native evidence tied to the committed code candidate.

## Launch goal

Paste this into Codex from the repository root:

```text
/goal Read docs/audit-failures.md and continue the AGENTS.md compliance audit from the 2026-08-13 revalidation. Preserve every unrelated dirty-worktree change, especially docs/plans/post-v1/. Preserve the implemented 84-action persistent Command Palette catalog and the Android notification/PNG-sharing harness. Finish AF-003 by running the focused and repository-wide gates and validating catalog availability and priority-safe navigation fallbacks across routes. Commit only the intended audit/remediation scope, then close AF-009 by rebuilding and rerunning all 58 browser scenarios, the 58-check versioned validation matrix, and Android native effects against that exact post-commit candidate. Replace provisional dirty-worktree evidence with exact-commit evidence, update this document with the final commit, commands, report hashes, and results, and push only the verified post-release remediation commits to origin/master without force. Treat the already-published v0.6.0 release as historical completed work: do not bump, republish, move or recreate the tag, or trigger another Release workflow.
```

## Current-state revalidation — 2026-08-13

This pass treats the repository, GitHub remote, tag, and published release as authoritative instead of relying on the July completion narrative.

- Local `master` is `be5fe80` and is **three commits ahead** of `origin/master`: `fa04996`, `875140d`, and `be5fe80`.
- `origin/master` and the dereferenced annotated `v0.6.0` tag both point to `7eb855a4bc037677955b9d113030d9f44cede52f`. The annotated tag object is `1a238c16184540a07375f8ab65bab7218b3894e5`.
- The current worktree contains the intended Command Palette integration, Android native-effects harness, browser-audit work, and unrelated `docs/plans/post-v1/` files. The unrelated plans remain outside the audit scope and must be preserved.
- A fresh production web bundle from the settled dirty worktree passed all **58/58** browser scenarios in `docs/audits/ui-browser/coverage.json` and all **58/58** versioned checks in `docs/audits/validation-matrix-v1.json`, with zero failures. Both reports name `be5fe80`, but because tracked/untracked implementation changes were present, this is provisional behavioral evidence rather than exact-commit proof.
- A clean Expo prebuild plus signed x86_64 release/receiver rebuild was followed by a self-contained run of `dev/audit/android-native-effects/run.sh`. It proved a delivered notification with `mHidden==false` and `mIntercept=false`, then proved that an audit receiver could read and decode the exact `image/png` attachment. `docs/audits/android-native-effects/SHA256SUMS` validates the retained evidence bundle. This resolves the AF-006 and AF-007 behavior gaps provisionally; AF-009 still requires a rerun against the committed code candidate.
- The published v0.6.0 emulator run remains historical launch-only evidence. The newer native-effects bundle supersedes that limitation for current behavior, but its `testedCommit` field also names `be5fe80` while the worktree was dirty. Browser and native evidence must therefore be regenerated after the intended changes are committed.
- AF-009 now remains open only for the exact post-commit freshness rerun after AF-003's implemented persistent global Command Palette catalog passes its full and exact-route gates; there is no remaining locally reproducible browser-layout or Android-effects blocker.

## Executive summary

The audit originally found the following systemic deviations. Shared infrastructure and most migrations are present, but “implemented” is not treated as synonymous with “currently proven”:

1. Remote-backed editable controls did not consistently separate draft and confirmed values or protect against stale responses.
2. Runtime theme repair did not guarantee WCAG 2.2 AA contrast in actual rendered component states.
3. The Command Palette exposed only a small subset of keyboard-suitable actions.
4. Width-only responsive breakpoints enabled split layouts before their declared pane minimums fit.
5. Several prerequisites could not be satisfied without leaving the dependent workflow.
6. Browser and Android validation was not enforced with sufficient route, viewport, reachability, and platform coverage.

Open completion gates as of 2026-08-13:

1. **AF-003 / AF-009:** commit the intended code candidate, rerun the already-passing browser and Android native-effects matrices against that code commit, retain SHA-keyed evidence, and push the verified remediation commits to `origin/master` without changing the historical release.

AF-006 and AF-007 behavior is provisionally resolved: the current Android harness observed a visible, non-intercepted product notification and a receiver read the exact PNG attachment. AF-009 owns their exact-candidate freshness rerun.

## Rule status

| AGENTS.md rule                               | Status                            | Main evidence                                                                                   |
| -------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------- |
| User-changeable behavior exposed in Settings | Resolved                          | Notification and layout controls are exposed in Settings                                        |
| Mobile, tablet, and desktop validation       | Provisional pass; **AF-009 open** | Fresh dirty-tree browser audit and matrix v1 each passed 58/58; exact post-commit rerun remains |
| Required content remains reachable           | Provisional rendered pass         | Current phone/tablet/desktop light/dark audit completed with zero failures                      |
| Safe remote-backed editing                   | Resolved                          | Shared transactions enforce phases, rollback, reconciliation, and stale guards                  |
| Keyboard-suitable actions in Command Palette | Provisional pass; **AF-009 open** | 84 catalog actions and the rendered off-route handoff pass; exact-code-commit rerun remains     |
| Runtime WCAG 2.2 AA contrast                 | Resolved                          | Runtime repair/state matrices pass and current rendered coverage completed provisionally        |
| In-context prerequisite completion           | Resolved                          | Dependent pages create/select prerequisites and resume actions                                  |

---

## P0 — Critical and systemic

### AF-001 — Remote-backed controls are not transaction-safe

**Remediation status (2026-07-21): Implementation resolved; current rendered revalidation belongs to AF-009.** Live MIB settings, resolver settings/sources/cache clear, update preferences, packet retention, Tools poll/watch/chart/pattern collections, trap persistence, agents/groups, Query bookmarks/walk snapshots, and direct MIB catalog mutations completed the shared transaction migration. The older rendered result remains historical evidence; current exact-candidate phase/recovery evidence is tracked under AF-009.

**Implementation progress:** Shared infrastructure now exists in `packages/app/src/remote-edit-transaction.ts` with focused tests for confirmed/draft separation, overlapping active and queued writes, stale/scope guards, authoritative rollback, explicit error acknowledgement, uncertain reconciliation, conflict retention, semantic record equality, and illegal transitions. Live MIB global defaults/per-agent overrides, resolver enable/auto-resolve/consent settings, resolver sources, Tools polls/watches/saved charts, persistent trap configuration, agents/groups, the automatic desktop update preference, and packet retention now use that contract: authoritative load gates, staged drafts, explicit Save/Cancel, queued writes, rollback, latest-attempt reconciliation, safe retry/reset, visible phases, per-engine or per-adapter invalidation, and runner-generation handoff are covered by focused tests and independent specification/quality review. The updater status stream also has adapter-lifetime, event-revision, and request-order arbitration. Packet retention additionally uses current-engine event authority, causal field synchronization, truthful/deduplicated disk-write recovery, and packet bootstrap lifecycle/event revisions; its final focused gate covers 47 transaction/bootstrap/shared cases. The later subsections record completion of the pattern-session, Query artifact, MIB catalog, and resolver-cache follow-ons that were still open at this intermediate checkpoint. No production Query-preset persistence API exists; earlier “query preset” wording was audit drift.

**Engine-lifetime foundation (2026-07-21):** The shared renderer store and mounted async consumers now reject stale EngineAPI completions at helper entry and after every await. Engine identity changes synchronously invalidate provider ownership and remount the child subtree with a stable per-engine epoch; AppRoot bootstraps and events use resource revisions; resolver snapshots use immutable per-engine generations; transient engine authority is reset; and accepted Query, import, Live MIB, and Tools handles are cancelled on their originating engine during replacement or when a newer same-engine start wins. Fire-and-forget engine calls in the reviewed paths now close their rejection chains. Independent specification review passed and independent quality review approved this bounded foundation. The final parent gate passed 123 tests across 27 focused files, app typecheck, targeted Prettier, and `git diff --check`. This prevents later AF-001 controllers from inheriting cross-engine or orphan-handle races, but does not close the remaining persistent mutation migrations listed above.

**Resolver-source transaction migration (2026-07-21):** One retained, replay-safe controller per `EngineAPI` now owns the complete source collection. It gates mutations on an authoritative load, serializes create/update/remove/toggle/reorder/drag/import intents, captures ownership per queued command, reconciles every successful write through a raw list, distinguishes a successful write from a failed authority read, preserves newer refresh/event authority with read-start tokens, and exposes queued/updating/success/error-reverted/uncertain/conflict recovery. Strict Mode replay, actual engine disposal, retry correlation, partial imports, cache-first contiguous ordering, same-engine test/preview arbitration, accepted-handle cleanup, preview invalidation, and valid/malformed secret redaction have focused regressions. Independent specification review passed and independent quality review approved the final result. The fresh parent gate passed 84 tests across six focused files, app typecheck, targeted Prettier, and `git diff --check`.

**Tools poll/watch/chart transaction migration (2026-07-21):** One retained per-engine authority now owns poll series, watches, and saved charts across Tools and Query Graph. It load-gates and serializes mixed mutations, captures ownership per intent, preserves last-confirmed lists on uncertain writes, uses read-start tokens and a latest-run coordinator across collections/snapshots/patterns/samples, and exposes active plus queued work with retry/acknowledge/reconcile recovery. Ambiguous ID-less creates use service-normalized before/after multiplicity, while exact-ID updates honor backend normalization and clear/default semantics. Query Graph uses atomic idle-controller admission and routes blocked recovery to Tools; direct pattern events invalidate older refresh pipelines. Independent specification review passed and independent quality review approved the result. The fresh parent gate passed 88 tests across eight focused files, app/UI typechecks, targeted Prettier, and `git diff --check`. Pattern trace-session mutations and Query snapshot/bookmark persistence remain separate AF-001 follow-ons.

**Trap persistence transaction migration (2026-07-21):** One retained per-engine authority now owns saved filters, SNMPv3 receiver users, rules, and send presets. It load-gates and serializes mixed mutations, captures command ownership, rejects stale reads/events, reconciles ambiguous writes against raw authority, preserves JSON persistence semantics, and exposes queued/updating/success/reverted/uncertain/conflict recovery. Record mark/delete/clear actions now use exact-intent coalescing plus FIFO admission and shared split/compact pending state; receiver and send transitions have explicit arbitration. SNMPv3 key edits use explicit retain/replace/clear intent, preserve exact credential bytes, never retain sensitive retry closures, and the core store compensates partial secret or database failures while escalating rollback-unknown outcomes. Independent specification review passed and independent quality review approved the result. The fresh parent gate passed 97 app tests across eight focused files plus 11 core store tests, targeted ESLint, app/core/UI typechecks, targeted Prettier, and `git diff --check`. Trap persistent mutations are therefore removed from the AF-001 follow-on list; rendered browser/native validation remains part of the final matrix.

**Agent/group transaction migration (2026-07-21):** One retained per-engine controller now owns profile and group authority across Agents, Tools discovery/target creation, and Live MIB onboarding. It load-gates and serializes mixed writes, rejects stale read starts and old-engine continuations, publishes through one ownership-gated store sink, discards queued work on blocking failures, and sanitizes credential-bearing closures before any retry state can retain them. Sensitive failures clear credential drafts and require actual re-entry; all dependent screens expose shared, live-region recovery and block further writes until reconciliation or acknowledgement. Create/update matching mirrors core trimming, defaults, active-secret rules, returned-ID confirmation, and ambiguity constraints. Core profile writes compensate secret failures and escalate rollback-unknown outcomes; deletion rechecks saved-artifact dependencies inside the final database transaction before cleaning group membership and per-agent Live MIB settings. Profile/group create and update responses are built directly from the committed normalized values so a fallible post-commit read cannot falsely report rejection. Independent specification review passed and independent quality review approved the final result. The fresh parent gate passed 68 focused app/core tests, app/core/UI typechecks, targeted ESLint and Prettier, and `git diff --check`. Agents/groups are removed from the AF-001 follow-on list; rendered browser/native validation remains part of the final matrix.

**Query artifact transaction migration (2026-07-21):** One retained per-engine controller now owns bookmark and walk-snapshot authority. It gates a FIFO on the newest authoritative load, coalesces exact creates/deletes, rejects stale reads and lifecycle continuations, preserves committed authority through ambiguous outcomes, discards blocked queues, and exposes queued/updating/success/reverted/uncertain/conflict recovery through a polite live region. Snapshot intent identity uses bounded scalar metadata plus results-array identity rather than traversing up to 100,000 varbinds. Core snapshot creation/deletion compensates database and file failures, including effect-then-throw ambiguity and rollback-unknown outcomes. Independent final specification and quality review passed 54 focused tests plus app/core typechecks and targeted lint/format gates. Query artifacts are removed from the AF-001 follow-on list; rendered browser/native validation remains part of the final matrix.

**Resolver cache-clear transaction migration (2026-07-21):** Cache clearing now snapshots and verifies database/file compensation for fail-before and effect-then-throw outcomes, escalates rollback-unknown failures, and runs through the same resolver mutation queue as cache writers. A retained per-engine controller fences every load, aggregate refresh, reconcile, clear, ownership, and disposal continuation by newest read start and exposes confirmed, queued, updating, success, reverted, uncertain, and conflict recovery in Settings. Both the pointer control and the persistent Command Palette action dispatch the same centrally confirmed destructive action. Final independent verification passed 46 focused app/core tests plus app typecheck and diff checks. Resolver cache clear is removed from the AF-001 follow-on list; rendered browser/native validation remains part of the final matrix.

**Pattern-session transaction migration (2026-07-21):** Active and passive trace sessions now use stable request/intent identities, running-only persisted operation handles, terminal/restart handle clearing, and one database transaction for passive session plus event insertion. A retained per-engine controller load-gates and serializes start/annotate/cancel/remove, requires authoritative postconditions, fences newest read starts and every post-await lifecycle continuation, scopes queued cleanup to its lifecycle, and exposes visible retry/acknowledge/reconcile recovery. Final independent specification and quality review passed 33 focused app/core tests plus app/core typechecks and targeted lint/format/diff gates. Pattern sessions are removed from the AF-001 follow-on list; rendered browser/native validation remains part of the final matrix.

**MIB catalog transaction migration (2026-07-21):** Direct text import, URL import, and unload now fork the current `MibStore`, mutate and persist the exact isolated candidate, and adopt parser/source/index authority only after durability succeeds. Persistence rejection leaves visible catalog authority unchanged and emits no success event; URL, text, unload, restart, multi-module replacement, and source-ownership regressions are covered. Final independent specification and quality review passed 10 focused tests, the complete 1,233-test suite (4 skipped), core typecheck, targeted lint/format, and diff-check. Direct MIB catalog mutations are removed from the AF-001 follow-on list.

**Rule:** Remote-backed editable controls must keep draft and confirmed values separate, expose all transaction phases, roll back authoritative rejection, reconcile uncertain outcomes, and prevent stale responses from overwriting newer state.

**Evidence:**

- Resolved in the current worktree: Live MIB global and per-agent settings keep independent raw drafts and confirmed authority, serialize writes, and reconcile uncertain outcomes through the shared transaction model.
- Resolved in the current worktree: resolver enable/auto-resolve/consent controls and resolver sources use retained ownership-aware controllers rather than shared busy flags or response-driven full-object replacement.
- Resolved in the current worktree: automatic-update preferences now stage edits and reconcile authoritative failures through `AutomaticUpdatePreferenceController`; all update-status producers route through `UpdateStatusCoordinator`.
- Resolved in the current worktree: packet retention now preserves raw drafts, serializes writes, reconciles uncertainty, and prevents stale engine/event/bootstrap responses.
- Resolved in the current worktree: all resolver-source CRUD, toggle, ordering, drag, and import writes now pass through `ResolverSourceCollectionController`; source-list store writes are limited to its ownership-aware sink and AppRoot's engine-session reset.
- Resolved in the current worktree: mounted poll/watch/saved-chart writes now pass through `ToolsPersistentCollectionsController`, including Query Graph creation; same-engine refresh and pattern-event ordering is generation guarded.
- Resolved in the current worktree: saved trap filters, SNMPv3 users, rules, and send presets now pass through `TrapPersistentCollectionsController`; record, receiver, and send operations use shared ownership-aware arbitration, and V3 secret writes use compensating rollback.
- Resolved in the current worktree: agent profiles and groups now pass through `AgentPersistentCollectionsController` from Agents, Tools, and Live MIBs; sensitive failures discard queued credentials and require re-entry, while core persistence compensates secret failures and fails closed on saved-artifact dependencies.
- Resolved in the current worktree: Query bookmarks and walk snapshots use retained authoritative transactions, and snapshot file/DB creation and deletion use compensating atomicity.
- Resolved in the current worktree: Tools pattern start/annotate/cancel/remove use retained authoritative transactions, stable request identities, running-only cancellation handles, and atomic passive annotations.
- Resolved in the current worktree: resolver cache clear uses compensating DB/file atomicity, serialization, retained UI authority, and a confirmed registered action.
- Resolved in the current worktree: direct MIB catalog mutations persist an isolated candidate before adopting visible parser/index authority.

**Failure modes:**

- Multi-digit inputs can snap back to the prior confirmed value.
- Older full-object responses can overwrite newer changes.
- One request can clear a shared busy flag while another request remains pending.
- A rejected write can remain displayed as saved.
- Timeouts and ambiguous failures are never reconciled with the remote authority.

**Required remediation:**

- Generalize `packages/app/src/live-mibs-model.ts:120-207` into a reusable `RemoteEditable<T>` reducer/hook.
- Preserve `confirmed`, `draft`, `phase`, `requestId`, `error`, and optional remote/conflict value per independently editable field and resource scope.
- Use request generations to reject stale responses.
- Submit staged numeric drafts on an explicit save, blur, or well-defined debounce rather than every keystroke.
- Continue with Query bookmarks/walk snapshots, Tools pattern sessions, MIB catalog mutations, resolver cache clear, and other persistent remote mutations.

**Reference implementation:**

- State phases and separate values: `packages/app/src/live-mibs-model.ts:120-141`
- Request-ID protection and rollback: `packages/app/src/live-mibs-model.ts:159-207`
- Uncertain-outcome reconciliation: `packages/app/src/screens/LiveMibsScreen.tsx:904-969`
- Regression tests: `packages/app/src/live-mibs-model.test.ts:83-143`

**Acceptance criteria:**

- [x] Every remote-backed editable control has distinct draft and last-confirmed state.
- [x] Queued, updating, success, error, reverted, and uncertain phases are visible where applicable.
- [x] Authoritative rejection restores the confirmed value.
- [x] Ambiguous failure triggers reconciliation.
- [x] Out-of-order responses cannot overwrite newer state.
- [x] Tests cover rapid edits, double-submit, rejection, timeout, stale response, and resource-scope switching.

### AF-002 — Runtime theme repair did not guarantee WCAG postconditions

**Revalidation status (2026-07-20, `7074513`): Reproducible.** Fresh calculations reconfirmed the hostile-theme, Default High Contrast active-state, primary focus-ring, selected metadata, badge, and opacity-composition failures. The concurrent native-backed Switch change does not address them.

**Implementation progress:** Runtime normalization now fails closed, derives opaque semantic component-state pairs for selected, hover, primary, danger, badge, and disabled controls, and supplies independent inner/outer focus tokens. Navigation, shared Button/Chip primitives, Command Palette rows, disabled Query controls, and hidden chart legends consume those pairs without reduced-opacity styling. Pure interaction resolvers and matrices cover all ten bundled themes plus hostile light/dark imported and preview descriptors, including alpha composition across actual workbench exteriors. Focused tests and UI/app typechecks pass after independent specification and quality review. The versioned browser matrix now supplies the final rendered reachability/interaction gate.

**Rule:** Every bundled, imported, previewed, and installed theme must satisfy WCAG 2.2 AA at runtime in the actual rendered context.

**Original evidence (2026-07-20):**

- `readableOn()` returns the best candidate even when every candidate is below threshold: `packages/ui/src/theme-values.ts:161-179`.
- Normalization checks generic content backgrounds rather than all actual workbench/component backgrounds: `theme-values.ts:245-289`.
- The bundled Default High Contrast theme maps an opaque white selection into active navigation and Chip states: `packages/ui/src/vscode-theme.ts:356-362`, `packages/app/src/AppRoot.tsx:757-773`, and `packages/ui/src/primitives.tsx:217-228`.
- Primary-button focus borders are checked against generic surfaces, not the primary fill: `packages/ui/src/primitives.tsx:154-175` and `theme-values.ts:284-289`.
- Disabled Command Palette and Query controls use reduced opacity: `packages/app/src/components/CommandPalette.tsx:773-779` and `packages/app/src/screens/QueryScreen.tsx:1452-1462`.

**Measured failures:**

- Default High Contrast active navigation label: **1.00:1**.
- Active navigation glyph/Chip foreground: **2.42:1**.
- Primary-button focus ring across all ten bundled themes: **1.00–1.66:1**.
- Selected theme-picker metadata: as low as **3.56:1**.
- Disabled Query close glyph: approximately **1.98–2.27:1**.
- Hostile imported mixed-midpoint palette: text **2.32:1**, boundary **2.73:1**.

**Required remediation:**

- Introduce semantic selected-control, navigation, disabled-control, button, and focus-ring foreground/background pairs.
- Normalize against actual component compositions, including alpha-composited backgrounds.
- Repair both sides of a color pair when necessary; never return a failed postcondition.
- Replace opacity-based disabled styling with normalized disabled tokens at full opacity.
- Use a two-color focus outline where one ring color cannot contrast with both the control fill and exterior background.

**Acceptance criteria:**

- [x] Every bundled theme passes an actual-component state matrix.
- [x] Hostile imported light and dark themes pass or are deterministically repaired before preview/render/install.
- [x] Normal text is at least 4.5:1, large text at least 3:1, and required non-text UI at least 3:1.
- [x] Selected, hover, pressed, disabled, focus, placeholder, icon, boundary, and alpha-composited states are covered.
- [x] No runtime repair function can return a knowingly failing pair.

### AF-003 — Command Palette coverage is systemically incomplete

**Revalidation status (2026-07-20, `7074513`): Reproducible.** The palette still exposes only 15 static non-navigation commands, Query shortcuts still execute actions unavailable from the palette, and no shared action registry or suitability classification exists.

**Current revalidation status (2026-08-13): Behavior and full dirty-tree gate pass; exact-code-commit rerun pending under AF-009.** The current worktree defines 84 unique palette-required actions across Browse (5), Tools (18), Traps (8), Packet Console (4), Agents (7), Live MIBs (5), and Settings (37), plus 26 explicitly justified contextual-only interaction classifications. Owner-exact registration rejects missing or unexpected IDs, catalog actions require keyboard-suitable and palette-exposed metadata, and migrated pointer controls dispatch through the registry confirmation gateway. Persistent navigation fallbacks keep all catalog IDs discoverable while their owning route is unmounted. The complete workspace typecheck, ESLint, 1,287 runnable tests, focused action tests, production build, and rendered browser matrices pass. The browser scenario now selects `tools:start-ports` from Browse, confirms safe navigation while the palette remains open, and observes the mounted Tools action taking ownership. Only AF-009's exact-code-commit evidence rerun remains.

**Implementation progress:** A central owner-scoped action registry now defines palette exposure, keyboard suitability, shortcut bindings, platforms, enabled/disabled reasons, confirmation metadata, and execution handlers. Owner batches replace atomically; confirmation is enforced at the execution gateway and revalidated after asynchronous authorization; safe future action IDs survive palette-history persistence. Query prepare, direct Get/Get Next/Get Bulk/Walk/Set staging, Run, Repeat, and Stop actions register persistently above conditional screens, and the palette, operation Chips, Run/Stop buttons, and browser shortcuts dispatch those same definitions with visible failure reasons. Four Settings transaction acknowledge controls now also share registry dispatch, and dependency-correct registrations prevent them from retaining stale remote drafts or recovery state. AppRoot registers one non-executing navigation fallback for every catalog action at priority `-100`; a mounted route registers the authoritative state/confirmation/handler at higher priority. Selecting a fallback navigates without executing the underlying action and keeps the palette open so the user can invoke the newly authoritative definition. Registry tests cover same-priority duplicate rejection, finite-priority validation, fallback restoration, and invalidation of a confirmation whose higher-priority owner unmounts. The inventory and suitability tests lock the 84 catalog IDs and 26 contextual exclusions.

**Rule:** Every action that can reasonably be performed faster, precisely, or repeatedly with a keyboard must be discoverable in the global Command Palette.

**Original evidence (2026-07-20):**

- The command type exposes roughly 15 non-navigation actions: `packages/app/src/command-palette.ts:7-45`.
- Query operations have direct keyboard execution paths but are intentionally absent from the palette executor: `packages/app/src/browser-shortcuts.ts:62-92`, `packages/app/src/screens/QueryScreen.tsx:148-180`, and `packages/app/src/command-palette.test.ts:95-129`.
- A static inventory found roughly 129 literal button actions across 17 UI files.
- Missing action families include Tools, Packet Console, Query execution/repeat/stop/export/PDU, Browse operations, and Trap filter/export/save actions.

**Original required remediation:**

- Build a central action registry containing `id`, label, keywords, execution handler, enabled state/reason, confirmation metadata, and platform constraints.
- Make buttons, shortcuts, and palette commands invoke the same action definition.
- Register contextual Run, Repeat, Stop, export, create, save, refresh, filter, and management actions.
- Keep destructive or remote-changing actions behind the same confirmations and transaction safety used by pointer/touch paths.

**Implementation acceptance criteria:**

- [x] All keyboard-suitable actions are inventoried and explicitly classified.
- [x] Every applicable action is discoverable in the palette.
- [x] Disabled contextual commands explain why they are unavailable.
- [x] Tests fail when a registered keyboard shortcut or suitable UI action has no palette exposure.
- [x] Low-priority (`-100`) non-executing fallbacks keep every catalog ID discoverable off-route; higher-priority route actions safely override them.
- [x] The full candidate gate passes and the production browser validates catalog availability and priority-safe ownership across route changes; AF-009 owns the exact-code-commit evidence rerun.

---

## P1 — High priority

### AF-004 — Split layouts activate before pane minimums fit

**Remediation status (2026-07-21): Implementation resolved; July versioned matrix passed.** Query, Traps, and nested Browse now use measured container width, exact divider-aware pane minima, and stable mounted stack/drawer fallbacks. Responsive transitions preserve pane identity and drafts; web/native drawer semantics, focus transfer, restoration, Escape, and Android Back are covered by mounted regressions. Final independent specification and quality review passed 54 focused tests plus app typecheck. Current exact-candidate rendered proof is tracked under AF-009.

**Evidence:**

- Split support begins at `640px` without considering remaining container width after application chrome: `packages/app/src/responsive-context.tsx:19-25`.
- The ratio clamp falls back to a nominal ratio when the combined pane minimums are impossible: `packages/app/src/responsive-layout.ts:29-38`.
- Query, Browse, and Traps declare pane minimums that do not fit at multiple active split widths: `packages/app/src/screens/QueryScreen.tsx:648-689`, `BrowseScreen.tsx:506-564`, and `TrapsScreen.tsx:539-609`.

Live audit measurements included:

- At `640px`, Query/Traps had approximately `576px` of usable workspace width.
- At `820px`, Query had approximately `747px` after divider width, below its declared minimum.
- Browse's outer split was modified concurrently during the audit, but the nested navigator/inspector minimums remained impossible at the narrow expanded breakpoint.

**Required remediation:** use the measured container width after chrome and screen-specific minimums. If minima cannot fit, use stacking or a drawer rather than an invalid split.

**Acceptance criteria:**

- [x] Boundary tests cover global breakpoints, exact Query/Traps divider boundaries, nested Browse boundaries, and `1023/1024` outer-workspace identity.
- [x] Tests cover nested Browse splits, resized desktop windows, stable mounts, and focus behavior.
- [x] No activated split pane is narrower than its declared usable minimum; invalid widths deliberately use stack/drawer fallbacks.

### AF-005 — Low-height navigation controls overlap

**Revalidation status (2026-07-20, `7074513`): Reproducible.** Navigation items and footer actions remained fixed, non-scrollable siblings with no height-aware collapse or low-height hit-test coverage.

At `640x480`, the apparent Settings entry was covered by Command Palette; hit-testing and clicking the Settings position activated Commands instead.

**Evidence:** `packages/app/src/AppRoot.tsx:807-900` and `1121-1158`.

**Remediation status (2026-07-21): Implementation resolved; July versioned matrix passed.** Desktop navigation is extracted into `packages/app/src/components/AppNavigation.tsx` and rendered as one height-bounded vertical `ScrollView` that owns both primary tabs and footer actions. The compact rail tooltip layer renders outside the scroll container so short-height overflow cannot clip labels or block hit-testing. Current exact-candidate rendered proof is tracked under AF-009.

**Fresh parent verification (2026-07-21 10:32 -03):**

- `rtk test pnpm exec vitest run packages/app/src/app-navigation-mounted.test.ts` — 4/4 tests passed.
- `rtk test pnpm --filter @mibbeacon/app typecheck` — passed.
- `rtk grep -n "sidebar:\|sidebarItem\|engineMeta\|AppNavigation\|AF-005" packages/app/src/AppRoot.tsx packages/app/src/components/AppNavigation.tsx docs/audit-failures.md` — confirms `AppRoot.tsx` only imports/renders `AppNavigation`; navigation styles now live in `AppNavigation.tsx`.

**Acceptance criteria:**

- [x] `640x480` and `820x600` render every navigation action reachable and independently hit-testable in mounted regression coverage.
- [x] Focus and keyboard traversal reach the same actions without hidden overlap.

### AF-006 — Notification controls are unconfigurable and unsupported on native

**Revalidation status (2026-07-20, `7074513`): Reproducible.** Browser permission is still requested from a rule event, Settings has no Notifications section, and mobile has neither a native notification adapter nor the Android runtime permission.

**Original evidence (2026-07-20):**

- The browser path automatically requests notification permission and emits watch notifications: `packages/app/src/AppRoot.tsx:687-727`.
- No Notifications Settings category exposes opt-in, permission status, or watch behavior.
- Mobile shows notification controls but has no native notification dependency or Android `POST_NOTIFICATIONS` declaration: `apps/mobile/package.json:15-41`, `apps/mobile/app.json:17-37`, and `packages/app/src/screens/TrapsScreen.tsx:318-341`.

**Original required remediation:** add Settings controls and explicit permission state, then implement a browser/native host adapter. Unsupported platforms must disable the feature with an explanation rather than presenting a nonfunctional control.

**Implementation progress (2026-07-21):** Notification delivery now goes through `packages/app/src/notification-delivery.ts` host adapters and only calls `show()` after the relevant Settings preference is enabled and the adapter reports `granted` permission. Trap-rule and Tools watch events no longer request permission implicitly. Settings includes a Notifications section with explicit permission status, opt-in controls, a permission request button, and an unsupported-host explanation. The mobile host declares `expo-notifications`, wires a native notification adapter, and includes Android `POST_NOTIFICATIONS`.

**Historical runtime gap:** Release run `29843854069` successfully built, installed, and launched the signed APK, but its Android step did not assert notification-manager state after exercising the app. That historical limitation is superseded by the provisional current runtime evidence below.

**Current revalidation status (2026-08-13): Behavior resolved provisionally; exact-code-commit rerun tracked by AF-009.** A clean Expo prebuild and rebuilt signed release APK were exercised through the production notification adapter, generating `docs/audits/android-native-effects/evidence.json`. Its provisional `testedCommit` is `be5fe8088a12dc1e22bc97464cd3d88603231839`; the rebuilt release APK SHA-256 is `1b1bb4564be74a13671f81c5d67c5e629f06bb8092697949dd5640cedb923140`. `dumpsys notification --noredact` recorded package `com.librestatic.mibbeacon`, title `MIB Beacon native adapter audit`, body `Release notification delivery verified.`, `delivered=true`, `hidden=false`, and `intercepted=false`. Both APKs verify under APK Signature Scheme v2, and the evidence bundle checksum covers the JSON, raw dumpsys output, receiver log, chooser XML, and notification screenshot. Because the tested worktree was dirty, AF-009 requires the same pass after the code candidate is committed.

**Fresh parent verification (2026-07-21 10:44 -03):**

- `rtk test pnpm exec vitest run packages/app/src/notification-delivery.test.ts packages/app/src/notification-settings-source.test.ts` — 4/4 tests passed.
- `rtk test pnpm --filter @mibbeacon/app typecheck` — passed.
- `rtk test pnpm --filter @mibbeacon/mobile typecheck` — passed.

**Acceptance criteria:**

- [x] Settings exposes notification preference controls plus current permission state.
- [x] Browser trap-rule and watch events do not auto-request notification permission.
- [x] Native Android declares notification dependency/permission and wires a host adapter.
- [x] Android emulator notification permission and delivery are proven provisionally; AF-009 owns the exact-post-commit freshness rerun.

### AF-007 — Android chart PNG sharing can produce an empty share intent

**Revalidation status (2026-07-20, `7074513`): Reproducible.** Chart export still sent a `data:` URL through React Native Share. The mobile host's existing cached-file plus `expo-sharing` packet-export implementation was the compliant adapter reference.

**Original evidence (2026-07-20):**

`packages/app/src/components/ToolLineChart.tsx:132-178` sends a `data:` URL through React Native `Share.share({url})`; Android's React Native share implementation does not forward that URL as binary image content.

**Implementation progress (2026-07-21):** `ToolLineChart` now keeps browser canvas download behavior on web but delegates native PNG export through `sharePng`. `AppHostAdapter` exposes `shareChartPng`, `ToolsScreen` passes it to charts, and the mobile host decodes the base64 PNG into a cache file, shares that file with MIME type `image/png`, preserves the generated filename, and deletes the cache file after the share promise resolves.

**Historical runtime gap:** The successful published-release emulator pass did not install or invoke a purpose-built share receiver and did not validate `EXTRA_STREAM`, URI permission, MIME type, PNG signature, filename, or readable bytes. That historical limitation is superseded by the provisional current runtime evidence below.

**Current revalidation status (2026-08-13): Behavior resolved provisionally; exact-code-commit rerun tracked by AF-009.** The self-contained emulator harness installed rebuilt receiver APK SHA-256 `628cf4b06511efb5663d336f39fe4b358086c4a8110237e61077eedd6ce74953`, selected `MIB Beacon audit receiver` semantically, and the receiver opened the granted `EXTRA_STREAM`. `evidence.json` records `ACTION_SEND`, MIME `image/png`, filename `mib-beacon-native-adapter-audit.png`, read grant, 68 bytes, a valid/decodable PNG, and SHA-256 `431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460`. `SHA256SUMS` covers the retained evidence. Because the provisional run names base commit `be5fe80` while the worktree was dirty, AF-009 requires an exact-code-commit rerun.

**Fresh parent verification (2026-07-21 10:48 -03):**

- `rtk test pnpm exec vitest run packages/app/src/chart-native-sharing-source.test.ts` — 2/2 tests passed.
- `rtk test pnpm --filter @mibbeacon/app typecheck` — passed.
- `rtk test pnpm --filter @mibbeacon/mobile typecheck` — passed.
- `rtk git diff --check` — passed.

**Acceptance criteria:**

- [x] Android emulator receiver reads the actual PNG attachment provisionally; AF-009 owns the exact-post-commit freshness rerun.
- [x] Shared file URI, MIME type, filename, and cleanup are covered by source regression tests.
- [x] Browser download behavior remains in the web branch.

### AF-008 — Prerequisites cannot consistently be completed in context

**Revalidation status (2026-07-20, `7074513`): Reproducible.** Recent mobile profile management makes Agents reachable and improves profile mutation safety, but Query groups/bookmarks/graphs, trap presets/composer, missing Live MIB catalog data, and empty group creation still lack complete in-context create/select/continue flows.

**Deviating flows:**

- Query group creation redirects to Agents: `packages/app/src/screens/QueryScreen.tsx:738-777`.
- Bookmark and persistent graph actions require a saved agent without letting the user save the current ad-hoc target and continue: `QueryScreen.tsx:336-363`, `993-1001`, and `1327-1375`.
- Trap preset/composer flows cannot create a missing profile in place: `packages/app/src/screens/TrapsScreen.tsx:911-948` and `packages/app/src/components/TrapComposerDialog.tsx:130-170`.
- Live MIB catalog absence only tells users to import/load elsewhere: `packages/app/src/screens/LiveMibsScreen.tsx:474-476`.
- Empty agent groups can be created without an inline member/profile completion flow: `packages/app/src/screens/AgentsScreen.tsx:191-223`.

**Compliant references:** Tools and Live MIB target onboarding already provide in-context create/select behavior.

**Remediation status (2026-07-21): Resolved in the current worktree.** Query now lets users save the current ad-hoc target as a profile in place and auto-selects the created profile. Trap Composer now lets users create a saved notification target in the composer and auto-selects it before continuing. Live MIBs now mounts the shared import flow in the empty catalog state. Agent group creation now explains the member prerequisite and prevents empty groups. Query also creates and auto-selects groups in place; bookmark and graph actions open profile creation when needed and automatically resume after the new profile is selected.

**Fresh parent verification (2026-07-21 10:52 -03):**

- `rtk test pnpm exec vitest run packages/app/src/prerequisite-in-context-source.test.ts` — 2/2 tests passed.
- `rtk test pnpm --filter @mibbeacon/app typecheck` — passed.

**Additional parent verification (2026-07-21 10:59 -03):**

- `rtk test pnpm exec vitest run packages/app/src/prerequisite-in-context-source.test.ts` — 3/3 tests passed after adding Live MIB catalog import coverage.
- `rtk test pnpm --filter @mibbeacon/app typecheck` — passed.
- `rtk git diff --check` — passed.

**Additional parent verification (2026-07-21 11:00 -03):**

- `rtk test pnpm exec vitest run packages/app/src/agent-group-prerequisite-source.test.ts packages/app/src/prerequisite-in-context-source.test.ts` — 4/4 tests passed.
- `rtk test pnpm --filter @mibbeacon/app typecheck` — passed.
- `rtk git diff --check` — passed.

**Final prerequisite verification (2026-07-21 11:16 -03):**

- `rtk test pnpm exec vitest run packages/app/src/prerequisite-in-context-source.test.ts packages/app/src/agent-group-prerequisite-source.test.ts` — 4/4 tests passed.
- `rtk test pnpm --filter @mibbeacon/app typecheck` — passed.
- Targeted ESLint and `rtk git diff --check` — passed.

**Acceptance criteria:**

- [x] Each dependent page explains the missing prerequisite. Query, Trap Composer, Live MIB empty catalog, and empty Agent group states now do.
- [x] Existing resources can be selected in place.
- [x] New resources can be created in place and are auto-selected. Query/Trap Composer saved-profile creation and Live MIB import now pass this criterion for their prerequisites.
- [x] The interrupted action resumes after prerequisite completion.

### AF-009 — Validation automation does not enforce the required matrix

**Revalidation status (2026-07-20, `7074513`): Reproducible.** Focused tests pass but still omit Live MIB route identity, low-height/occlusion/vertical-reach checks, nested threshold coverage, native notification/sharing behavior, and enforced Android emulator execution. The release checklist currently overstates CI emulator coverage.

**Original evidence (2026-07-20):**

- `dev/audit/capture-plan09.py:9-62` omits Live MIBs, duplicates Browse through a `mibs` alias, and checks horizontal overflow without comprehensive vertical reach, occlusion, pane-minimum, or dialog checks.
- `dev/audit/mobile-layout-smoke.py:9-52` concentrates on two tall compact viewports and x-axis bounds.
- `dev/audit/split-workspace-smoke.py:52-66` validates only a large desktop viewport.
- `.github/workflows/ci.yml:21-31` does not enforce rendered responsive or Android validation.
- `.github/workflows/release.yml:778-852` does not provide the required emulator coverage.

**Original required remediation:** create one versioned validation matrix covering route identity, breakpoint edges, short landscape sizes, vertical reachability, hit-target occlusion, scrolling to the final required control, nested panes, dialogs, native notifications, binary sharing, and commit freshness.

**Implementation progress (2026-07-21):** `dev/audit/validation-matrix.v1.json` covers the real `#/live-mibs` route, breakpoint edges, short landscape, route identity, bounds, hit testing, occlusion, last-control reachability, nested panes, dialogs, native requirements, and tested-commit freshness. `dev/audit/validation-matrix.py` passed against a fresh production build at commit `7e35a688da5e343d468f5ccda6650bac066b8223`. CI runs the browser matrix and uploads commit-keyed evidence. The published v0.6.0 Release workflow repeated the browser matrix and launched its signed APK in an API 35 emulator; that historical run did not prove native notification or sharing effects.

**Current worktree harness and provisional run (2026-08-13):** Release configuration now builds a dedicated audit receiver and replaces the historical launch-only emulator step with `dev/audit/android-native-effects/run.sh`. The runner has an exact expected-commit guard, performs the AF-006 notification and AF-007 share-receiver assertions, and uploads `audit-android-native-effects-${{ github.sha }}` evidence. A finalized Expo config mod removes injected dev-scheme data from each dedicated audit intent filter, and a clean-prebuild regression proves that each audit filter contains exactly one `mibbeacon://localhost` exact path. The locally rebuilt signed release and receiver APKs passed the self-contained harness and produced the evidence described under AF-006/AF-007; it remains provisional only because the dirty worktree means its recorded base commit is not the final code candidate.

**Historical local Android availability (2026-07-21):** the original host check found no connected device and no emulator executable in `PATH`, so the July release workflow owned the launch-only APK check.

**Current Android availability (2026-08-13):** `/home/facuarmo/Android/Sdk/emulator/emulator` is installed, AVDs are configured, and `adb` reported a running emulator for the provisional successful native-effects pass. The former environment blocker and the AF-006/AF-007 behavioral gaps are closed; only AF-009's exact-post-commit freshness rerun remains.

**Current revalidation status (2026-08-13): Open only for exact-code-commit evidence.** The fresh production browser report passes 58/58 scenarios, the versioned matrix passes 58/58 checks, the full suite passes 1,292 tests (1,288 passed and four intentionally skipped), and the hardened/rebuilt native harness passes both effects. The provisional reports still name base commit `be5fe80`, while the worktree contains the uncommitted implementation. They prove current behavior but not the final code commit. The historical published Release workflow established signed-APK installation and launch only; the current harness supersedes that behavioral limitation. Close AF-009 only after:

- the accepted browser harness passes every declared route and viewport against the exact intended commit (or a documented reproducible dirty-tree digest before commit);
- the evidence bundle contains no stale artifacts or route-identity false positives;
- AF-006 and AF-007 assertions execute successfully against the exact candidate and produce an accepted evidence bundle; and
- the committed CI/release configuration contains and validates those assertions, retained evidence is keyed to the tested SHA, and the already-published v0.6.0 workflow is not rerun.

**Acceptance criteria:**

- [x] Browser checks cover mobile, tablet, desktop, breakpoint edges, and low-height landscape.
- [x] Every primary workspace, including Live MIBs, is identified and visited directly.
- [x] Checks validate horizontal and vertical bounds, hit-testing, occlusion, and last-control reachability.
- [x] The current hardened Android harness verifies notification delivery and binary sharing provisionally; rerun it on the exact committed code candidate.
- [ ] Final browser and native evidence is tied to the exact current candidate commit.

---

## P2 — Additional deviations and classification backlog

### AF-010 — Persisted layout behavior lacks Settings controls

**Revalidation status (2026-07-20, `7074513`): Reproducible.** Split and dock values remained persisted directly by components, and Settings still had no observable Layout preference service, category, or reset-all/per-workspace controls.

Split ratios and dock sizes are persisted through direct manipulation, but Settings provides no centralized defaults or reset controls.

- `packages/app/src/components/SplitWorkspace.tsx:30-107`
- `packages/app/src/components/VerticalDockWorkspace.tsx:13-62`

**Remediation status (2026-07-21): Resolved in the current worktree.** Settings now includes a Layout category with reset actions for split-pane ratios and packet dock sizing. Split and dock components expose reset helpers that clear their persisted layout keys so the responsive defaults are restored on remount/resize.

**Fresh parent verification (2026-07-21 10:56 -03):**

- `rtk test pnpm exec vitest run packages/app/src/layout-settings-source.test.ts` — 1/1 test passed.
- `rtk test pnpm --filter @mibbeacon/app typecheck` — passed.
- `rtk git diff --check` — passed.

### AF-011 — Packet Console trigger is clipped

**Revalidation status (2026-07-20, `7074513`): Partially resolved.** Compact mode used a 24px collapsed shell matching the pull tab. Medium/desktop still used a 20px overflow-hidden shell around the 24px trigger, leaving 4px clipped.

The collapsed shell is `20px` high while its pull tab is `24px`, and the parent hides overflow:

- `packages/app/src/packet-console.ts:15-30`
- `packages/app/src/components/PacketConsole.tsx:296-302`

**Remediation status (2026-07-21): Resolved in the current worktree.** All responsive modes now use the 24px collapsed Packet Console size, matching the pull tab height and preventing the medium/desktop trigger from being clipped.

**Fresh parent verification (2026-07-21 10:53 -03):**

- `rtk test pnpm exec vitest run packages/app/src/packet-console.test.ts` — 5/5 tests passed.
- `rtk test pnpm --filter @mibbeacon/app typecheck` — passed.
- `rtk git diff --check` — passed.

### AF-012 — Variable-length control rows can become unreachable

**Revalidation status (2026-07-20, `7074513`): Partially resolved.** Live MIB enum and BITS controls used deliberate horizontal scrolling. The five-field SNMPv1 trap composer row still compressed without wrapping or stacking and lacked narrow rendered coverage.

Potential overflow sources include:

- Live MIB enum/BITS chip rows: `packages/app/src/screens/LiveMibsScreen.tsx:1151-1175`
- SNMPv1 trap composer field row: `packages/app/src/components/TrapComposerDialog.tsx:280-313`
- Shared non-wrapping Row behavior: `packages/ui/src/primitives.tsx:476-478`

**Remediation status (2026-07-21): Resolved and covered by the passing narrow-dialog/browser matrix.** The SNMPv1 trap composer envelope now uses a deliberate wrapping row with bounded field wrappers, allowing sysUpTime, agent address, enterprise OID, generic, and specific fields to wrap instead of compressing into one unreachable row.

**Fresh parent verification (2026-07-21 10:54 -03):**

- `rtk test pnpm exec vitest run packages/app/src/trap-composer-responsive-source.test.ts packages/app/src/prerequisite-in-context-source.test.ts` — 3/3 tests passed.
- `rtk test pnpm --filter @mibbeacon/app typecheck` — passed.
- `rtk git diff --check` — passed.

### AF-013 — Settings exposure requires a product-wide classification pass

**Revalidation status (2026-07-20, `7074513`): Reproducible.** Notifications and Layout were confirmed omissions, recurring Tools defaults remained unclassified, and no typed preference catalog or enforcement test recorded which behaviors are Settings-backed versus intentionally contextual-only.

In addition to the confirmed notification and layout gaps, recurring Tools defaults, Packet Console defaults, export defaults, and similar persistent user preferences should be explicitly classified as:

1. Must be configurable in Settings.
2. Contextual only, with a documented reason.
3. Not user-configurable, with a documented product constraint.

**Remediation status (2026-07-21): Resolved in the current worktree.** A typed preference catalog now classifies recurring product preferences as Settings-backed, contextual-only, or constrained, with rationales and settings-section ownership for Settings-backed behavior. Enforcement tests verify required catalog properties and key Settings-backed entries.

**Fresh parent verification (2026-07-21 10:57 -03):**

- `rtk test pnpm exec vitest run packages/app/src/settings-preference-catalog.test.ts` — 1/1 test passed.
- `rtk test pnpm --filter @mibbeacon/app typecheck` — passed.
- `rtk git diff --check` — passed.

This prevents future features from silently bypassing the Settings rule.

---

## Verification evidence from the original audit

### Evidence freshness rule (2026-08-13)

Every final validation claim must identify the tested Git commit. The current local branch is three commits ahead of the released SHA, and the worktree is dirty, so the prior v0.6.0 evidence is historical rather than proof of the current candidate. Rerun the complete affected matrix after the intended audit changes are committed; until then, describe dirty-tree results as provisional and record a reproducible content digest.

- TypeScript typecheck passed.
- Lint passed.
- The app test suite passed.
- Delegated Settings/commands/prerequisite checks passed `17/17` while exposing missing coverage.
- Delegated responsive checks passed `41/41` while live rendering exposed failures outside the tests.
- One resolver test exceeded the root suite's 10-second timeout; it passed in isolation in approximately 3.2 seconds.
- Live browser checks covered mobile, tablet, desktop, and short-landscape dimensions.
- No Android device or runnable SDK emulator was available during the original 2026-07-20/21 validation. This historical limitation no longer applies as of 2026-08-13.

Passing tests alone did not establish AGENTS.md compliance; the 2026-08-13 revalidation therefore requires rendered and native effect evidence in addition to source assertions.

## Existing foundations to reuse

- `packages/app/src/live-mibs-model.ts` — safe remote-edit transaction model.
- Tools target onboarding — in-context prerequisite completion reference.
- Live MIB target onboarding — create/select/auto-select reference.
- Shared scrollable Dialog primitive.
- `useWindowDimensions()` responsive context.
- Runtime theme normalization through `createTheme()`, after strengthening its postconditions.

## Remediation sequence

1. Revalidate findings against the current dirty worktree and mark concurrent fixes.
2. Implement shared remote transaction, semantic contrast, action registry, and responsive viability infrastructure.
3. Migrate critical Settings and persistent remote controls.
4. Repair all bundled/imported theme component states and add the rendered-context matrix.
5. Register keyboard-suitable actions in the Command Palette.
6. Fix split viability and low-height navigation.
7. Add notification Settings plus browser/native notification adapters.
8. Replace Android data-URL sharing with real binary-file sharing.
9. Complete all in-context prerequisite gates.
10. Fix clipping, wrapping, and remaining reachability defects.
11. Enforce the browser/native validation matrix in standard scripts, CI, and release workflows.
12. Update this document with verification evidence and commit references as each item closes.
13. After every revalidation, remediation, and verification gate passes, commit and push the verified post-release remediation to `origin/master`; do not retag or republish v0.6.0.

## Release and workflow plan

**Historical status (revalidated 2026-08-13): Completed for v0.6.0.** The following steps document the release that already occurred. They are retained as an audit trail, not as authorization to push, retag, republish, or trigger another v0.6.0 run while the current audit continues.

### Published v0.6.0 evidence

- Release candidate commit: [`e393537bd3e883bbfa6cfec0f43d72432dc75404`](https://github.com/LibreStatic/mib-beacon/commit/e393537bd3e883bbfa6cfec0f43d72432dc75404) (`release: prepare v0.6.0 compliance remediation`).
- Android permission fix: [`b310d6ee93d26ebca70f0ce7ab7860d8f9cb7941`](https://github.com/LibreStatic/mib-beacon/commit/b310d6ee93d26ebca70f0ce7ab7860d8f9cb7941).
- Emulator-runner fix and final released commit: [`7eb855a4bc037677955b9d113030d9f44cede52f`](https://github.com/LibreStatic/mib-beacon/commit/7eb855a4bc037677955b9d113030d9f44cede52f).
- `origin/master` and `refs/tags/v0.6.0^{}` both resolve to `7eb855a4bc037677955b9d113030d9f44cede52f`; annotated tag object `refs/tags/v0.6.0` is `1a238c16184540a07375f8ab65bab7218b3894e5`.
- First tag-push attempt: [Release run `29839915791`](https://github.com/LibreStatic/mib-beacon/actions/runs/29839915791), `push` on `v0.6.0` at `e393537`, failed in Android **Audit merged Android permissions**. Publication was skipped.
- Second tag-push attempt: [Release run `29841813277`](https://github.com/LibreStatic/mib-beacon/actions/runs/29841813277), `push` on `v0.6.0` at `b310d6e`, passed the permission audit but failed **Launch signed APK in Android emulator** because separate runner script invocations did not preserve the shell variable containing the APK path. Publication was skipped.
- Successful replacement: [Release run `29843854069`](https://github.com/LibreStatic/mib-beacon/actions/runs/29843854069), `push` on `v0.6.0` at `7eb855a`, concluded `success`. `verify`, Android, iOS, all three desktop jobs, Flatpak, and `publish` succeeded; `update-smoke` was intentionally skipped.
- Published release: [`v0.6.0`](https://github.com/LibreStatic/mib-beacon/releases/tag/v0.6.0), published 2026-07-21, non-draft and non-prerelease, targeting `master`.
- The release contains **24 assets**: 23 distributable/metadata artifacts plus `SHA256SUMS`. The publish job's **Verify published inventory and checksums** step passed, covering the other 23 assets.
- The three tag-push runs were two failed pre-publication attempts followed by one successful publication; there was no duplicate published release. This supersedes the earlier prospective wording that implied the first triggered run necessarily succeeded.

The remainder of this section is a historical record of the completed v0.6.0 release. It is non-actionable for this remediation and must not be used to repeat a version bump, push a replacement tag, or dispatch another Release workflow.

### 1. Historical release baseline

- Historically, the release process queried GitHub immediately before releasing, identified the most recent successful `Release` workflow run, and recorded its run ID, URL, event type, ref, commit, effective output selection, and completed/skipped job matrix here.
- The recorded baseline was current when the completed release ran; it is retained only as history.
- Immediately before the v0.6.0 release, the captured latest passing baseline was GitHub Actions run `29736405973`, triggered by a tag `push` on `v0.1.0-beta.1` at commit `dc1ed339e3e165444050cefed5978d9ec6d58bbf`.
- Its effective selection was:
  - `appimage=true`
  - `deb=true`
  - `rpm=true`
  - `flatpak=true`
  - `nsis=false`
  - `nsis_unsigned=true`
  - `dmg=false`
  - `dmg_unsigned=true`
  - `apk=true`
  - `aab=true`
  - `ipa=true`
- The same selection was produced by `dev/release-selection.mjs` for the v0.6.0 tag push and was verified unchanged between the baseline and released commit.

### 2. Historical version `0.6.0` preparation

- Updated the root and every workspace package manifest from the old version to exactly `0.6.0`.
- Updated `apps/mobile/app.json` so Expo `version` and its app-version runtime policy resolved to `0.6.0`, including the platform build identifiers introduced before this phase.
- Updated the canonical release-version expectations in `tests/release-identity.test.ts` and any newer identity/version tests.
- Added `docs/releases/v0.6.0.md` with user-visible release notes derived from the actual audited fixes.
- Added the `0.6.0` release entry and `v0.6.0` URL to `packaging/flatpak/com.librestatic.mibbeacon.metainfo.xml`.
- Ran `pnpm release:prepare` to regenerate `packages/app/src/generated/release-info.ts`, `packages/core/src/generated/version.ts`, and the dependency-license inventory from the canonical root version.
- Searched the repository for stale release-version references and classified each occurrence instead of performing a blind global replacement; historical release notes and tests for previous-version behavior intentionally remained unchanged where appropriate.

### 3. Historical final release gate

- Confirmed the working tree contained only intended audit remediation, documentation, version, generated metadata, and release-note changes while preserving unrelated dirty files.
- Ran dependency installation with the lockfile frozen, license verification, typecheck, lint, the complete test suite, and `pnpm verify:release-metadata`.
- Ran the responsive/browser/native/package audits made mandatory by the completed AGENTS.md remediation under the then-current AGENTS.md validation rules.
- Verified the candidate version was exactly `0.6.0`, the intended tag was exactly `v0.6.0`, and the tag did not already exist locally or remotely.
- The process was configured to stop before commit/push on any locally reproducible failure.

### 4. Historical release-candidate commit and push

**Pre-commit release gate (2026-07-21): Passed.** Frozen install, license verification, workspace typecheck, ESLint, the complete Vitest suite, release metadata verification, server production build, `git diff --check`, and validation matrix v1 all passed with canonical version `0.6.0`. The only unavailable local check is physical/emulated Android interaction because `adb` found no device and the host has no emulator executable; the Release job now owns the signed-APK emulator launch.

- Staged only the intended completed goal and release files, inspected the staged snapshot, and ran `git diff --cached --check`.
- Created a conventional release commit on `master`, for example `release: prepare v0.6.0`.
- Reconfirmed the commit contains the validated version and release metadata and that local `master` has the expected relationship to `origin/master`.
- Pushed that exact commit to `origin/master` without force-pushing.
- Verified the remote `master` SHA equals the locally validated release commit before tagging.

### 5. Historical matching Release workflow trigger

- Because `.github/workflows/release.yml` required an existing `v*` ref whose name matched the package version, the process created an annotated `v0.6.0` tag on the verified `master` commit and pushed it.
- The tag push automatically triggered the `Release` workflow; no duplicate `workflow_dispatch` run was created.
- Confirmed the new run used the same event semantics and effective output selection as the latest successful baseline: a tag `push` with the eleven values listed above.
- No manual fallback was needed; the successful tag-push run was the single publishing run.

### 6. Historical publication monitoring

- Followed the new run until every selected job finished rather than treating a queued or merely started run as complete.
- Required successful verification, selected desktop packages, Flatpak, Android APK/AAB, unsigned iOS IPA, publication, exact asset inventory, and `SHA256SUMS` validation according to the selected baseline.
- Verified the published GitHub release is tagged `v0.6.0`, is not a draft, has the intended prerelease status, points to the pushed `master` commit, and contains only the expected artifacts.
- Recorded the release run URL, run ID, commit SHA, tag SHA, release URL, selected inputs/jobs, and final conclusion in this document.
- Two pre-publication failures were diagnosed and fixed on `master`; the final replacement tag-push run succeeded and published exactly one release.

## Worktree containment note

The original audit itself did not intentionally modify product code. As of 2026-08-13, local `master` is three commits ahead of `origin/master`, and `package.json`, `dev/audit/ui-browser-audit.py`, `docs/audits/ui-browser/`, and `docs/plans/post-v1/` are modified/untracked concurrently. Remediation must preserve unrelated work, classify each path before staging, and use narrowly scoped commits. The published `v0.6.0` tag must not be moved merely because local `master` has advanced.
