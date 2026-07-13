# MIB Beacon — Implementation Plan Set

This directory is the authoritative implementation plan for MIB Beacon. Each document is a self-contained phase written to be executed by an AI coding agent (or a human) top to bottom. This README defines the execution order and the global conventions every phase must follow.

## Execution order

| Doc | Phase | Depends on | Gating? |
|---|---|---|---|
| [00-product-vision.md](00-product-vision.md) | Product vision & feature matrix | — | Reference only (no code) |
| [01-architecture.md](01-architecture.md) | Architecture & contracts | 00 | Reference only (no code) |
| [02-scaffolding-and-spike.md](02-scaffolding-and-spike.md) | Monorepo scaffolding + feasibility spike | 01 | **YES — go/no-go for the stack** |
| [03-mib-catalog-and-parser.md](03-mib-catalog-and-parser.md) | MIB import, parsing, catalog | 02 | |
| [04-snmp-operations.md](04-snmp-operations.md) | Agent profiles + query operations + Table View | 02, 03 | |
| [05-trap-receiver-sender.md](05-trap-receiver-sender.md) | Trap receiver & sender | 02, 03 | |
| [06-online-mib-resolution.md](06-online-mib-resolution.md) | Online MIB auto-resolution | 03 | |
| [07-custom-sources.md](07-custom-sources.md) | Custom resolver sources (FTP/HTTP/JSON/GitHub) | 06 | |
| [08-tools-suite.md](08-tools-suite.md) | Graphs, discovery, compare, port view | 04 | |
| [09-responsive-ux.md](09-responsive-ux.md) | Responsive layouts, themes, a11y | 03–05 (partial ok) | |
| [10-packaging-release.md](10-packaging-release.md) | Packaging & release pipeline | all | |

03/04/05 can proceed in parallel after 02. 06→07 is strictly sequential. 09 refines screens produced by earlier phases and can start once any two feature phases are merged.

## Global conventions (binding for all phases)

### Workspace
- **pnpm workspaces** monorepo. Node ≥ 20. TypeScript strict mode everywhere; no `any` without an inline justification comment.
- Package scope `@mibbeacon/*`. Layout: `apps/mobile` (Expo), `apps/desktop` (Electron), `packages/{core,smi,transport,resolver,ui,app}`.
- **Dependency direction rules** (enforce with eslint `import/no-restricted-paths` or dependency-cruiser):
  - `packages/ui` and `packages/app` MUST NOT import Node builtins (`fs`, `dgram`, `net`, `crypto`) or `node-net-snmp` directly — they talk to the engine only through the `EngineAPI` interface from `@mibbeacon/core`.
  - `packages/transport` is the ONLY package with platform-conditional code (Node vs React Native backends).
  - `packages/smi` and `packages/resolver` depend on `@mibbeacon/transport` interfaces, never on concrete platform modules.

### Tooling
- Tests: **vitest** for all `packages/*` (pure TS, runs in Node). UI component tests optional in v1; integration tests per the doc's Test strategy section.
- Lint/format: eslint + prettier, one root config.
- Every phase must leave `pnpm -r typecheck`, `pnpm -r lint`, `pnpm -r test` green.

### Runtime & state
- UI state: **zustand** stores in `packages/app`. UI kit: **Tamagui** (config in `packages/ui`).
- Persistence: SQLite behind the `StorageAdapter` interface (`@mibbeacon/transport`): `better-sqlite3` in Electron main, `expo-sqlite` on mobile. Schema migrations live in `packages/core/src/db/migrations/` as ordered SQL files.
- Secrets (SNMP credentials): NEVER in plaintext SQLite. Electron: `safeStorage` encryption before writing. Mobile: `expo-secure-store` (values >2KB chunked or key-wrapped).

### Definition of done (every phase)
1. All tasks in the doc completed or explicitly deferred with a note added to the doc.
2. Acceptance criteria demonstrably met (the doc lists how to demonstrate each).
3. Typecheck, lint, unit tests green across the workspace.
4. New user-facing behavior works on BOTH desktop (Linux Electron) and one mobile target (Android dev build) unless the doc marks it desktop-only.
5. Update the doc's `Status:` line (`not-started` → `in-progress` → `done`) and note any deviations from plan inline under a `## Deviations` heading.

### Test agents (for anything that needs a live SNMP device)
- Local: run `snmpd` in Docker (`polinux/snmpd` or distro snmpd) or use **node-net-snmp's own `Agent` class** as an in-process fixture (preferred for CI — no Docker dependency).
- Trap tests: send with net-snmp's `snmptrap` CLI or node-net-snmp's session `.trap()`/`.inform()` against the app's receiver.
- SNMPv3 negative tests (wrong auth/priv password, unknown user) are required wherever v3 is in scope.

### Non-negotiable product principles
- **No network calls without opt-in.** The online resolver is off until the user enables it (first-run prompt allowed). Honest `User-Agent: MIBBeacon/<version> (+repo URL)`.
- **Lenient by default, transparent always**: parse broken MIBs as far as possible, and always show the user exactly what failed and what was recovered.
- **Everything cancellable**: any operation that can take >1s (walks, polls, resolution chains) must expose cancel and stream partial results.
- **Actionable errors**: never surface a bare timeout when the engine can tell the difference (e.g. v3 `authenticationFailure` vs `unknownUserName` vs UDP timeout).
