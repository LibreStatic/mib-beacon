import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { PacketTraceEvent, PacketTraceServiceStatus } from '@mibbeacon/core/client';
import { PacketBootstrapCoordinator } from './packet-bootstrap-coordinator';

const status = (retentionMiB: number): PacketTraceServiceStatus => ({
  retentionMiB,
  persistence: retentionMiB === 0 ? 'disabled' : 'active',
  persistedBytes: 0,
});
const packet = (id: string) => ({ id }) as unknown as PacketTraceEvent;

describe('PacketBootstrapCoordinator', () => {
  it('does not let bootstrap history overwrite a newer packet event or clear event', () => {
    const setHistory = vi.fn();
    const append = vi.fn();
    const clear = vi.fn();
    const coordinator = new PacketBootstrapCoordinator({
      setHistory,
      append,
      clear,
      setStatus: vi.fn(),
      clearStatus: vi.fn(),
    });
    const first = coordinator.captureHistory();
    coordinator.packet(packet('new'));
    coordinator.applyHistory(first, [packet('old')]);
    expect(setHistory).not.toHaveBeenCalled();
    expect(append).toHaveBeenCalledOnce();

    const second = coordinator.captureHistory();
    coordinator.cleared();
    coordinator.applyHistory(second, [packet('also-old')]);
    expect(setHistory).not.toHaveBeenCalled();
    expect(clear).toHaveBeenCalledOnce();
  });

  it('does not let bootstrap status overwrite a newer status event or prior engine lifetime', () => {
    const setStatus = vi.fn();
    const coordinator = new PacketBootstrapCoordinator({
      setHistory: vi.fn(),
      append: vi.fn(),
      clear: vi.fn(),
      setStatus,
      clearStatus: vi.fn(),
    });
    const oldRequest = coordinator.captureStatus();
    coordinator.status(status(64));
    coordinator.applyStatus(oldRequest, status(32));
    expect(setStatus).toHaveBeenCalledTimes(1);
    expect(setStatus).toHaveBeenLastCalledWith(status(64));

    const priorLifetime = coordinator.captureStatus();
    coordinator.dispose();
    coordinator.applyStatus(priorLifetime, status(16));
    expect(setStatus).toHaveBeenCalledTimes(1);
  });

  it('clears prior-engine status and invalidates a pending status bootstrap', () => {
    const setStatus = vi.fn();
    const clearStatus = vi.fn();
    const coordinator = new PacketBootstrapCoordinator({
      setHistory: vi.fn(),
      append: vi.fn(),
      clear: vi.fn(),
      setStatus,
      clearStatus,
    });
    const pending = coordinator.captureStatus();
    coordinator.clearStatus();
    coordinator.applyStatus(pending, status(32));
    expect(clearStatus).toHaveBeenCalledOnce();
    expect(setStatus).not.toHaveBeenCalled();
  });

  it('subscribes before independent bootstrap requests in AppRoot', () => {
    const source = readFileSync(new URL('./AppRoot.tsx', import.meta.url), 'utf8');
    const subscription = source.indexOf("engine.events.subscribe('packets'");
    const initialClear = source.indexOf('packetBootstrap.cleared()');
    const history = source.indexOf('const historyToken = packetBootstrap.captureHistory()');
    const statusRead = source.indexOf('const statusToken = packetBootstrap.captureStatus()');
    expect(subscription).toBeGreaterThan(-1);
    expect(initialClear).toBeGreaterThan(-1);
    expect(initialClear).toBeLessThan(subscription);
    expect(subscription).toBeLessThan(history);
    expect(subscription).toBeLessThan(statusRead);
    expect(source).not.toContain(
      'Promise.all([engine.packets.history(), engine.packets.status()])',
    );
    expect(source).toContain('.captureHistory()');
    expect(source).toContain('.captureStatus()');
  });
});
