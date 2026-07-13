import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineAPI } from '@mibbeacon/core/client';
import { importReviewedFiles } from './actions';
import { useAppStore } from './store';

describe('reviewed file import handoff', () => {
  beforeEach(() => {
    useAppStore.setState({ importHandle: null, importStatus: null, importBusy: false, lastImport: null });
  });

  it('returns immediately after startImport accepts a handle without awaiting resolver status', async () => {
    const status = vi.fn(() => new Promise<never>(() => undefined));
    const engine = {
      mibs: { startImport: vi.fn(async () => ({ handleId: 'file-1' })) },
      resolver: { status, cancel: vi.fn() },
    } as unknown as EngineAPI;
    const result = await Promise.race([
      importReviewedFiles(engine, [{ name: 'one.mib', content: 'ONE-MIB DEFINITIONS ::= BEGIN\nEND' }], [], 'files'),
      new Promise<'timed-out'>((resolve) => setTimeout(() => resolve('timed-out'), 50)),
    ]);
    expect(result).toBe('file-1');
    expect(status).toHaveBeenCalledWith('file-1');
    expect(useAppStore.getState().importHandle).toBe('file-1');
  });

  it('returns null on start failure so the caller can keep its review open', async () => {
    const engine = {
      mibs: { startImport: vi.fn(async () => { throw new Error('bridge unavailable'); }) },
      resolver: { cancel: vi.fn() },
    } as unknown as EngineAPI;
    await expect(importReviewedFiles(engine, [{ name: 'one.mib', content: 'x' }], [], 'files')).resolves.toBeNull();
    expect(useAppStore.getState().lastImport?.errors[0]?.message).toContain('bridge unavailable');
  });
});
