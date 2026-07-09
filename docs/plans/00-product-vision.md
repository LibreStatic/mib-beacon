# 00 — Product Vision & Feature Matrix

Status: done (reference document — no code tasks)

## Mission

Open MIB Catalog is the maintained, modern, genuinely free SNMP toolkit: a tool network engineers reach for to answer "what is this OID?", "what does this device expose?", and "did that trap fire?" — on their desk and in their pocket — without license keys, module caps, or Java.

## Target users

1. **Network engineers / NOC operators** — day-to-day: identify OIDs during incidents, walk devices, verify trap delivery, check interface counters.
2. **NMS integrators** — build monitoring configs; need to explore vendor MIBs, find the right tables/indexes, test SETs.
3. **Firmware/agent developers** — test their SNMP agent implementation: walk it, exercise tables, receive its traps, compare against the standard MIB.
4. **Field technicians (mobile)** — on-site with a tablet/phone on the management VLAN; quick sysDescr/ifTable checks, trap tests during commissioning.

## Competitive landscape (research summary, 2026)

| Tool | Status | Why it loses |
|---|---|---|
| iReasoning MIB Browser | Active, proprietary | Java/Swing; free tier = personal use + 10-MIB cap; trap sender/graphs/discovery paywalled at $495–$895/seat; closed roadmap |
| SnmpB | Abandoned (last release 2019) | Crash-prone, memory leaks, no packaging pipeline, dated Qt UI |
| mbrowse / qtmib / Tkmib | Abandoned (2010–2014) | GTK2/Qt4-era, walk/get only, segfaults |
| ManageEngine MibBrowser Free | Freeware lead-gen | Unmaintained Java, no trap sender, not FOSS |
| net-snmp CLI | Active | The workhorse, but no GUI, strict parser, cryptic errors |
| LibreNMS | Active | An NMS, not an interactive browser; no ad-hoc query UI |

**Nobody — commercial or FOSS — auto-resolves missing MIB dependencies from online sources.** That plus "maintained cross-platform FOSS GUI" is the whole opportunity.

## Feature matrix vs iReasoning

