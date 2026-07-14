# 04 — Agent Profiles, Query Operations & Table View

Status: implemented (automated acceptance complete; physical Android and real-device release checks remain)

> The early query and Set slices have since been completed with encrypted agent/group
> persistence, all operation kinds, multi-varbind Set, multi-agent fan-out, snapshots,
> bookmarks, decoded PDU inspection, exports, and the virtualized editable Table View.

Depends on: 02, 03

## Objective

The core iReasoning workflow, done better: pick/enter an agent, click a node, run Get/GetNext/GetBulk/Set/Walk/subtree, watch results stream in with resolved names, and open any table as a proper index-decoded, editable Table View.

## Tasks

### T1 — Agent profiles (`packages/core` + UI)

- Implement `EngineAPI.agents.*`: CRUD on `agents` table; secret material (community, v3 auth/priv passwords) through `SecretStore` refs only.
- Profile fields: name, host (IPv4/IPv6/hostname), port (default 161), transport udp4/udp6, version, v2c community, v3 (user, security level noAuthNoPriv/authNoPriv/authPriv, auth proto MD5/SHA/SHA-224/256/384/512, priv proto DES*/AES-128/AES-256-blumenthal/AES-256-reeder, context name/engine), timeout ms, retries, getbulk non-repeaters/max-repetitions. (*DES only if the plan-02 spike found it workable on that platform; otherwise hide with an explanatory tooltip.)
- `agents.test(id)`: Get sysDescr+sysUpTime+sysObjectID; result = latency + decoded values, or granular `MibBeaconError` (the v3 code mapping from plan 01 — implement it here: map node-net-snmp v3 report PDUs/usmStats OIDs to `V3_WRONG_AUTH`/`V3_DECRYPT_FAILED`/`V3_UNKNOWN_USER`/`V3_NOT_IN_TIME_WINDOW`).
- **Agent groups**: named lists of profile ids; used by multi-agent ops (T5).
- UI: agents screen (list, add/edit form with version-dependent fields, test button with result detail incl. the hint text); quick-pick dropdown in the operations bar; "last used" ordering.

### T2 — Operations engine (`packages/core/src/ops/`)

