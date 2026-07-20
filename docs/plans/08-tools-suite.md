# 08 — Tools Suite: Graphs, Watches, Discovery, Compare, Port View, Ping

Status: implemented (automated acceptance complete; platform/manual release checks remain)
Depends on: 04

## Objective

The "everything else iReasoning paywalls" phase: performance graphing, watches/polls, subnet discovery, device/walk comparison, interface port view, ping/traceroute. Each tool is a separate screen reachable from a Tools section; each reuses the ops engine (plan 04) and streams via the standard handle/event pattern.

## Tasks

### T1 — Poll scheduler (`packages/core/src/tools/poller.ts`)

Foundation for graphs, watches, and port view:

- `poll_series`/`poll_samples` tables (plan 01 schema). A series = agent + OID(-instance) + interval + mode (`raw` | `delta` | `rate-per-sec` — delta/rate computed from consecutive samples with counter-wrap handling for Counter32/64).
- Scheduler: per-series timers, batches OIDs of the same agent+interval into single GetBulk/Get PDUs, backs off on repeated timeouts (marks series degraded), emits `sample` events.
- Retention: per-series cap (default 10k samples) + global vacuum. Runs only while app is open (v1; headless mode is post-v1).
- Export series as CSV.

### T2 — Performance graphs

- Create graph from: any numeric result row (context: "Graph this"), any Table View cell/column, or manually. Multi-series charts (≤8 series), raw/delta/rate toggle per series, interval config, pause/resume.
- Chart rendering: `react-native-svg`-based (victory-native or lightweight custom line chart — pick during implementation for bundle size + web compat; must work on RN and react-native-web). Requirements: time x-axis, autoscaling y, hover/tap tooltip with value+timestamp, legend with series toggle, dark-mode aware, export PNG (desktop; via canvas/svg serialization) + CSV.
- Live + historical: chart reads persisted samples so reopening a graph shows history.

### T3 — Watches

- Watch = named poll series with display emphasis: current value, sparkline, min/max/avg, last-change. Watches screen = grid/list of watch cards.
- Threshold field per watch (simple compare: > < == !=, against raw or rate value): breaching flips card state + fires OS notification (reuse plan 05 notification plumbing). (Full action set — email/exec — stays post-v1 with trap rules.)

### T4 — Subnet discovery

- Input: CIDR or range + credential set(s) to try (selected agent-profile templates or ad-hoc v2c community list).
- Engine: bounded-concurrency sweep (default 32): probe = SNMP Get sysDescr/sysObjectID/sysUpTime/sysName with short timeout (SNMP-first — works where ICMP is filtered and needs no privileges; optional ICMP pre-ping toggle on desktop to speed up dead ranges).
- Results table (streaming): IP, responded-with (version/cred label), sysName, sysDescr excerpt, latency; actions per row: save as agent profile, open in query screen.
- Mobile note: same code path works (UDP only); document battery/network caveats for large ranges; cap mobile default range size (/24) with override.

### T5 — Compare devices + walk diff

- **Live compare**: pick 2 agents + a subtree OID → parallel subtree walks → aligned table: OID/name | value A | value B, rows colored (equal / different / only-A / only-B), filter to differences, export CSV. Index-aware alignment: align by OID; for tables, optionally align by index tuple.
- **Walk diff (offline)**: pick 2 saved walk snapshots (plan 04 T3's save-walk feature; also accept an imported `snmpwalk -On` text file — write a small parser for net-snmp's numeric output format) → same diff UI. This covers "what changed after the firmware upgrade?" — a real gap in FOSS tooling.
- Reuse one `DiffView` component for both.

### T6 — Port view

- For a selected agent: fetch ifTable/ifXTable (+ poll ifHCInOctets/ifHCOutOctets/ifInErrors/ifOutErrors via T1 at a chosen interval) → per-port cards/rows: name/alias, admin/oper status (colored), speed, in/out utilization % (computed vs ifSpeed/ifHighSpeed, counter-wrap-safe), error rate; sortable, filter by status; tap → detail with mini-graphs (reuse T2 series).
- Utilization math must handle: ifSpeed=0 (unknown — show absolute bps), HC vs non-HC fallback, 32-bit wrap on non-HC.

### T7 — Ping & traceroute (desktop-first)

- Desktop: spawn system binaries (`ping`, `traceroute`/`tracert`) with parsed streaming output (avoids raw-socket privileges); cross-platform arg/output handling for Linux/macOS/Windows.
- Mobile: ping via a maintained RN ICMP module if a solid one exists at implementation time (evaluate `react-native-ping`); otherwise ship "SNMP probe + TCP connect-time" as the reachability tool on mobile and mark ICMP ping desktop-only. Traceroute: desktop-only in v1.
- UI: simple tool screen (target, count/interval, live output list, stats summary).

## Implementation record (2026-07-13)

- **T1:** migration-backed poll series/samples/watches/charts, grouped single-Get polling,
  persisted exponential backoff/degraded state, non-overlapping scheduler groups, 10k default
  per-series retention, 250k global vacuum, wrap-safe Counter32/64 math, and CSV export are
  implemented in `packages/core/src/tools/`.
