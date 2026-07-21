import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { PacketTraceServiceStatus } from '@mibbeacon/core/client';
import { PacketRetentionController } from './packet-retention-transaction';

const status = (
  retentionMiB: number,
  persistence: PacketTraceServiceStatus['persistence'] = retentionMiB === 0 ? 'disabled' : 'active',
): PacketTraceServiceStatus => ({ retentionMiB, persistence, persistedBytes: 1024 });
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe('PacketRetentionController', () => {
  it('gates editing until authoritative status arrives and validates exact integer bounds', async () => {
    const controller = new PacketRetentionController();
    controller.edit('64');
    expect(controller.readiness().phase).toBe('unloaded');
    controller.observe(status(32));
    for (const [text, valid] of [
      ['', false],
      ['-', false],
      ['1.5', false],
      [' 1', false],
      ['1 ', false],
      ['+1', false],
      ['1e2', false],
      ['-1', false],
      ['257', false],
      ['0', true],
      ['256', true],
    ] as const) {
      controller.edit(text);
      expect(controller.validation().valid).toBe(valid);
    }
  });

  it('loads from engine status and disposal suppresses a stale prior-engine load', async () => {
    let resolveOld!: (value: PacketTraceServiceStatus) => void;
    const old = new PacketRetentionController();
    const loading = old.load(() => new Promise((resolve) => (resolveOld = resolve)));
    await flush();
    old.dispose();
    resolveOld(status(96));
    await loading;
    expect(old.readiness().phase).toBe('unloaded');

    const current = new PacketRetentionController();
    await current.load(async () => status(48));
    expect(current.confirmedText()).toBe('48');
  });

  it('lets an observed current-engine event invalidate a pending stale load', async () => {
    const controller = new PacketRetentionController();
    let resolveLoad!: (value: PacketTraceServiceStatus) => void;
    const loading = controller.load(() => new Promise((resolve) => (resolveLoad = resolve)));
    await flush();
    controller.observe({ ...status(64), persistedBytes: 4096 });
    resolveLoad(status(32));
    await loading;
    expect(controller.confirmedText()).toBe('64');
    expect(controller.status()?.persistedBytes).toBe(4096);
  });

  it('deduplicates a pending load and permits retry after a load failure', async () => {
    const controller = new PacketRetentionController();
    let resolve!: (value: PacketTraceServiceStatus) => void;
    const read = vi.fn(() => new Promise<PacketTraceServiceStatus>((done) => (resolve = done)));
    const first = controller.load(read);
    const second = controller.load(read);
    expect(second).toBe(first);
    await flush();
    resolve(status(32));
    await first;
    expect(read).toHaveBeenCalledOnce();

    const failed = new PacketRetentionController();
    await expect(failed.load(async () => Promise.reject(new Error('load failed')))).rejects.toThrow(
      'load failed',
    );
    expect(failed.readiness().phase).toBe('error');
    await failed.load(async () => status(48));
    expect(failed.confirmedText()).toBe('48');
  });

  it('ignores same-object store feedback after publishing an accepted status', async () => {
    const holder: { current?: PacketRetentionController } = {};
    const accepted = vi.fn((value: PacketTraceServiceStatus) => holder.current?.observe(value));
    const controller = new PacketRetentionController(accepted);
    holder.current = controller;
    await controller.load(async () => status(32));
    expect(accepted).toHaveBeenCalledOnce();
  });

  it('stages numeric text and writes only on explicit Save', async () => {
    const controller = new PacketRetentionController();
    controller.observe(status(32));
    const write = vi.fn(async (retentionMiB: number) => status(retentionMiB));
    controller.edit('6');
    controller.edit('64');
    expect(write).not.toHaveBeenCalled();
    await controller.save({ write, read: async () => status(32) });
    expect(write).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledWith(64);
    expect(controller.get()).toMatchObject({ phase: 'success', confirmed: '64' });
  });

  it('restores confirmed text after a known rejection', async () => {
    const controller = new PacketRetentionController();
    controller.observe(status(32));
    controller.edit('64');
    await controller.save({
      write: async () => {
        throw new Error('validation rejected');
      },
      read: async () => status(32),
    });
    expect(controller.get().phase).toBe('error-reverted');
    expect(controller.displayText()).toBe('32');
  });

  it('reconciles ambiguous failure with authoritative packet status', async () => {
    const controller = new PacketRetentionController();
    controller.observe(status(32));
    controller.edit('64');
    await controller.save({
      write: async () => {
        throw new Error('network timeout');
      },
      read: async () => status(64),
    });
    expect(controller.get()).toMatchObject({ phase: 'success', confirmed: '64' });
  });

  it('surfaces a conflict when the returned authoritative retention differs', async () => {
    const controller = new PacketRetentionController();
    controller.observe(status(32));
    controller.edit('64');
    await controller.save({ write: async () => status(48), read: async () => status(48) });
    expect(controller.get()).toMatchObject({ phase: 'conflict', confirmed: '48', remote: '48' });
  });

  it('accepts current-engine status metadata without clobbering dirty or active drafts', async () => {
    const controller = new PacketRetentionController();
    controller.observe(status(32));
    controller.edit('64');
    const dirtyEvent = { ...status(48, 'degraded'), warning: 'disk offline' };
    controller.observe(dirtyEvent);
    expect(controller.get()).toMatchObject({ phase: 'dirty', confirmed: '48', draft: '64' });
    expect(controller.status()).toEqual(dirtyEvent);

    let resolveWrite!: (value: PacketTraceServiceStatus) => void;
    const saving = controller.save({
      write: () => new Promise((resolve) => (resolveWrite = resolve)),
      read: async () => status(48),
    });
    await flush();
    controller.observe({ ...status(48, 'active'), persistedBytes: 4096 });
    expect(controller.get().draft).toBe('64');
    resolveWrite(status(64));
    await saving;
    expect(controller.status()).toMatchObject({ retentionMiB: 64, persistedBytes: 1024 });
  });

  it('publishes a coherent causal write status when an event has a different retention', async () => {
    const accepted = vi.fn();
    const controller = new PacketRetentionController(accepted);
    controller.observe(status(32));
    accepted.mockClear();
    let resolveWrite!: (value: PacketTraceServiceStatus) => void;
    controller.edit('64');
    const saving = controller.save({
      write: () => new Promise((resolve) => (resolveWrite = resolve)),
      read: async () => status(32),
    });
    await flush();
    controller.observe({ ...status(32), persistedBytes: 4096 });
    resolveWrite({ ...status(64), persistedBytes: 1024 });
    await saving;
    expect(controller.get()).toMatchObject({ phase: 'success', confirmed: '64' });
    expect(controller.status()).toMatchObject({ retentionMiB: 64, persistedBytes: 1024 });
    expect(accepted).toHaveBeenLastCalledWith(
      expect.objectContaining({ retentionMiB: 64, persistedBytes: 1024 }),
    );
  });

  it('preserves newer telemetry only when it describes the causal retention', async () => {
    const accepted = vi.fn();
    const controller = new PacketRetentionController(accepted);
    controller.observe(status(32));
    accepted.mockClear();
    let resolveWrite!: (value: PacketTraceServiceStatus) => void;
    controller.edit('64');
    const saving = controller.save({
      write: () => new Promise((resolve) => (resolveWrite = resolve)),
      read: async () => status(32),
    });
    await flush();
    controller.observe({
      ...status(64, 'degraded'),
      persistedBytes: 4096,
      warning: 'disk offline',
    });
    resolveWrite(status(64));
    await saving;
    expect(controller.get()).toMatchObject({ phase: 'success', confirmed: '64' });
    expect(controller.status()).toEqual({
      retentionMiB: 64,
      persistence: 'degraded',
      persistedBytes: 4096,
      warning: 'disk offline',
    });
    expect(accepted).toHaveBeenLastCalledWith(controller.status());

    const disabling = new PacketRetentionController();
    disabling.observe(status(32));
    let resolveDisable!: (value: PacketTraceServiceStatus) => void;
    disabling.edit('0');
    const disabled = disabling.save({
      write: () => new Promise((resolve) => (resolveDisable = resolve)),
      read: async () => status(32),
    });
    await flush();
    disabling.observe({
      ...status(0, 'degraded'),
      persistedBytes: 8192,
      warning: 'old persistence warning',
    });
    resolveDisable({ ...status(0), persistedBytes: 0 });
    await disabled;
    expect(disabling.get()).toMatchObject({ phase: 'success', confirmed: '0' });
    expect(disabling.status()).toEqual({
      retentionMiB: 0,
      persistence: 'disabled',
      persistedBytes: 0,
    });
  });

  it('does not carry pre-compaction bytes across a reduced retention limit', async () => {
    const controller = new PacketRetentionController();
    controller.observe({ ...status(64), persistedBytes: 8192 });
    let resolveWrite!: (value: PacketTraceServiceStatus) => void;
    controller.edit('32');
    const saving = controller.save({
      write: () => new Promise((resolve) => (resolveWrite = resolve)),
      read: async () => status(64),
    });
    await flush();
    controller.observe({ ...status(64), persistedBytes: 12288 });
    resolveWrite({ ...status(32), persistedBytes: 512 });
    await saving;
    expect(controller.get()).toMatchObject({ phase: 'success', confirmed: '32' });
    expect(controller.status()).toEqual({
      retentionMiB: 32,
      persistence: 'active',
      persistedBytes: 512,
    });
  });

  it('serializes newer edits and double submit without stale completion winning', async () => {
    const controller = new PacketRetentionController();
    controller.observe(status(32));
    const pending: Array<(value: PacketTraceServiceStatus) => void> = [];
    const write = vi.fn(
      () => new Promise<PacketTraceServiceStatus>((resolve) => pending.push(resolve)),
    );
    const transport = { write, read: async () => status(32) };
    controller.edit('64');
    const first = controller.save(transport);
    await flush();
    controller.edit('96');
    const second = controller.save(transport);
    controller.cancel();
    expect(controller.get().activeRequest).toBeDefined();
    pending.shift()?.(status(64));
    await flush();
    expect(write).toHaveBeenCalledTimes(2);
    pending.shift()?.(status(96));
    await Promise.all([first, second]);
    expect(controller.get()).toMatchObject({ phase: 'success', confirmed: '96' });
  });

  it('does not let an older retryPersistence response overwrite a newer observed status', async () => {
    const accepted = vi.fn();
    const controller = new PacketRetentionController(accepted);
    controller.observe(status(32, 'degraded'));
    let resolveRetry!: (value: PacketTraceServiceStatus) => void;
    const retrying = controller.runStatusOperation(
      () => new Promise((resolve) => (resolveRetry = resolve)),
    );
    await flush();
    const newer = { ...status(64), warning: 'newer event' };
    controller.observe(newer);
    accepted.mockClear();
    resolveRetry(status(32, 'active'));
    await retrying;
    expect(controller.status()).toEqual(newer);
    expect(accepted).not.toHaveBeenCalled();
  });

  it('tracks retryPersistence independently and reconciles an ambiguous retry failure', async () => {
    const accepted = vi.fn();
    const controller = new PacketRetentionController(accepted);
    controller.observe(status(32, 'degraded'));
    const retrying = controller.runStatusOperation(
      async () => {
        throw new Error('network timeout');
      },
      async () => status(32, 'active'),
    );
    expect(controller.statusOperation().phase).toBe('updating');
    await retrying;
    expect(controller.statusOperation().phase).toBe('success');
    expect(controller.status()?.persistence).toBe('active');
    expect(accepted).toHaveBeenCalledWith(expect.objectContaining({ persistence: 'active' }));
  });

  it('deduplicates concurrent retryPersistence calls', async () => {
    const controller = new PacketRetentionController();
    controller.observe(status(32, 'degraded'));
    let resolve!: (value: PacketTraceServiceStatus) => void;
    const operation = vi.fn(
      () => new Promise<PacketTraceServiceStatus>((done) => (resolve = done)),
    );
    const first = controller.runStatusOperation(operation);
    const second = controller.runStatusOperation(operation);
    expect(second).toBe(first);
    resolve(status(32, 'active'));
    await first;
    expect(operation).toHaveBeenCalledOnce();
  });

  it('does not claim retry success after a newer degraded event invalidates response or readback', async () => {
    const controller = new PacketRetentionController();
    controller.observe(status(32, 'degraded'));
    let rejectRetry!: (cause: Error) => void;
    let resolveRead!: (value: PacketTraceServiceStatus) => void;
    const retrying = controller.runStatusOperation(
      () => new Promise((_resolve, reject) => (rejectRetry = reject)),
      () => new Promise((resolve) => (resolveRead = resolve)),
    );
    await flush();
    rejectRetry(new Error('network timeout'));
    await flush();
    controller.observe({ ...status(32, 'degraded'), warning: 'newer disk failure' });
    resolveRead(status(32, 'active'));
    await retrying;
    expect(controller.statusOperation()).toMatchObject({
      phase: 'error',
      error: 'newer disk failure',
    });
  });

  it('shows an accepted degraded retry result as an error with its warning', async () => {
    const controller = new PacketRetentionController();
    controller.observe(status(32, 'degraded'));
    await controller.runStatusOperation(async () => ({
      ...status(32, 'degraded'),
      warning: 'permission denied',
    }));
    expect(controller.statusOperation()).toEqual({ phase: 'error', error: 'permission denied' });
  });

  it('keeps retryPersistence uncertainty visible when readback also fails', async () => {
    const controller = new PacketRetentionController();
    controller.observe(status(32, 'degraded'));
    await controller.runStatusOperation(
      async () => {
        throw new Error('transport disconnected');
      },
      async () => {
        throw new Error('still offline');
      },
    );
    expect(controller.statusOperation()).toMatchObject({
      phase: 'uncertain',
      error: 'transport disconnected',
    });
  });

  it('cancels a dirty draft and does not duplicate a same-value save', async () => {
    const controller = new PacketRetentionController();
    controller.observe(status(32));
    controller.edit('64');
    expect(controller.canCancel()).toBe(true);
    controller.cancel();
    expect(controller.get()).toMatchObject({ phase: 'confirmed', confirmed: '32', draft: '32' });

    const write = vi.fn(async (value: number) => status(value));
    controller.edit('32');
    await Promise.all([
      controller.save({ write, read: async () => status(32) }),
      controller.save({ write, read: async () => status(32) }),
    ]);
    expect(write).toHaveBeenCalledOnce();
  });

  it('keeps a queued newer edit after rejection and resumes it after acknowledgement', async () => {
    const controller = new PacketRetentionController();
    controller.observe(status(32));
    let rejectFirst!: (cause: Error) => void;
    const write = vi
      .fn<(value: number) => Promise<PacketTraceServiceStatus>>()
      .mockImplementationOnce(() => new Promise((_resolve, reject) => (rejectFirst = reject)))
      .mockImplementationOnce(async (value) => status(value));
    const transport = { write, read: async () => status(32) };
    controller.edit('64');
    const first = controller.save(transport);
    await flush();
    controller.edit('96');
    const second = controller.save(transport);
    rejectFirst(new Error('rejected'));
    await Promise.all([first, second]);
    expect(controller.get()).toMatchObject({ phase: 'error-reverted', draft: '96' });
    expect(controller.displayText()).toBe('32');
    expect(controller.get().queuedRequest?.submitted).toBe('96');
    await controller.acknowledgeAndResume();
    expect(write).toHaveBeenCalledTimes(2);
    expect(controller.get()).toMatchObject({ phase: 'success', confirmed: '96' });
  });

  it('preserves an invalid newer draft when an active write succeeds', async () => {
    const controller = new PacketRetentionController();
    controller.observe(status(32));
    let resolveWrite!: (value: PacketTraceServiceStatus) => void;
    controller.edit('64');
    const saving = controller.save({
      write: () => new Promise((resolve) => (resolveWrite = resolve)),
      read: async () => status(32),
    });
    await flush();
    controller.edit('invalid');
    resolveWrite(status(64));
    await saving;
    expect(controller.get()).toMatchObject({ phase: 'dirty', confirmed: '64', draft: 'invalid' });
    expect(controller.validation().valid).toBe(false);
  });

  it('reports ambiguous conflicts and lets manual reconciliation supersede a hung readback', async () => {
    const conflict = new PacketRetentionController();
    conflict.observe(status(32));
    conflict.edit('64');
    await conflict.save({
      write: async () => Promise.reject(new Error('network timeout')),
      read: async () => status(48),
    });
    expect(conflict.get()).toMatchObject({ phase: 'conflict', confirmed: '48' });

    const unreadable = new PacketRetentionController();
    unreadable.observe(status(32));
    unreadable.edit('64');
    await unreadable.save({
      write: async () => Promise.reject(new Error('network timeout')),
      read: async () => Promise.reject(new Error('still offline')),
    });
    expect(unreadable.get()).toMatchObject({ phase: 'uncertain', confirmed: '32' });

    const controller = new PacketRetentionController();
    controller.observe(status(32));
    let resolveOldRead!: (value: PacketTraceServiceStatus) => void;
    controller.edit('64');
    const saving = controller.save({
      write: async () => Promise.reject(new Error('network timeout')),
      read: () => new Promise((resolve) => (resolveOldRead = resolve)),
    });
    await flush();
    await controller.reconcile(async () => status(64));
    expect(controller.get()).toMatchObject({ phase: 'success', confirmed: '64' });
    resolveOldRead(status(32));
    await saving;
    expect(controller.get()).toMatchObject({ phase: 'success', confirmed: '64' });
  });

  it('uses a newer event instead of a stale automatic ambiguous readback', async () => {
    const controller = new PacketRetentionController();
    controller.observe(status(32));
    let resolveRead!: (value: PacketTraceServiceStatus) => void;
    controller.edit('48');
    const saving = controller.save({
      write: async () => Promise.reject(new Error('network timeout')),
      read: () => new Promise((resolve) => (resolveRead = resolve)),
    });
    await flush();
    controller.observe({ ...status(64), persistedBytes: 4096 });
    resolveRead(status(32));
    await saving;
    expect(controller.get()).toMatchObject({ phase: 'conflict', confirmed: '64', remote: '64' });
    expect(controller.status()).toMatchObject({ retentionMiB: 64, persistedBytes: 4096 });
  });

  it('uses a newer event instead of a stale manual reconciliation readback', async () => {
    const controller = new PacketRetentionController();
    controller.observe(status(32));
    controller.edit('48');
    await controller.save({
      write: async () => Promise.reject(new Error('network timeout')),
      read: async () => Promise.reject(new Error('still offline')),
    });
    let resolveRead!: (value: PacketTraceServiceStatus) => void;
    const reconciling = controller.reconcile(
      () => new Promise((resolve) => (resolveRead = resolve)),
    );
    await flush();
    controller.observe({ ...status(64), persistedBytes: 4096 });
    resolveRead(status(32));
    await reconciling;
    expect(controller.get()).toMatchObject({ phase: 'conflict', confirmed: '64', remote: '64' });
    expect(controller.status()).toMatchObject({ retentionMiB: 64, persistedBytes: 4096 });
  });

  it('suppresses completion after disposal during write, reconcile, and retry', async () => {
    const accepted = vi.fn();
    const writing = new PacketRetentionController(accepted);
    writing.observe(status(32));
    accepted.mockClear();
    let resolveWrite!: (value: PacketTraceServiceStatus) => void;
    writing.edit('64');
    const save = writing.save({
      write: () => new Promise((resolve) => (resolveWrite = resolve)),
      read: async () => status(32),
    });
    await flush();
    writing.dispose();
    resolveWrite(status(64));
    await save;
    expect(accepted).not.toHaveBeenCalled();

    const reconciling = new PacketRetentionController(accepted);
    reconciling.observe(status(32));
    accepted.mockClear();
    let resolveRead!: (value: PacketTraceServiceStatus) => void;
    reconciling.edit('64');
    const uncertain = reconciling.save({
      write: async () => Promise.reject(new Error('network timeout')),
      read: () => new Promise((resolve) => (resolveRead = resolve)),
    });
    await flush();
    reconciling.dispose();
    resolveRead(status(64));
    await uncertain;
    expect(accepted).not.toHaveBeenCalled();

    const retrying = new PacketRetentionController(accepted);
    retrying.observe(status(32, 'degraded'));
    accepted.mockClear();
    let resolveRetry!: (value: PacketTraceServiceStatus) => void;
    const retry = retrying.runStatusOperation(
      () => new Promise((resolve) => (resolveRetry = resolve)),
    );
    retrying.dispose();
    resolveRetry(status(32, 'active'));
    await retry;
    expect(accepted).not.toHaveBeenCalled();
  });

  it('wires Settings to a per-engine controller with staged and recovery actions', () => {
    const source = readFileSync(new URL('./screens/SettingsScreen.tsx', import.meta.url), 'utf8');
    const section = source
      .split('<SectionTitle>Packet capture storage</SectionTitle>')[1]
      ?.split('<SectionTitle>Recent resolver activity</SectionTitle>')[0];
    expect(source).toContain('new PacketRetentionController(');
    expect(source).toContain('packetRetentionController.dispose()');
    expect(source).not.toContain('const [packetRetention, setPacketRetention]');
    expect(section).toContain('title="Save limit"');
    expect(section).toContain('title="Cancel / revert"');
    expect(section).toContain('title="Retry"');
    expect(section).toContain('title="Acknowledge"');
    expect(section).toContain('title="Check remote value"');
    expect(section).toContain('packetRetentionStatusText');
    expect(section).toContain('runStatusOperation');
    expect(section).toContain('title="Retry loading"');
    expect(source).not.toContain('const packetStatus = useAppStore((s) => s.packetStatus)');
    expect(source).toContain("packetRetentionLifetime.engine.events.subscribe(\n      'packets'");
    expect(source).toContain("event.kind === 'status' || event.kind === 'persistence-warning'");
    expect(source).toContain('packetRetentionController.observe(');
    expect(source).toContain('unsubscribePackets()');
    expect(source).not.toContain('packetRetentionController.status() ?? packetStatus');
  });
});
