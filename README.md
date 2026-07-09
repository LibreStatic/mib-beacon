# Open MIB Catalog

**An open-source, cross-platform SNMP toolkit** — explore MIBs, query live devices, send and receive traps, compare standards, and (uniquely) **auto-resolve missing MIB dependencies from the internet**.

> Status: planning phase. See [`docs/plans/`](docs/plans/) for the full implementation plan set.

## Why

Every open-source MIB explorer is abandoned (SnmpB's last release was 2019, qtmib 2014, mbrowse ~2010). The de-facto standard, iReasoning MIB Browser, is closed-source Java/Swing, caps its free tier at 10 loaded MIBs for personal use only, and paywalls basics like the trap sender, graphs, and discovery at $495–$895 per seat. Nobody — commercial or FOSS — automatically resolves missing MIB `IMPORTS` from online sources.

Open MIB Catalog aims to be the modern, maintained, genuinely free alternative.

## Feature goals (v1)

- **MIB catalog** — load/import SMIv1/SMIv2 modules with *lenient parsing* and clear, structured diagnostics for the broken vendor MIBs the real world is full of. No module caps.
- **Browse** — MIB tree with type icons, node properties (OID, syntax, access, status, description), fuzzy search across names/OIDs/descriptions.
- **Query** — Get / GetNext / GetBulk / Set / Walk / subtree against SNMP v1, v2c, and v3 (SHA-2 auth, AES-256 priv) agents, with per-agent credential memory and streaming, cancellable results.
- **Table View** — index-decoded SNMP tables with polling, rotation, CSV export, cell-level Set, and RowStatus-aware row create/delete.
- **Traps** — built-in trap/inform receiver (v1/v2c/v3) with MIB-resolved decoding, persistence, and search; trap sender with presets, pre-filled from any `NOTIFICATION-TYPE` node.
- **Online MIB resolution** — missing `IMPORTS` and unknown OIDs resolved automatically from verified online sources (the pysnmp MIB corpus, LibreNMS/netdisco/Cisco GitHub collections), plus **user-defined custom sources**: bare FTP (with/without auth), raw HTTP endpoints (pysmi-style `@mib@` URL templates), and JSON catalogs queried with a user-supplied JSONPath expression. Opt-in, cached, offline-friendly.
- **Tools** — performance graphs, watches, subnet discovery, device comparison, walk-file diffing, interface/port view, ping/traceroute.

## Platforms

One React Native codebase:

- **Desktop** — Linux, Windows, macOS via Electron + react-native-web (SNMP engine in the Node main process).
- **Mobile/tablet** — Android and iOS via Expo (dev builds; UDP/TCP/crypto through native modules), with responsive layouts from phone to 3-pane desktop.

## Repository layout

```
apps/mobile      Expo app (Android/iOS)
apps/desktop     Electron shell (Linux/Windows/macOS)
apps/server      Optional LAN server: headless engine + web UI over WebSocket
packages/core    Platform-agnostic engine: sessions, MIB store, trap store, resolver orchestration
packages/smi     MIB parsing layer (lenient mode + diagnostics)
packages/transport  UDP/TCP/FS/crypto/storage abstraction (Node vs React Native backends)
packages/resolver   Online MIB resolution: built-in + custom sources
packages/ui      Shared UI components (tree, tables, forms)
packages/app     Shared screens, navigation, state
docs/plans       Implementation plan documents (execution order inside)
```

## Development

Prerequisites: Node ≥ 20 (22+ recommended), [pnpm](https://pnpm.io) 10, and — for the
SNMP spike/tests against a real agent — Docker.

```bash
pnpm install                 # install the workspace
pnpm -r typecheck            # typecheck every package
pnpm lint
pnpm test                    # unit tests (transport + core)
```

Run a real SNMP test agent (snmpd in Docker), then the engine feasibility spike:

```bash
docker compose -f dev/snmpd/docker-compose.yml up -d --build
pnpm --filter @omc/core spike        # v2c/v3 Get, trap receive, streaming walk
```

Desktop app (Electron + react-native-web) — needs a graphical session:

```bash
pnpm dev:desktop             # opens the app window
```

Mobile app (Expo dev build) — needs the Android SDK / Xcode and a device or emulator
(Expo Go is **not** supported — the app needs native UDP/TCP/crypto modules):

```bash
pnpm --filter @omc/mobile prebuild   # generate the native project (first time)
pnpm dev:mobile                      # = expo run:android
```

Optional LAN server — run the engine on one host (on the management network) and use the
UI from any browser or phone on the LAN. The engine runs on the server; SNMP is sent from
that host. **No authentication** — intended for trusted LANs.

```bash
pnpm dev:server              # builds the web bundle + starts the server (default :8899)
# then open http://<that-host-ip>:8899 from any device on the network
```

Configure with `OMC_SERVER_PORT`, `OMC_SERVER_HOST`, `OMC_SERVER_DATA`.

See [`docs/plans/SPIKE-RESULTS.md`](docs/plans/SPIKE-RESULTS.md) for validated runtime
findings (crypto/DES support per runtime, required Electron version, etc.).

## Contributing

The project is being built plan-by-plan from [`docs/plans/`](docs/plans/). Read [`docs/plans/README.md`](docs/plans/README.md) first — it defines execution order, conventions, and the definition of done for each phase.

## License

[GPL-3.0](LICENSE). Dependencies are permissively licensed (MIT/BSD/Apache-2.0) and compatible.
