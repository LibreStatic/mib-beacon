# 11 — Live MIB Data Grid

Status: implemented; vendor-hardware transfer acceptance remains ongoing

## Objective

Provide a database-style, tree-scoped workspace for exploring and editing the live values exposed
by loaded MIBs. The workspace targets one SNMP agent at a time, streams partial scan results, uses
MIB constraints to choose safe editors, and treats the device response as authoritative.

## User experience

- **Live MIBs** is a primary desktop/tablet navigation destination. Compact layouts open it from
  Browse without displacing the five focused phone destinations.
- The left pane is an independently expandable loaded-MIB tree. Its selected scalar, table, entry,
  column, or subtree defines the scan scope.
- The value pane virtualizes instance rows and shows resolved name, OID, syntax, access, update
  time, value, and cell state. Read-only rows are hidden by default and appear locked when enabled.
- Global defaults and per-saved-agent overrides live under Settings → Live MIBs.

## Settings and safety defaults

| Setting | Default | Limits / behavior |
| --- | --- | --- |
| Refresh | Adaptive, 5 seconds | Adaptive, fixed, or manual; 500 ms–5 minutes |
| Scan workers | 1 | Sequential by default; 1–8 independent sessions |
| Read-only objects | Hidden | Can be shown as locked rows |
| Write trigger | Confirm | Confirm, blur, or debounced value change |
| Change debounce | 500 ms | 0–2000 ms |
| Verify Set | Enabled | Follow successful Set with Get |
| Managed transfer workflows | Disabled | Must be explicitly enabled |
| Direct staged upload | 65,535 bytes | Configurable engine-host limit |

Every cell keeps `confirmedValue`, `draftValue`, and a monotonic request ID. Rejected writes restore
the confirmed value and keep the actionable error next to the cell. Responses from older request
IDs are ignored. A transport timeout is an uncertain outcome rather than a false rejection and is
reconciled by reading the value again.

## Architecture

`EngineAPI.liveMibs` is renderer-safe and crosses Electron IPC or LAN WebSocket unchanged:

- `settings` and `agentOverrides` persist JSON through the engine settings table.
- `scan.start/status/cancel` plans readable scalar/column tasks from the MIB tree, runs one to eight
  workers, and emits `live-mibs` batch/progress/terminal events.
- `writeCell` performs a typed Set and optionally returns the authoritative follow-up Get.
- `uploads` accepts monotonic base64 chunks into private temporary engine storage.
- `workflows` detects and runs direct-binary and timed-block adapters. Cisco Flash/Config Copy
  control workflows require managed transfers to be explicitly enabled and never imply that an
  arbitrary firmware image fits in a single SNMP Set.

Structured `numericRanges` and `sizeRanges` were added to `MibNodeDetail`; display syntax remains
human-oriented while editors consume the complete machine-readable constraints.

## File workflows

The engine distinguishes:

1. **Direct binary Set** — only for size-checked OCTET STRING/Opaque objects.
2. **Timed block stream** — ordered credential/start/block/EOF/finish Sets using explicit vendor
   configuration.
3. **Cisco transfer control** — protocol/server/name/RowStatus orchestration for Flash or Config
   Copy MIBs; an engine-hosted, cancellable TFTP reader serves the staged image only when managed
   transfers are explicitly enabled. Bind address, port, timeout, and indexed control varbinds are
   supplied by the workflow setup because Cisco object layouts vary by MIB and platform.

Temporary paths and file bytes never appear in public status objects or logs. Uploads are disposed
after completion or failure by the UI and expire from engine-private staging after 15 minutes.

## Verification

- Unit tests cover complete SMI constraints, settings normalization, editor selection, value-grid
  merging, stale-response rejection, and rollback.
- Core integration tests cover settings/overrides, chunk offsets and cleanup, adapter detection,
  writable-only streaming scans, verified writes, direct binary workflow encoding, and a real UDP
  read/ACK round trip against the managed TFTP adapter.
- App typecheck and focused tests cover stable routes, responsive navigation, settings navigation,
  and workspace state helpers.
- Browser validation passed at 390×844, 820×1180, and 1440×900 without console errors, body
  overflow, or unreachable Live MIB Settings controls.
- Remaining release evidence: real-device rejection/rollback, timed-block vendor hardware, Cisco
  transfer-control hardware, and Android file-picker behavior. No Android device,
  emulator executable, or configured AVD was available on the validation host.
