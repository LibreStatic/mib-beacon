import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIVE_MIB_SETTINGS,
  beginLiveCellWrite,
  failLiveCellWrite,
  getBooleanEnumValues,
  inferLiveMibEditor,
  markLiveCellUncertain,
  mergeLiveCellRemote,
  normalizeLiveMibSettings,
  resolveLiveMibSettings,
  succeedLiveCellWrite,
  type LiveMibCellState,
} from './live-mibs-model';

describe('live MIB settings', () => {
  it('uses safe sequential and confirmation-required defaults', () => {
    expect(DEFAULT_LIVE_MIB_SETTINGS).toMatchObject({
      scanConcurrency: 1,
      showReadOnly: false,
      refreshMode: 'adaptive',
      refreshIntervalMs: 5_000,
      writeMode: 'confirm',
      writeDebounceMs: 500,
      verifyWrites: true,
    });
  });

  it('clamps device-load settings and merges per-agent overrides', () => {
    const global = normalizeLiveMibSettings({
      scanConcurrency: 99,
      refreshIntervalMs: 100,
      writeDebounceMs: 9_999,
    });
    expect(global).toMatchObject({
      scanConcurrency: 8,
      refreshIntervalMs: 500,
      writeDebounceMs: 2_000,
    });
    expect(resolveLiveMibSettings(global, { scanConcurrency: 2, showReadOnly: true })).toMatchObject({
      scanConcurrency: 2,
      showReadOnly: true,
      refreshIntervalMs: 500,
    });
  });
});

describe('live MIB editor selection', () => {
  it('uses a switch for TruthValue and a select for other enums', () => {
    expect(
      inferLiveMibEditor({
        syntax: 'TruthValue',
        textualConventionChain: ['TruthValue', 'INTEGER'],
        enumValues: { true: 1, false: 2 },
      }),
    ).toBe('boolean');
    expect(inferLiveMibEditor({ syntax: 'INTEGER', enumValues: { up: 1, down: 2 } })).toBe(
      'select',
    );
  });

  it('derives boolean values from semantics instead of declaration order', () => {
    expect(getBooleanEnumValues({ false: 2, true: 1 })).toEqual({ off: '2', on: '1' });
    expect(getBooleanEnumValues({ disabled: 0, enabled: 7 })).toEqual({
      off: '0',
      on: '7',
    });
  });

  it('uses constrained numeric and binary editors', () => {
    expect(inferLiveMibEditor({ syntax: 'Integer32', numericRanges: [{ min: 0, max: 10 }] })).toBe(
      'number',
    );
    expect(inferLiveMibEditor({ syntax: 'OCTET STRING', sizeRanges: [{ min: 0, max: 65_535 }] })).toBe(
      'binary',
    );
  });
});

describe('live cell transaction state', () => {
  const cell = (): LiveMibCellState => ({
    confirmedValue: 'old',
    draftValue: 'new',
    phase: 'dirty',
    requestId: 0,
  });

  it('restores the last confirmed value after a rejected write', () => {
    const updating = beginLiveCellWrite(cell(), 4);
    expect(updating.phase).toBe('updating');
    expect(failLiveCellWrite(updating, 4, 'notWritable')).toEqual({
      confirmedValue: 'old',
      draftValue: 'old',
      phase: 'error-reverted',
      requestId: 4,
      error: 'notWritable',
    });
  });

  it('ignores stale success and failure responses', () => {
    const updating = beginLiveCellWrite(cell(), 5);
    expect(succeedLiveCellWrite(updating, 4, 'stale')).toBe(updating);
    expect(failLiveCellWrite(updating, 4, 'stale')).toBe(updating);
    expect(succeedLiveCellWrite(updating, 5, 'confirmed')).toMatchObject({
      confirmedValue: 'confirmed',
      draftValue: 'confirmed',
      phase: 'success',
      requestId: 5,
    });
  });

  it('restores the confirmed display while an uncertain write is reconciled', () => {
    const updating = beginLiveCellWrite(cell(), 6);
    expect(markLiveCellUncertain(updating, 6, 'Request timed out')).toEqual({
      confirmedValue: 'old',
      draftValue: 'old',
      phase: 'uncertain',
      requestId: 6,
      error: 'Request timed out',
    });
  });

  it('preserves a draft and exposes a conflict when the device changes remotely', () => {
    expect(mergeLiveCellRemote(cell(), 'remote')).toEqual({
      confirmedValue: 'old',
      draftValue: 'new',
      phase: 'conflict',
      requestId: 0,
      remoteValue: 'remote',
    });
    expect(
      mergeLiveCellRemote(
        { confirmedValue: 'old', draftValue: 'old', phase: 'fresh', requestId: 0 },
        'remote',
      ),
    ).toMatchObject({
      confirmedValue: 'remote',
      draftValue: 'remote',
      phase: 'fresh',
    });
  });
});
