# 01 — Architecture & Contracts

Status: done (reference document — no code tasks; the interfaces below are implemented starting in plan 02)

## Overview

One TypeScript monorepo, one React codebase, three hosts (desktop, mobile, and an
optional LAN server). The engine always runs in a native/backend layer — browsers can't
do UDP — and the UI reaches it through the `EngineAPI` seam. The shared pieces live in
`@mibbeacon/core`:

- **`@mibbeacon/core/proxy` (via `@mibbeacon/core/client`)** — `createEngineProxy(adapter)` builds the
  client-side `EngineAPI` over any transport adapter (`invoke` + `subscribe`). Desktop uses
  an IPC adapter (`window.mibbeaconBridge`); the LAN server uses a WebSocket adapter. Renderer-safe
  (no net-snmp).
- **`@mibbeacon/core/bridge`** — host-side dispatch: `ENGINE_METHODS`, `ENGINE_EVENT_CHANNELS`,
  `dispatchEngineCall(engine, method, args)`. Used by the Electron main IPC bridge and the
  LAN server's WebSocket handler alike, so the method list lives in one place.

**Optional LAN server (`apps/server`)**: a Node HTTP+WebSocket server that runs the engine
(Node transport) on a host on the management network and serves the react-native-web UI to
any browser/phone on the LAN. SNMP is sent from the server host. No authentication by design
(LAN-only). This is the self-hostable mode; it doubles as the future team/NOC deployment
path. Run with `pnpm dev:server`.

Original two hosts:

```
┌─────────────────────────── packages/app + packages/ui (React Native) ───────────────────────────┐
│  Screens, navigation, zustand stores, Tamagui components — platform-agnostic React Native code   │
└──────────────┬───────────────────────────────────────────────────────┬──────────────────────────┘
               │ EngineAPI (typed async interface + event streams)      │
   DESKTOP     │                                              MOBILE    │
┌──────────────▼──────────────────────────┐   ┌────────────────────────▼─────────────────────────┐
│ apps/desktop (Electron)                 │   │ apps/mobile (Expo dev build)                     │
│ renderer: react-native-web build        │   │ engine runs IN-PROCESS on the JS thread          │
│ EngineAPI = IPC proxy over contextBridge│   │ EngineAPI = direct import of @mibbeacon/core           │
│ main process: hosts @mibbeacon/core engine    │   │ transport: react-native-udp / tcp-socket /       │
│ transport: dgram / net / node:crypto /  │   │   react-native-quick-crypto / expo-file-system / │
│   node:fs / better-sqlite3              │   │   expo-sqlite (via Metro aliases + adapters)     │
└─────────────────────────────────────────┘   └──────────────────────────────────────────────────┘
```

