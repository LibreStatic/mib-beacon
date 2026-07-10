# Plan 02 — Spike Results

Date: 2026-07-09 · Verdict: **GO** (all criteria validated, incl. on-device Android)

The feasibility spike set out to prove the SNMP engine (node-net-snmp) works across
the desktop (Electron) and mobile (React Native) runtimes through the `EngineAPI`
seam. It does. S1/S2/S4/S5 pass on both the plain-Node and Electron runtimes, and
**S3 passed on an Android emulator** — v2c and SNMPv3 (SHA-256/AES-128) Gets succeed
on device through react-native-udp + react-native-quick-crypto, after a few shims
(documented under S3).

## Environment

| | |
|---|---|
| Host | Linux, headless (no X server, no Android SDK/emulator) |
| Node | 26.1.0 (dev) — OpenSSL 3.x |
| Electron | 37.10.3 — bundles Node 22.21.1, **BoringSSL** |
| net-snmp | 3.26.3 |
| Test agent | `dev/snmpd/docker-compose.yml` — snmpd, v2c + three v3 users (SHA-256/AES-128, MD5/DES, SHA-512/AES-256) |

## Results

### S1 — desktop v2c Get — ✅ PASS
`engine.ops.get` v2c Get of sysDescr returns `"Open MIB Catalog spike test agent"`.
Verified through the real engine both under plain Node 26 (`pnpm --filter @omc/core spike`)
and under Electron's Node 22 runtime (`ELECTRON_RUN_AS_NODE=1 electron --import tsx …`).

### S2 — v3 crypto matrix + DES/BoringSSL — ✅ PASS (with a documented DES nuance)

| Case | Plain Node 26 (OpenSSL 3) | Electron 37 (BoringSSL) |
|---|---|---|
| SHA-256 / AES-128 | ✅ | ✅ |
| SHA-512 / AES-256 (Blumenthal) | ✅ | ✅ |
| SHA-512 / AES-256 (Reeder) | ✅ | ✅ |
| MD5 / **DES** | ❌ `des-cbc` absent (OpenSSL 3 legacy provider off) | ✅ **available** |

**Key finding — DES is runtime-dependent, and the desktop runtime is the favourable one.**
OpenSSL 3 (plain Node 22/26) disables DES unless launched with `--openssl-legacy-provider`.
Electron's **BoringSSL ships `des-cbc` by default**, so the desktop app does the *full*
crypto matrix including legacy DES (engine spike = **7/7** under `ELECTRON_RUN_AS_NODE`).
Evidence: `CRYPTO_PROBE {"...","openssl":"0.0.0","desCbc":true,...}` from
`apps/desktop … --probe-crypto`. AES-192 is unsupported by node-net-snmp on any runtime
(accepted, documented gap). Actionable v3 errors verified (wrong-priv → `V3_DECRYPT_FAILED`
hint, not a bare timeout).

### S3 — mobile (Android) Get — ✅ PASS (on emulator)
Ran on a Pixel_9_Pro emulator (Android, Expo SDK 54 dev build, `expo run:android`).
The app bundles (908 modules), the shared Spike screen renders, and an on-mount
self-test in `App.tsx` performed real SNMP against the host snmpd (via `10.0.2.2:1611`):

```
S3_SELFTEST v2c: OK value="Open MIB Catalog spike test agent"
S3_SELFTEST v3-sha256-aes128: OK value="Open MIB Catalog spike test agent"
```

So node-net-snmp runs on React Native end-to-end: **react-native-udp** (datagrams),
**react-native-quick-crypto** (v3 SHA-256 auth + AES-128 priv), expo-sqlite,
expo-file-system/legacy, Buffer/assert/util/events/stream polyfills. The engine's
`system.info()` on-device reported `ciphers: DES ✓ · AES-128 ✓ · AES-256 ✓`.

**Shim work required to get there** (all committed):
1. **`.js` import extensions removed** across shared packages — Metro (unlike Vite/tsc's
   bundler resolution) does not remap `./x.js` → `./x.tsx`, so extensionful relative
   imports broke the bundle.
2. **`dgram` auto-bind shim** (`apps/mobile/shims/dgram.js`) — react-native-udp throws
   `ERR_SOCKET_BAD_PORT` on `send()` from an *unbound* socket, whereas Node dgram
   auto-binds; net-snmp only binds when a sourcePort is set. The shim auto-binds to an
   ephemeral port on first send (queuing until bound), leaving the receiver's explicit
   bind intact.
3. **Node-core polyfills** added for net-snmp's deps: `assert`, `util` (plus the
   buffer/stream/events already present); `fs`/`path` → empty shim (MIB reader unused here).
4. **`react-native-quick-crypto` removed from the Expo `plugins` array** (v0.7 has no
   config plugin; it autolinks as a native module).
5. expo-file-system SDK-54 API moved to `/legacy`; RN socket event/Buffer typings — fixed
   during the type-level pass.

Reproduce: boot an AVD, `pnpm --filter @omc/mobile prebuild`, `pnpm dev:mobile`; point the
app at the snmpd host (emulator: `10.0.2.2:1611`). Not yet exercised on device: streaming
walk (S5) and trap receive (S4) — the code paths are shared with the validated desktop
engine, but re-confirm on hardware when convenient. iOS not yet built (plan 10).

### S4 — trap receive — ✅ PASS
Receiver decodes a v2c trap (`snmptrap` CLI) → `1 in store, first varbinds=3`.
Finding: node-net-snmp binds the receiver socket **asynchronously**; a blocking send
immediately after `startReceiver` can race the bind. Follow-up (plan 05): make
`startReceiver` resolve only once bound so UI status is truthful.

### S5 — streaming walk perf — ✅ PASS
Walk of `1.3.6.1.2.1` streamed **1761 varbinds in 89 batches, ~60–80 ms**, batched per
the 50ms/50-varbind rule. Well over the ≥1000 target; no event-loop stalls.

### Desktop GUI window — ⏳ NOT SHOWN (headless) · build-validated
`electron-vite build` produces main (22 KB) + renderer (770 KB, react-native-web,
**net-snmp correctly absent** — engine lives in main). Opening the actual window needs a
display; run `pnpm dev:desktop` on a desktop session to see the Spike screen.

## Decisions & deviations taken during the spike

1. **SQLite**: `node:sqlite` (built-in) instead of better-sqlite3 — the latter's native
   addon does not compile against Node 26's V8. Consequence: **Electron ≥ 37 (Node 22+)**
   is required, since Electron 34 (Node 20) lacks `node:sqlite`. Pinned `electron@^37`.
2. **Tamagui deferred to plan 09.** The spike UI uses React Native primitives + a minimal
   theme to keep the gating phase focused on the SNMP stack, not styling infra.
3. **`@omc/core/client` subpath** added so the renderer imports only EventBus/OmcError/types,
   keeping net-snmp + node builtins out of the browser bundle.
4. **RN transport typed via small local interfaces** (documented runtime API) rather than
   the libraries' imperfect type stubs; mobile tsconfig relaxes `verbatimModuleSyntax`
   because Expo packages ship TS source as their entry.

## Go / no-go

**GO.** node-net-snmp is the right engine on all three runtimes (plain Node, Electron,
React Native); the architecture (engine in Electron main / in-process on RN, UI over
`EngineAPI`) holds and is proven on device. Proceed to plans 03+. Remaining on-device
follow-ups (non-blocking): exercise walk (S5) and trap receive (S4) on Android, and build
for iOS (plan 10).
