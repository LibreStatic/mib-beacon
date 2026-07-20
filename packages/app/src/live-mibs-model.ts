import type { MibNodeDetail } from '@mibbeacon/core/client';

export type LiveMibRefreshMode = 'adaptive' | 'fixed' | 'manual';
export type LiveMibWriteMode = 'confirm' | 'blur' | 'change';

export interface LiveMibSettings {
  refreshMode: LiveMibRefreshMode;
  refreshIntervalMs: number;
  staleAfterMs: number;
  pauseWhenHidden: boolean;
  scanConcurrency: number;
  maxInstances: number;
  showReadOnly: boolean;
  writeMode: LiveMibWriteMode;
  writeDebounceMs: number;
  verifyWrites: boolean;
  booleanEditor: 'auto' | 'switch' | 'select';
  preferFormattedValues: boolean;
  documentAutoCollapseThreshold: number;
  managedTransfersEnabled: boolean;
  maximumUploadBytes: number;
}

export const DEFAULT_LIVE_MIB_SETTINGS: LiveMibSettings = {
  refreshMode: 'adaptive',
  refreshIntervalMs: 5_000,
  staleAfterMs: 15_000,
  pauseWhenHidden: true,
  scanConcurrency: 1,
  maxInstances: 100_000,
  showReadOnly: false,
  writeMode: 'confirm',
  writeDebounceMs: 500,
  verifyWrites: true,
  booleanEditor: 'auto',
  preferFormattedValues: true,
  documentAutoCollapseThreshold: 20,
  managedTransfersEnabled: false,
  maximumUploadBytes: 65_535,
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, Math.round(value)));

export function normalizeLiveMibSettings(
  patch: Partial<LiveMibSettings> = {},
): LiveMibSettings {
  const merged = { ...DEFAULT_LIVE_MIB_SETTINGS, ...patch };
  return {
    ...merged,
    scanConcurrency: clamp(merged.scanConcurrency, 1, 8),
    refreshIntervalMs: clamp(merged.refreshIntervalMs, 500, 300_000),
    staleAfterMs: clamp(merged.staleAfterMs, 500, 3_600_000),
    maxInstances: clamp(merged.maxInstances, 1, 1_000_000),
    writeDebounceMs: clamp(merged.writeDebounceMs, 0, 2_000),
    documentAutoCollapseThreshold: clamp(merged.documentAutoCollapseThreshold, 1, 10_000),
    maximumUploadBytes: clamp(merged.maximumUploadBytes, 1, 1_073_741_824),
  };
}

export function resolveLiveMibSettings(
  globalSettings: LiveMibSettings,
  agentOverrides?: Partial<LiveMibSettings> | null,
): LiveMibSettings {
  return normalizeLiveMibSettings({ ...globalSettings, ...(agentOverrides ?? {}) });
}

export type LiveMibEditorKind =
  | 'boolean'
  | 'select'
  | 'bits'
  | 'number'
  | 'ip'
  | 'oid'
  | 'binary'
  | 'text';

type EditorMetadata = Pick<
  MibNodeDetail,
  | 'syntax'
  | 'textualConventionChain'
  | 'enumValues'
  | 'numericRanges'
  | 'sizeRanges'
>;

export function inferLiveMibEditor(metadata: EditorMetadata): LiveMibEditorKind {
  const syntax = metadata.syntax ?? '';
  const conventions = metadata.textualConventionChain?.join(' ') ?? '';
  const combined = `${conventions} ${syntax}`;
  if (
    /TruthValue/i.test(combined) ||
    (metadata.enumValues &&
      Object.keys(metadata.enumValues).length === 2 &&
      Object.keys(metadata.enumValues).every((label) =>
        /^(?:true|false|yes|no|enabled|disabled)$/i.test(label),
      ))
  )
    return 'boolean';
  if (/^BITS\b/i.test(syntax)) return 'bits';
  if (metadata.enumValues) return 'select';
  if (/IpAddress/i.test(combined)) return 'ip';
  if (/OBJECT\s+IDENTIFIER|\bOID\b/i.test(combined)) return 'oid';
  if (/INTEGER|Integer\d*|Unsigned\d*|Counter\d*|Gauge\d*|TimeTicks/i.test(combined))
    return 'number';
  if (/OCTET\s+STRING|Opaque/i.test(combined) && metadata.sizeRanges?.some(({ max }) => max > 255))
    return 'binary';
  return 'text';
}

export function getBooleanEnumValues(
  values: Record<string, number>,
): { on: string; off: string } | null {
  const entries = Object.entries(values);
  const on = entries.find(([label]) => /^(?:true|yes|enabled|on|active)$/i.test(label));
  const off = entries.find(([label]) => /^(?:false|no|disabled|off|inactive)$/i.test(label));
  return on && off ? { on: String(on[1]), off: String(off[1]) } : null;
}

export type LiveMibCellPhase =
  | 'unqueried'
  | 'queued'
  | 'loading'
  | 'fresh'
  | 'stale'
  | 'dirty'
  | 'conflict'
  | 'awaiting-confirmation'
  | 'updating'
  | 'success'
  | 'error-reverted'
  | 'uncertain';

export interface LiveMibCellState {
  confirmedValue: string;
  draftValue: string;
  phase: LiveMibCellPhase;
  requestId: number;
  error?: string;
  remoteValue?: string;
}

export function mergeLiveCellRemote(
  cell: LiveMibCellState,
  remoteValue: string,
): LiveMibCellState {
  if (remoteValue === cell.confirmedValue) return cell;
  if (['dirty', 'awaiting-confirmation', 'updating', 'conflict'].includes(cell.phase)) {
    return { ...cell, phase: 'conflict', remoteValue };
  }
  return {
    confirmedValue: remoteValue,
    draftValue: remoteValue,
    phase: 'fresh',
    requestId: cell.requestId,
  };
}

export function beginLiveCellWrite(
  cell: LiveMibCellState,
  requestId: number,
): LiveMibCellState {
  return { ...cell, phase: 'updating', requestId, error: undefined };
}

export function succeedLiveCellWrite(
  cell: LiveMibCellState,
  requestId: number,
  confirmedValue: string,
): LiveMibCellState {
  if (requestId !== cell.requestId) return cell;
  return {
    confirmedValue,
    draftValue: confirmedValue,
    phase: 'success',
    requestId,
  };
}

export function failLiveCellWrite(
  cell: LiveMibCellState,
  requestId: number,
  error: string,
): LiveMibCellState {
  if (requestId !== cell.requestId) return cell;
  return {
    confirmedValue: cell.confirmedValue,
    draftValue: cell.confirmedValue,
    phase: 'error-reverted',
    requestId,
    error,
  };
}

export function markLiveCellUncertain(
  cell: LiveMibCellState,
  requestId: number,
  error: string,
): LiveMibCellState {
  if (requestId !== cell.requestId) return cell;
  return {
    confirmedValue: cell.confirmedValue,
    draftValue: cell.confirmedValue,
    phase: 'uncertain',
    requestId,
    error,
  };
}
