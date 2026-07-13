# 05 — Trap Receiver & Sender

Status: in-progress (receiver + sender slices landed early)
Depends on: 02, 03

> **Landed early:** Receive/Send workspace with v1/v2c/v3 traps, v2c/v3 informs,
> typed multi-varbind payloads, NOTIFICATION-TYPE prefill, acknowledgement/error
> feedback, and session replay history. Persistence, filters, presets, and rules remain.

## Objective

A trap receiver that's actually pleasant during commissioning ("did the device send the trap?") — live list, MIB-resolved decoding, persistent + searchable — and a trap sender for testing NMS pipelines. Both free; iReasoning charges $495+ for the sender and trap persistence.

## Tasks

### T1 — Receiver engine (`packages/core/src/traps/`)
- Wrap node-net-snmp `Receiver` (handles v1 Trap, v2c Trap, Inform — auto-acks informs): implement `EngineAPI.traps.startReceiver/stopReceiver/status`.
- Config: port (default per platform: desktop 162→fallback 1162 with `PORT_BIND_DENIED` guidance per plan 01; mobile 1162), transport udp4+udp6 (bind both when available), v2c community acceptance mode (accept-all vs allowlist), disable-authorization toggle for lab use.
- **v3 trap users**: `traps.upsertV3TrapUser/listV3TrapUsers` — USM credentials for expected trap senders (Receiver requires them to decode v3); stored like agent secrets (SecretStore refs), UI in T4.
- Decode pipeline per received notification: extract version, source ip/port, community-or-user, sysUpTime, snmpTrapOID (or v1 enterprise+generic/specific → RFC 2576 mapping to v2 form), varbinds → resolve names/values through `@mibbeacon/smi` (same post-processing as plan 04 T2); resolve trap OID to its NOTIFICATION-TYPE node → attach trap name + DESCRIPTION + expected-objects list (flag missing/extra varbinds vs the OBJECTS clause — nice diagnostic no one else does).
- Malformed packets: never crash; store raw with `parse_error` flag.
- Persist everything to `traps` table (schema per plan 01, incl. raw PDU bytes for re-inspection); ring-buffer cap (default 50k rows, oldest pruned; setting).
- Emit `trap-received` events on the bus (drives live UI + future rules engine).

### T2 — Receiver UI
- **Trap console screen**: master list (time, source, trap name or OID, version, unread dot) newest-first, live-appending when receiver on; detail pane/sheet: full decode — trap DESCRIPTION from MIB, varbind table (name/value/type, formatted+raw), source info, raw PDU hex view; mark-read; copy/export (single trap as JSON/text, filtered set as CSV/JSON).
- Start/Stop toggle with status chip (port, counts, drops); port-permission error surfaces the per-OS guidance text.
- **Filters/search** (over persisted store, not just live): time range, source IP/prefix, trap OID/name substring, version, free-text over varbind values. Saved filter chips.
- Badge count of unread traps on the app tab/nav icon.

### T3 — Sender engine + UI
- Engine: `traps.send` — v1 trap (enterprise, agent-addr, generic/specific, uptime), v2c trap and **inform** (waits for ack → result reports acked/timeout) via node-net-snmp session `.trap()/.inform()`. Arbitrary varbind list (VarbindEditor from plan 04 for typed values). v3 trap send: include if node-net-snmp session supports it cleanly; otherwise document as post-v1 gap. Target: host/port (default 162), any configured agent profile as convenience for target+creds.
- **Prefill from MIB**: context action "Send trap…" on any NOTIFICATION-TYPE (and v1 TRAP-TYPE) node → form pre-populated with trap OID and one varbind row per OBJECTS-clause member (correct types, empty values).
- **Presets**: save/load named trap-send configurations (`bookmarks` table with kind=trap or its own table); "send again" from any received trap (loop-back testing: re-send what you received, edited).
- UI: sender screen with version selector (fields adapt), varbind list editor, send + result feedback; history of sent traps (session-scoped list is enough).

### T4 — Rules engine (DESIGN ONLY — schema + stub)
Post-v1 feature, designed now so the trap store schema doesn't need migration later:
- `trap_rules(id, name, enabled, priority, condition_json, actions_json)`; condition: trap-OID glob, source-IP prefix list, varbind substring matches; actions (post-v1): notify (OS notification — desktop trivial, mobile local notification), play sound, exec command (desktop only), forward trap to another host, mark severity/color.
- v1 implements ONLY: severity/color tagging + OS notification action (both cheap and high-value); the rest of the action set is stubbed with types + disabled UI.
- Rule evaluation hook in the T1 pipeline (evaluate on receive, attach matched-rule ids to the stored trap).

## Acceptance criteria
1. `snmptrap` CLI (v1, v2c, inform) from another machine → all appear live on desktop AND Android, informs acked, decoded with names once the relevant MIB is loaded; same trap OID without the MIB shows numeric + "unknown — resolve?" affordance (wired to resolver in plan 06).
2. v3 trap from `snmptrap` with configured USM user decodes; with unknown user → visible "undecodable v3 notification from <ip>" entry (not silence).
3. Receiver on desktop: port 162 works after setcap (document exact command in-app), fallback path to 1162 works without it.
4. 10k traps in store: list stays snappy (virtualized), search over varbind text returns in <500ms desktop.
5. Sender: v2c trap + inform (with ack result) sent to the app's own receiver on another device/instance round-trips correctly, including a NOTIFICATION-TYPE-prefilled linkDown with its OBJECTS varbinds.
6. Traps survive app restart; ring-buffer pruning verified.
7. Severity-tagging rule + OS notification action works on desktop.

## Test strategy
- Unit: v1→v2 trap OID mapping (RFC 2576 cases: standard generics + enterprise-specific), OBJECTS-clause conformance flagging, rule condition matcher (globs, prefixes), ring-buffer pruning.
- Integration: node-net-snmp session→Receiver in-process loop for v1/v2c/inform/v3 incl. wrong-user negative; malformed-packet fixture (raw UDP garbage to the port) → parse_error record, receiver alive.
- Manual: cross-device round-trip (desktop⇄Android), snmptrapd interop check (our sender → net-snmp snmptrapd logs it).

## Out of scope
Full rules actions (email/exec/forward — post-v1), trap forwarding, running receiver as headless service (post-v1; architecture already permits since engine is a package), background receive on mobile while app is closed (document platform limits: Android foreground service is a post-v1 investigation, iOS realistically foreground-only).