**SNMP engine**: [`node-net-snmp`](https://github.com/markabrahams/node-net-snmp) (npm package `net-snmp`, MIT). It provides sessions (v1/v2c/v3 incl. SHA-224..512 auth, DES/AES-128/AES-256 priv), trap/inform `Receiver`, an `Agent` (used as a test fixture), and a MIB `ModuleStore` parser. It is pure JS over `dgram` + `crypto` + `Buffer` — which is exactly what the transport layer abstracts.

## Package responsibilities

| Package | Contents | May depend on |
|---|---|---|
| `@mibbeacon/transport` | Platform abstraction interfaces + both implementations: `UdpSocketFactory`, `TcpSocketFactory`, `CryptoProvider`, `FileStore`, `StorageAdapter` (SQLite), `SecretStore`, `HttpClient` (fetch wrapper w/ timeout+UA) | nothing internal |
| `@mibbeacon/smi` | MIB parsing: wraps node-net-snmp `ModuleStore`; lenient-parse pipeline, `ParseDiagnostic` model, module metadata extraction, OID index (name↔OID, longest-prefix match), table/INDEX/AUGMENTS decoding helpers, DISPLAY-HINT formatting | transport |
| `@mibbeacon/resolver` | Online MIB resolution: `MibSource` interface, built-in sources, custom source types, dependency-closure resolver, content validator, cache manager, OID lookup services | transport, smi |
| `@mibbeacon/core` | The engine: `EngineAPI` implementation. Session/agent-profile management, operation execution (streaming walks etc.), trap receiver/sender lifecycle, poll scheduler, DB schema + migrations + repositories, log bus | transport, smi, resolver |
| `@mibbeacon/ui` | Presentational RN components: `MibTree`, `VirtualizedResultTable`, `SnmpTableView`, `VarbindEditor`, forms, Tamagui theme/config | (react-native, tamagui only) |
| `@mibbeacon/app` | Screens, navigation, zustand stores, `EngineProvider` (injects an `EngineAPI`) | ui, core (types only!) |
| `apps/desktop` | Electron main (hosts core), preload (contextBridge), renderer entry (react-native-web + @mibbeacon/app) | all |
| `apps/mobile` | Expo app: entry point instantiates core directly with RN transport | all |

**Rule (enforced by lint, see plans README):** `@mibbeacon/app`/`@mibbeacon/ui` import only *types* from `@mibbeacon/core` — never the implementation — so the renderer bundle never pulls Node builtins.

## EngineAPI (the single seam between UI and engine)

Defined in `packages/core/src/api/engine-api.ts`. All methods async; long-running operations return an operation handle and stream events. Sketch (executor refines signatures, keeps the shape):

```ts
export interface EngineAPI {
  mibs: {
    importFiles(paths: string[] | { name: string; content: string }[], opts?: ImportOptions): Promise<ImportResult>; // ImportResult: per-module status + ParseDiagnostic[] + missing imports
    unload(moduleName: string): Promise<void>;
    listModules(): Promise<ModuleInfo[]>;
    getTree(rootOid?: string, depth?: number): Promise<MibTreeNode[]>;      // lazy tree expansion
    getNode(oidOrName: string): Promise<MibNodeDetail | null>;
    search(query: string, limit?: number): Promise<MibSearchHit[]>;          // fuzzy: name, OID, description
    translate(oidOrName: string): Promise<{ oid: string; name: string; module?: string }>;
  };
  agents: {   // agent profiles (CRUD); secrets go through SecretStore
    list(): Promise<AgentProfile[]>; save(p: AgentProfileInput): Promise<AgentProfile>; remove(id: string): Promise<void>;
    test(id: string): Promise<AgentTestResult>;  // sysDescr/sysUpTime probe with granular error
  };
  ops: {
    start(req: OperationRequest): Promise<OperationHandle>;  // kind: get|getnext|getbulk|set|walk|subtree|table-fetch; target: profile id or ad-hoc AgentSpec; streams VarbindRow events
    cancel(opId: string): Promise<void>;
  };
  traps: {
    startReceiver(cfg: TrapReceiverConfig): Promise<TrapReceiverStatus>; stopReceiver(): Promise<void>;
    status(): Promise<TrapReceiverStatus>;
    query(filter: TrapQuery): Promise<Page<TrapRecord>>;  // from SQLite
    send(req: TrapSendRequest): Promise<TrapSendResult>;
    upsertV3TrapUser(u: UsmUserInput): Promise<void>; listV3TrapUsers(): Promise<UsmUser[]>;
  };
  resolver: {
    getSettings(): Promise<ResolverSettings>; setSettings(s: ResolverSettings): Promise<void>;
    listSources(): Promise<SourceConfig[]>; saveSource(s: SourceConfigInput): Promise<SourceConfig>; removeSource(id: string): Promise<void>;
    testSource(s: SourceConfigInput): Promise<SourceTestResult>;
    resolveModules(names: string[]): Promise<ResolutionHandle>;   // streams per-module/per-source progress events
    lookupOid(oid: string): Promise<OidLookupResult>;
  };
  tools: { /* plan 08: polls, discovery, compare, portview, ping — same handle/stream pattern */ };
  events: {  // single event bus surface, IPC-friendly
    subscribe(channel: EngineEventChannel, listener: (e: EngineEvent) => void): Unsubscribe;
  };
  logs: { query(filter: LogQuery): Promise<LogEntry[]>; setLevel(l: LogLevel): Promise<void>; };
}
```

### Streaming & cancellation model
- Every long-running call (`ops.start`, `resolver.resolveModules`, poll/discovery in plan 08) returns `{ id }` immediately; progress/results/completion/error flow over `events` with the handle id.
- Event channels are coarse (`ops`, `traps`, `resolver`, `tools`, `logs`) with per-event `handleId` — this maps 1:1 onto Electron IPC channels and onto in-process EventEmitter on mobile.
- Result streams batch: emit at most every 50ms or every 50 varbinds, whichever first (keeps IPC and re-renders sane on 10k-row walks).
- `cancel` is best-effort immediate: in-flight PDU results still land, no new requests are issued.

## Electron IPC contract

- `apps/desktop/src/preload.ts` exposes `window.mibbeaconEngine: EngineAPI` via `contextBridge` + `ipcRenderer.invoke` per method (`mibbeacon:mibs:importFiles`, …) and `ipcRenderer.on('mibbeacon:event:<channel>')` for the bus. `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` for the renderer.
- A single generated helper maps the `EngineAPI` type to IPC handlers on both sides (write once in `apps/desktop/src/ipc-bridge.ts`; avoid hand-maintaining channel lists). All payloads must be structured-clone-safe (plain objects; `Buffer` → `Uint8Array` at the boundary).
- File pickers: renderer never sees raw paths on desktop; use `dialog.showOpenDialog` in main, pass contents or main-side paths into `importFiles`.

## Metro aliasing (mobile)

`apps/mobile/metro.config.js` sets `resolver.extraNodeModules` / `resolveRequest` so that inside the RN bundle:
- `dgram` → `react-native-udp`
- `net` → `react-native-tcp-socket`
- `crypto` → `react-native-quick-crypto`
- `buffer` → `buffer` (npm), `events` → `events` (npm), `stream` → `readable-stream`
- plus `global.Buffer` installed at app entry.

node-net-snmp is consumed through `@mibbeacon/transport`'s socket/crypto factories where practical, but its *internal* `require('dgram')`/`require('crypto')` calls are what the aliases exist for. **Plan 02's spike validates this end-to-end; if a specific API is missing from a shim (e.g. `socket.send` signature differences), patch via a thin wrapper module aliased in Metro rather than forking node-net-snmp.** Fork only as last resort (documented decision required).

## Error model

`packages/core/src/errors.ts` — every engine error is an `MibBeaconError { code, message, hint?, cause? }`. Codes (extend as needed):

- Transport: `TIMEOUT`, `HOST_UNREACHABLE`, `PORT_BIND_DENIED` (trap receiver on 162), `SOCKET_ERROR`
- SNMP: `REQ_ERRORSTATUS_<name>` (from PDU error-status), `REQ_TOO_BIG`, `SET_WRONG_TYPE`, `SET_NOT_WRITABLE`
- SNMPv3 (map node-net-snmp report PDUs / USM stats to these): `V3_UNKNOWN_ENGINE_ID` (auto-rediscover, don't surface unless persistent), `V3_UNKNOWN_USER`, `V3_WRONG_AUTH` (usmStatsWrongDigests → hint "auth password or protocol mismatch"), `V3_DECRYPT_FAILED` (usmStatsDecryptionErrors → hint "privacy password or protocol mismatch"), `V3_UNSUPPORTED_SECLEVEL`, `V3_NOT_IN_TIME_WINDOW` (auto-resync once)
- Parser: `MIB_PARSE_FAILED`, `MIB_MISSING_IMPORTS` (carries `missing: string[]` → feeds resolver)
- Resolver: `SOURCE_UNREACHABLE`, `SOURCE_AUTH_FAILED`, `MODULE_NOT_FOUND`, `CONTENT_VALIDATION_FAILED`
- The UI renders `hint` prominently. This is a headline UX differentiator — do not collapse distinct v3 failures into "timeout".

## Persistence (SQLite)

Single DB `mibbeacon.db` in the platform data dir (`app.getPath('userData')` / `FileSystem.documentDirectory`). Migrations = ordered `.sql` files applied at engine start (track in `schema_migrations` table). Initial schema (details per feature plan):

```
agents(id, name, host, port, version, transport, community_ref, v3_user, v3_seclevel, v3_authproto, v3_privproto, v3_auth_ref, v3_priv_ref, v3_context, created_at, last_used_at)
   -- *_ref columns are opaque handles into SecretStore, never secret material
mib_modules(name, source_path, source_kind, loaded_at, parse_status, diagnostics_json, enabled)
mib_cache(module_name, source_id, fetched_at, etag, file_path, validated)
sources(id, kind, name, enabled, priority, config_json)       -- resolver sources incl. custom
traps(id, received_at, source_ip, source_port, version, community_or_user, trap_oid, trap_name, uptime, varbinds_json, raw_pdu, read)
bookmarks(id, name, agent_id, oid, operation, params_json)
poll_series(id, name, agent_id, oid, interval_ms, mode, created_at) / poll_samples(series_id, ts, value_num, value_raw)
walk_snapshots(id, label, agent_id, taken_at, file_path)      -- saved walks for diffing
settings(key, value_json)
logs are NOT persisted to DB (ring buffer in memory, exportable to file)
```

## Concurrency & performance notes

- Mobile: the engine shares the JS thread with React. Keep per-event work small (batching above); MIB parsing of large files goes through an incremental/yielding wrapper (`await scheduler.yield()`-style chunking) so the UI stays responsive. If plan 03's corpus benchmark shows parse of a 5MB MIB blocking >200ms per chunk, move parsing into a worklet/worker (`react-native-worklets` or split parse steps) — decision recorded there.
- Desktop: engine in main process is fine for v1 (SNMP is I/O-bound); if parsing hurts, `worker_threads` later. Do not put the engine in the renderer.
- Trap receiver: desktop attempts configured port (default 162), on `EACCES` falls back to 1162 and reports `PORT_BIND_DENIED` with per-OS guidance (Linux: `setcap 'cap_net_bind_service=+ep'` on the binary or use the fallback; Windows: admin; macOS: privileged helper or fallback). Mobile always defaults 1162.

## Security notes

- SNMP credentials via `SecretStore` only (Electron `safeStorage`; mobile `expo-secure-store`). Redact secrets in logs (`community=***`).
- Renderer is fully sandboxed; only `window.mibbeaconEngine` crosses the bridge.
- Resolver fetches untrusted text: size cap (default 5MB), content validation before it ever reaches the parser, and the parser must treat input as hostile (no eval, bounded recursion — vet ModuleStore's parser behavior on adversarial input in plan 03).
- The trap receiver parses untrusted network packets — same hostility assumption; wrap decode in try/catch per packet, malformed packets recorded as raw + flagged, never crash the receiver.
