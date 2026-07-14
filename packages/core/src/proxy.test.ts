import { describe, expect, it, vi } from 'vitest';
import { createEngineProxy } from './proxy';

describe('engine proxy', () => {
  it('forwards the logs API over the renderer-safe adapter', async () => {
    const invoke = vi.fn().mockResolvedValue({ ok: true, value: [] });
    const engine = createEngineProxy({ invoke, subscribe: () => () => undefined });
    const filter = { minLevel: 'warn' as const, limit: 25 };

    await engine.logs.query(filter);
    await engine.logs.setLevel('error');
    await engine.logs.export('/tmp/support.jsonl');

    expect(invoke).toHaveBeenNthCalledWith(1, 'logs.query', filter);
    expect(invoke).toHaveBeenNthCalledWith(2, 'logs.setLevel', 'error');
    expect(invoke).toHaveBeenNthCalledWith(3, 'logs.export', '/tmp/support.jsonl');
  });
});
