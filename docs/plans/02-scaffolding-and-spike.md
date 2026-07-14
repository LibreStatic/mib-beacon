# 02 — Scaffolding & Feasibility Spike

Status: implemented (GO verdict; S1–S5 validated on desktop and the Android release-APK emulator, with physical-device behavior retained as release evidence)
Depends on: 01 (contracts)
**GATING PHASE**: the spike at the end is the go/no-go for the whole stack. Do the spike tasks (S1–S5) FIRST with throwaway code if that's faster, then scaffold properly — or scaffold first and spike inside it; either order is fine, but do not proceed to plans 03+ until every spike exit criterion is recorded in `docs/plans/SPIKE-RESULTS.md`.

## Objective

A pnpm monorepo where `pnpm dev:desktop` opens an Electron window rendering a shared React Native (web) screen, `pnpm dev:mobile` runs the same screen in an Expo dev build on Android, and both can execute a real SNMP Get and receive a real trap through the `EngineAPI` seam.

## Tasks

### T1 — Workspace root

- `pnpm init`; `pnpm-workspace.yaml` covering `apps/*`, `packages/*`.
- Root `tsconfig.base.json` (strict, `moduleResolution: bundler`, path aliases `@mibbeacon/*` → `packages/*/src`).
- Root eslint (typescript-eslint + react + react-native + import rules incl. the dependency-direction restrictions from `docs/plans/README.md`) + prettier.
- `vitest.workspace.ts` covering `packages/*`.
- Root scripts: `dev:desktop`, `dev:mobile`, `typecheck`, `lint`, `test` (recursive).
- `.gitignore`, `.editorconfig`. Initialize git repo, first commit.

### T2 — packages/transport

- Define the interfaces from plan 01 (`UdpSocketFactory`, `TcpSocketFactory`, `CryptoProvider`, `FileStore`, `StorageAdapter`, `SecretStore`, `HttpClient`) in `src/types.ts`.
- `src/node/` implementations: dgram, net, node:crypto, node:fs, better-sqlite3, Electron safeStorage (safeStorage impl lives in `apps/desktop` and is injected — transport only defines the interface + a plaintext-forbidden guard), fetch with timeout/UA.
- `src/react-native/` implementations: react-native-udp, react-native-tcp-socket, react-native-quick-crypto, expo-file-system, expo-sqlite, expo-secure-store, fetch.
- Export condition or explicit entry points (`@mibbeacon/transport/node`, `@mibbeacon/transport/react-native`) — do NOT rely on runtime platform sniffing.
- Unit tests for the Node implementations (UDP echo test, SQLite round-trip, HTTP timeout).

### T3 — packages/core (walking skeleton)

- `EngineAPI` types (full interface from plan 01, stub implementations throwing `NOT_IMPLEMENTED` except:)
- `agents.test()`-equivalent minimal path: a `snmpGet(agentSpec, oid)` using node-net-snmp with injected transport, and `traps.startReceiver/stopReceiver/query` minimal path (in-memory list is fine for the spike; SQLite lands in plan 05).
- `errors.ts` with the `MibBeaconError` codes from plan 01 (transport + basic SNMP set).
- DB bootstrap: migration runner + `schema_migrations` + `settings` table only.

### T4 — packages/ui + packages/app (walking skeleton)

- Tamagui config (light/dark themes), one shared screen: **Spike screen** — form (host, community, OID default `1.3.6.1.2.1.1.1.0`), "Get" button, result area; "Start trap receiver" toggle + live trap list.
- zustand store wiring the screen to an injected `EngineAPI` via React context (`EngineProvider`).

### T5 — apps/desktop

- electron-vite project: main (instantiates core with Node transport), preload (contextBridge `window.mibbeaconEngine`), renderer (react-native-web; vite alias `react-native` → `react-native-web`).
- The `ipc-bridge.ts` generic mapper (EngineAPI ⇄ ipc channels) from plan 01, including the event-subscription channel.
- Security flags: contextIsolation on, sandbox on, CSP in index.html.
- `pnpm dev:desktop` opens the Spike screen.

### T6 — apps/mobile

- `create-expo-app` (TypeScript), expo-dev-client; monorepo-aware Metro config (watchFolders = repo root) + the Node-builtin aliases from plan 01; Babel/entry polyfills (`global.Buffer`, `process`).
- Native deps: `react-native-udp`, `react-native-tcp-socket`, `react-native-quick-crypto`, `expo-sqlite`, `expo-secure-store`, `expo-file-system`. Config plugins/prebuild as required.
- App entry instantiates core with RN transport; renders the same Spike screen.
- `pnpm dev:mobile` = `expo run:android` (document dev-build workflow; Expo Go explicitly unsupported).