- **T2:** the app uses a lightweight custom `react-native-svg` chart rather than Victory to keep
  the cross-platform dependency surface small. It supports up to eight series, persisted history,
  time/value axes, tap/hover-nearest tooltips, legend toggles, theme colors, PNG sharing/download,
  and per-series CSV.
- **Pattern Tracer extension:** Tools graphs now support active fixed-cadence traces and passive
  historical annotations. Trace sessions/events are stored separately from poll samples, preserving
  delta/rate calculations while adding configurable-color timestamp markers and measured latency
  overlays. CSV export retains sample context plus a complete trace-event section.
- **T3:** persisted watch cards show current/min/max/average/last-change values and sparklines.
  Raw or derived thresholds emit a transition-only `watch-alert`; the app maps that event to the
  same host Notification API used by trap rules.
- **T4:** bounded/cancellable SNMP discovery accepts saved profiles and write-only ad-hoc
  communities, attributes the successful credential without emitting its secret, caps mobile at
  254 hosts unless explicitly overridden, supports optional fail-open desktop ICMP pre-ping, and
  can save a result or open Query. A three-agent localhost UDP fixture proves streaming and
  attribution with distinct credentials.
- **T5:** live walks, saved snapshots, and imported numeric `snmpwalk -On` text share one
  OID-aligned diff model and UI, with difference filtering, names when the catalog resolves them,
  CSV sharing, streaming, and immediate cancellation. The UDP fixture proves a seeded live
  difference.
- **T6:** ifTable/ifXTable inspection prefers HC counters, falls back to Counter32, handles unknown
  speed, decorates rates/utilization/errors from persisted monitor series, and exposes status
  filtering, sorting, admin/oper state, expandable sparklines, and graph actions. An in-process
  node-net-snmp ifTable/ifXTable UDP fixture proves exact HC rate/utilization/error math end to end.
- **T7 decision:** no React Native ICMP module was added. Mobile ships the SNMP discovery path and
  explicitly reports ICMP/traceroute as desktop-only. Desktop uses shell-free fixed commands with
  Linux/macOS/Windows argument builders, Unix interval control, Windows native cadence, parsed
  Unix/Windows ping summaries, and Unix `tracepath` fallback. Actual Linux `ping` and `tracepath`
  integration tests pass on the current host.
- All long-running discovery/compare/port/reachability handles use the standard tools event channel;
  cancellation emits an immediate idempotent terminal event while transport cleanup finishes.

### Remaining release-time evidence

- [x] Observe packaged desktop threshold notification delivery. The Wayland Flatpak audit creates
      an encrypted saved agent, samples `sysUpTime`, breaches `Audit watch`, and retains the exact
      `org.freedesktop.Notifications.Notify` call for `Watch threshold: Audit watch` from D-Bus.
- [ ] Run the discovery/tools flow on a physical Android phone or tablet.
- [ ] Sanity-check port names/status/rates against a separately measured physical device.
- [ ] Run ping/traceroute command fixtures on macOS and Windows hosts.
- [x] Visually inspect the packaged desktop dark-theme chart, exercise its tooltip, and validate
      the downloaded PNG signature, byte length, filename, and rendered theme background. Retained
      evidence is `docs/audits/flatpak-interactive-chart.png` plus
      `docs/audits/flatpak-interactive-chart-export.png`.
- [ ] Inspect chart interaction and PNG sharing on a physical Android build.

These are platform/manual acceptance records, not missing engine or UI implementations.

## Acceptance criteria

1. Graph an ifHCInOctets rate on a real/fixture device: correct bps numbers (validated against a known traffic generator or manual math), survives counter wrap fixture, history persists across restart.
2. Watch with threshold fires OS notification on breach (fixture agent makes value controllable).
3. Discovery of a /24 with 3 fixture agents (different creds) finds all 3 with correct cred attribution, streams progressively, cancellable; runs on Android.
4. Live compare of two fixture agents highlights a seeded difference; walk diff of two snapshots (and of an imported `snmpwalk -On` file) shows added/removed/changed correctly.
5. Port view shows sane utilization on a real device; ifSpeed=0 and non-HC fallback fixtures render correctly.
6. Ping/traceroute stream output on Linux desktop; mobile behavior implemented per the decision taken, documented here.
7. All tools respect cancel + streaming conventions; no tool blocks another (scheduler fairness sanity check).

## Test strategy

- Unit: rate/delta with wrap (32+64-bit), utilization math matrix, `snmpwalk -On` parser, diff alignment (incl. index-tuple mode), CIDR expansion + concurrency bounds.
- Integration: poller against fixture agent with scripted counter progression; discovery against 3 in-process fixture agents; compare/diff end-to-end.
- Manual: real-device port view + graph sanity, cross-platform ping arg handling.

## Out of scope

Switch port mapper + Cisco device snapshot (post-v1), monitoring-config exports (Prometheus/Zabbix — post-v1 ➕ candidate), headless/scheduled polling with app closed, alert actions beyond OS notification.
