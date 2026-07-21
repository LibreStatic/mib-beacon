import { describe, expect, it, vi } from 'vitest';
import type { EngineAPI } from '@mibbeacon/core/client';
import {
  EngineStartArbitration,
  cleanupAcceptedEngineHandles,
  reportCurrentStartError,
} from './engine-start-arbitration';

describe('engine start arbitration', () => {
  it.each([
    ['older resolves first', ['old', 'new']],
    ['newer resolves first', ['new', 'old']],
  ])('accepts only the newest same-engine start when %s', async (_label, order) => {
    const arbitration = new EngineStartArbitration();
    const engine = {} as EngineAPI;
    const old = arbitration.begin(engine, 'query');
    const current = arbitration.begin(engine, 'query');
    const accepted: string[] = [];
    const cancelled: string[] = [];
    const claims = { old, new: current };
    for (const handle of order) {
      await arbitration.accept(
        claims[handle as 'old' | 'new'],
        handle,
        () => true,
        async (id) => cancelled.push(id),
        (id) => accepted.push(id),
      );
    }
    expect(accepted).toEqual(['new']);
    expect(cancelled).toEqual(['old']);
  });

  it('cancels accepted running and import handles on their originating engine', async () => {
    const cancelOperation = vi.fn().mockResolvedValue(undefined);
    const cancelImport = vi.fn().mockResolvedValue(undefined);
    const engine = {
      ops: { cancel: cancelOperation },
      resolver: { cancel: cancelImport },
    } as unknown as EngineAPI;
    await cleanupAcceptedEngineHandles(engine, {
      running: 'run-a',
      importHandle: 'import-a',
      sourceTestHandles: { first: 'test-a', second: 'test-b' },
      sourcePreviewHandle: 'preview-a',
    });
    expect(cancelOperation).toHaveBeenCalledWith('run-a');
    expect(cancelImport).toHaveBeenCalledWith('import-a');
    expect(cancelImport).toHaveBeenCalledWith('test-a');
    expect(cancelImport).toHaveBeenCalledWith('test-b');
    expect(cancelImport).toHaveBeenCalledWith('preview-a');
  });

  it('does not report an older start rejection after the newer start is current', () => {
    const arbitration = new EngineStartArbitration();
    const engine = {} as EngineAPI;
    const old = arbitration.begin(engine, 'tools-pattern');
    arbitration.begin(engine, 'tools-pattern');
    const report = vi.fn();
    reportCurrentStartError(arbitration, old, () => true, report, new Error('old failure'));
    expect(report).not.toHaveBeenCalled();
  });
});