### T7 — CI

- GitHub Actions: on PR/push — pnpm install (cached), `typecheck`, `lint`, `test`. Android/iOS/Electron packaging NOT in CI yet (plan 10).

## Spike (exit criteria — all must be recorded in SPIKE-RESULTS.md with evidence)

Test agent for S1–S3: `snmpd` in Docker on the dev machine (v2c community `public`, a v3 user with SHA-256/AES-128 and one with MD5/DES) — provide `dev/snmpd/docker-compose.yml` + `snmpd.conf` in-repo; CI-oriented alternative: node-net-snmp `Agent` fixture (`dev/fixtures/test-agent.ts`).

- **S1 (desktop Get)**: Electron app on Linux performs v2c Get of sysDescr against the container. ✅/❌ + notes.
- **S2 (desktop v3 + crypto matrix)**: v3 Get with SHA-256/AES-128 and SHA-512/AES-256. Then **DES**: node-net-snmp README warns DES needs OpenSSL legacy provider on Node ≥17; Electron bundles BoringSSL — test `des-cbc` availability in the Electron main process (`crypto.getCiphers()`) and an actual MD5/DES v3 Get. Record outcome; if DES is unavailable, implement DES via a pure-JS fallback ONLY if trivial to inject, otherwise **document "DES unsupported on this build" as an accepted, user-visible limitation** (it's deprecated since 2014).
- **S3 (mobile Get)**: same v2c + SHA-256/AES-128 v3 Gets from an Android dev build (physical device or emulator on the same network as the container). This validates the entire alias/polyfill chain (dgram/crypto/Buffer). Record every shim mismatch encountered and the wrapper fix applied.
- **S4 (trap receive, both hosts)**: `snmptrap` CLI sends a v2c trap → appears in the Spike screen's live list on desktop (port 1162 to avoid setcap during spike) and on Android.
- **S5 (perf sanity)**: walk of a full ifTable (or `1.3.6.1.2.1`) streams ≥1000 varbinds into the UI without freezing either platform (batching works). Rough numbers in the results file.

**Failure protocol**: if S3 fails fundamentally (node-net-snmp cannot run on RN even with wrappers), STOP — the fallback architecture decision (e.g. writing a minimal BER/SNMP codec on RN, or relegating mobile to v2) must be taken by a human/lead-model before any further phase.

## Acceptance criteria

1. Fresh clone → documented commands in README → both apps run the Spike screen.
2. All S1–S5 recorded in `docs/plans/SPIKE-RESULTS.md` (template: criterion, result, evidence, workarounds, follow-ups).
3. CI green; dependency-direction lint rules active and passing.
4. No secrets, no telemetry, license headers/`license` fields correct (GPL-3.0 for workspace packages).

## Test strategy

- Unit: transport Node impls; ipc-bridge mapper (mock ipcMain/ipcRenderer); MibBeaconError mapping for timeout vs refused.
- Manual: the spike itself, with results committed.

## Out of scope

Real MIB parsing (plan 03), styling/theming beyond defaults, packaging/installers (plan 10), iOS (validate in plan 10 at the latest; Android is the representative mobile target until then).

## Deviations

- **SQLite backend**: used Node's built-in `node:sqlite` instead of better-sqlite3 (native
  addon fails to build against Node 26's V8). Requires **Electron ≥ 37** (Node 22+); pinned
  `electron@^37`. `packages/transport/src/{node,react-native}/storage.ts`.
- **Tamagui deferred to plan 09.** Spike UI uses React Native primitives + a minimal theme
  (`packages/ui`) to keep the gating phase focused on the SNMP stack. Plan 09 introduces
  Tamagui + semantic tokens as planned.
- **`@mibbeacon/core/client` subpath added** (not in plan 01's original surface) to give the
  renderer a net-snmp-free import surface (EventBus/MibBeaconError/types). Keeps the SNMP engine
  out of the browser bundle. Worth folding into plan 01's contract when next revised.
- **S3 (on-device Android) passed** on a Pixel_9_Pro emulator. Required shims (all
  committed, documented in SPIKE-RESULTS): removed `.js` import extensions (Metro doesn't
  remap them), a `dgram` auto-bind shim for react-native-udp (`apps/mobile/shims/dgram.js`),
  `assert`/`util` polyfills, and dropping quick-crypto from the Expo plugins array.
- **DES finding**: available on Electron/BoringSSL, absent on plain-Node/OpenSSL-3 by
  default — better than the plan anticipated for desktop. Recorded in SPIKE-RESULTS.md.