Legend: ✅ v1 scope · 🔜 designed-now/built-later · ➕ differentiator (iReasoning doesn't have it)

| Category | Feature | iReasoning | OMC |
|---|---|---|---|
| MIB | SMIv1/v2 load, lenient parsing | ✅ (headline feature) | ✅ + structured diagnostics (what failed, where, what was recovered) ➕ |
| MIB | Module cap | 10 in free tier | ✅ none |
| MIB | Persistent load list, module metadata, unload | ✅ | ✅ |
| MIB | **Online dependency auto-resolution** | ❌ | ✅ ➕ (plans 06–07) |
| MIB | **Custom MIB sources (FTP/HTTP/JSON-catalog/GitHub)** | ❌ | ✅ ➕ (plan 07) |
| Browse | Tree with node-type icons, properties panel (OID/syntax/access/status/description) | ✅ | ✅ |
| Browse | Find in tree | ✅ (name) | ✅ fuzzy across name+OID+description ➕ |
| Browse | Unknown numeric OID → online lookup | ❌ | ✅ ➕ (plan 06) |
| Query | Get/GetNext/GetBulk/Set/Walk/GetSubtree | ✅ | ✅ |
| Query | SNMPv1/v2c/v3 (SHA-2 auth, AES-256 priv) | ✅ | ✅ (AES-192 unsupported by engine — accepted gap, document it) |
| Query | Per-agent credential memory, agent table | ✅ | ✅ (encrypted at rest ➕) |
| Query | Address groups (multi-agent ops) | ✅ | ✅ |
| Query | Streaming results, stop mid-operation, raw PDU view, save/export | ✅ | ✅ |
| Query | Actionable v3 error messages | ❌ (generic) | ✅ ➕ |
| Table | Table View: index-decoded rows, poll refresh, rotate, CSV export | ✅ | ✅ |
| Table | Cell Set, RowStatus row create/delete | ✅ | ✅ |
| Traps | Receiver v1/v2c/v3 + informs, decode, list/detail | ✅ (basic free) | ✅ |
| Traps | Trap persistence + search | ✅ (paid) | ✅ |
| Traps | Trap sender (v1/v2c traps + informs, presets, prefill from NOTIFICATION-TYPE) | ✅ ($495 tier) | ✅ |
| Traps | Rules/actions engine (filter → sound/exec/email/forward) | ✅ (paid) | 🔜 schema designed in plan 05, implemented post-v1 |
| Tools | Performance graphs (rate/delta, export) | ✅ (paid) | ✅ |
| Tools | Watches/polls | ✅ (paid) | ✅ (threshold *actions* 🔜) |
| Tools | Subnet discovery | ✅ (paid) | ✅ |
| Tools | Compare two devices side-by-side | ✅ (paid) | ✅ |
| Tools | **Walk-file save/load + offline diff** | partial | ✅ ➕ (plan 08) |
| Tools | Port view (interface utilization/errors) | ✅ (paid) | ✅ |
| Tools | Ping/traceroute | ✅ (paid) | ✅ desktop; ping-only mobile |
| Tools | Switch port mapper, Cisco snapshot | ✅ (paid) | 🔜 post-v1 |
| Platform | Windows/macOS/Linux | ✅ (Java) | ✅ native packages |
| Platform | **Android/iOS phone + tablet** | ❌ | ✅ ➕ |
| Platform | Dark mode, HiDPI, responsive | ❌ | ✅ ➕ |
| Export | Monitoring-config exports (Prometheus snmp_exporter generator.yml, Zabbix template) | ❌ | 🔜 post-v1 ➕ |
| Misc | Bookmarks (agent+OID+operation) | ✅ | ✅ |
| Misc | Log window with decoded packet exchange | ✅ | ✅ |
| Misc | CLI / scripting | ✅ (bolted-on .bat) | 🔜 post-v1 (engine is a reusable package, so a CLI is cheap later) |

## UX principles

1. **iReasoning's layout is right — keep its bones.** Left tree + properties panel, top address/OID/operation bar, tabbed results area. Users switching over should feel at home in minutes.
2. **1–2 clicks/taps to anything.** Double-click a scalar = Get. Right-click (long-press on touch) a table = Table View, a NOTIFICATION-TYPE = Send Trap.
3. **Keyboard-first on desktop** (shortcut parity with iReasoning where sensible: Ctrl-G/N/B/S/W for operations, Ctrl-T table view, Ctrl-F find, Ctrl-L load MIB, Enter repeats last op), **touch-first on mobile** (bottom tab navigation, swipeable detail sheets).
4. **Never block.** Long operations stream into the UI with a live counter and a Stop button.
5. **Explain, don't just fail.** Parse diagnostics, v3 auth mismatch hints, resolver per-source attribution ("IF-MIB fetched from mibs.pysnmp.com").
6. **Local-first, private by default.** No telemetry. Online resolution is opt-in with a clear first-run explanation.

## Licensing

**GPL-3.0.** Rationale: this project's moat is being *the* open alternative to a proprietary incumbent; GPL keeps distributed forks open (if anyone conveys a modified build, they must share source) while staying corporate-palatable, since Open MIB Catalog is a locally-run desktop/mobile app rather than a network service. AGPL was considered and rejected: its distinguishing network-use clause (§13) never triggers for a locally-run app, so it would add no practical give-back protection here while inviting the blanket AGPL bans many ISPs/enterprises enforce — shrinking the exact adopter/contributor pool this project wants. (Note: copyleft does **not** force an organization to publish modifications it only uses *internally* under either license — internal use isn't distribution. Contributions back are driven by fork-maintenance economics and good stewardship, not license text; invest in `CONTRIBUTING.md` and responsive review accordingly.) If a hosted/server repackaging of the engine ever becomes a real product direction, revisit AGPL for that component specifically. All runtime dependencies are MIT/BSD/Apache-2.0 (node-net-snmp is MIT) — compatible. MIB files fetched at runtime keep their original IETF/vendor copyrights and are cached as user data, not bundled.

## Naming

- Product: **Open MIB Catalog** (OMC). Package scope `@omc/*`. Binary/app id: `org.openmibcatalog.app` (adjust when an org/domain is registered).