- Implement `EngineAPI.ops.start/cancel` for: `get`, `getnext`, `getbulk`, `set`, `walk` (subtree via getnext for v1, getbulk otherwise; STOP at subtree end by OID-prefix check), `subtree-fetch` (walk constrained to selected node), `table-fetch` (walk of a table's columns — used by Table View).
- Session reuse per agent; serialize ops per session (node-net-snmp session semantics) but allow concurrent ops across agents.
- Streaming per plan 01 (≤50ms/≤50-varbind batches), cancellation, completion event with stats (varbind count, duration, PDU count).
- Varbind post-processing pipeline (in `@mibbeacon/smi` helpers): OID → name resolution (longest-prefix + instance suffix), type name, DISPLAY-HINT-formatted value, enum label (`up(1)`), plus raw value; keep both formatted and raw.
- Sanity guards: walk hard-cap (default 100k varbinds, user-raisable), endless-loop detection (non-increasing OID → `REQ_OID_NOT_INCREASING` error mentioning the misbehaving agent).

### T3 — Operations UI (the main screen)

- **Top bar**: agent picker (+ ad-hoc entry), OID field (bidirectional with tree selection; accepts name or numeric; validates), operation dropdown, Go/Stop button. `g ` prefix or a toggle switches agent picker to group mode (T5).
- **Results table** (`VirtualizedResultTable`): columns Name/OID (toggle), Value (formatted; tooltip/long-press shows raw + hex), Type, Agent (visible in group mode). Live row counter + elapsed during streaming. Row selection syncs tree + OID field. Context menu per row: Get again, Set… (if writable), copy value/OID/row, "open table" when the row belongs to a table.
- **Result tabs**: each executed operation lands in a tab (agent+op+oid title, close/pin); Enter repeats last op (new tab or replace per setting).
- **Raw PDU view**: per-operation log of request/response PDUs decoded (varbinds, error-status, v3 security params sans secrets) — a debug drawer on the result tab.
- **Save/export**: results to CSV/JSON; **save walk as snapshot** (`walk_snapshots` table + file) — the input format for plan 08's diff. Load snapshot into a read-only result tab.
- Keyboard shortcuts (desktop): Ctrl-G/N/B/S/W per operation, Ctrl-P stop, Ctrl-T table view, Enter repeat; document in a shortcuts overlay (Ctrl-/ or ?).
- Double-click/ tap behavior: scalar leaf → Get; table/entry node → Table View.

### T4 — Set support

- `VarbindEditor` component: type-aware editors — INTEGER/enums (dropdown with labels), unsigned/Counter (numeric with range validation from syntax), OCTET STRING (text / hex `0x…` toggle / DISPLAY-HINT-aware input), OID (name-or-numeric with validation), IpAddress, BITS (checkbox set `{1,3,8}`-style), TimeTicks.
- Multi-varbind Set: staging list (add varbinds from tree/results), single PDU submit, per-varbind result/error display (map SET error-status + error-index to the offending row).
- Guardrails: confirm dialog showing decoded target + old→new value (fetch current value first when possible).

### T5 — Multi-agent (group) operations

- `ops.start` accepts a group target: fan out the same operation to N agents (concurrency cap, default 5), results tagged per agent, per-agent error status, aggregate completion.
- UI: group mode shows Agent column + per-agent status chips (ok/timeout/auth-fail).

### T6 — Table View

- From a table/entry/column node or result row: fetch via `table-fetch`, decode instances using plan 03's table-info (INDEX columns incl. IMPLIED, AUGMENTS base-table resolution) → grid: rows = instances (index values decoded per index syntax: strings shown as text, IPs dotted, etc.), columns = selected columnar objects (default all; column-picker to subset — subsetting refetches only chosen columns).
- Toolbar: Refresh, **Poll** (interval auto-refresh with changed-cell flash), **Rotate** (transpose for narrow tables/mobile), Export CSV, Stop.
- **Cell Set**: editable cells for read-write columns (VarbindEditor inline/sheet), immediate feedback.
- **Row create/delete** for tables with RowStatus (or EntryStatus): create-row wizard — collect index values + required columns, submit `createAndGo` first, fall back to `createAndWait`+column-sets+`active` on inconsistentValue; delete via `destroy(6)` with confirm. Show RowStatus column with state labels. Detect the RowStatus TC via plan 03's TC resolution.
- Handle sparse tables (missing instances per column) and large tables (stream rows; virtualize; getbulk sizing).

## Acceptance criteria

1. Against the dev snmpd container: every operation works over v2c and v3 (SHA-256/AES-128) from desktop AND Android; wrong v3 priv password produces the "privacy password or protocol mismatch" hint, not a timeout.
2. Full walk of `1.3.6.1.2.1` on a real device/container streams smoothly, Stop works mid-walk, results exportable to CSV.
3. ifTable opens in Table View with decoded ifIndex rows and correct columns; poll mode shows counter changes; rotate + column subset + CSV work.
4. Cell Set on a writable object (e.g. sysContact via table-less Set, ifAdminStatus in Table View) round-trips; RowStatus create/delete exercised against a table supporting it (node-net-snmp `Agent` fixture provides one — build it as a test fixture with a RowStatus table).
5. Group operation against 3 agents (spin 3 fixture agents) shows per-agent tagged results with one agent deliberately unreachable → per-agent error chip, others complete.
6. Bookmarks: save (agent+OID+operation), list, run — round-trip works. (Small feature, lives in this phase: `bookmarks` table + a bookmarks menu.)

## Test strategy

- Unit: varbind formatting matrix (type × DISPLAY-HINT × enum), index decode (multi-part indexes, IMPLIED strings, IP+port composites), OID-not-increasing guard, RowStatus state machine (createAndGo vs createAndWait fallback), group fan-out aggregation.
- Integration (vitest, node-net-snmp `Agent` fixtures in-process): each op end-to-end incl. v3 auth failure mapping; table fetch on fixture with sparse rows.
- Manual: Android device against real hardware (whatever the user has — MikroTik/Cisco/printer), evidence in PR description.

## Out of scope

Graphs/polling history (plan 08), trap features (plan 05), Cisco-specific dashboards (post-v1).

## Deviations and remaining release evidence

- Secret-bearing profiles are retained only in the engine and renderer contracts use profile IDs;
  this is stricter than passing an expanded target through the UI.
- Automated node-net-snmp fixtures cover the operation matrix, v3 error mapping, bounded group
  fan-out with an unreachable member, sparse tables, and RowStatus create/delete. Table rendering
  has a 10,000-row virtualization regression test.
- The same shared implementation typechecks for Android, but the acceptance journey against a
  physical Android device and independent real hardware remains a release checklist item.
