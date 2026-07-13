import { describe, expect, it, vi } from 'vitest';
import type { EngineAPI } from '@omc/core/client';
import { refreshResolverState } from './actions';

describe('refreshResolverState', () => {
  it('coalesces concurrent refreshes for the same renderer engine', async () => {
    const engine = {
      resolver: {
        settings: { get: vi.fn().mockResolvedValue({ enabled: true }) },
        sources: { list: vi.fn().mockResolvedValue([]) },
        cache: { stats: vi.fn().mockResolvedValue({ entries: 0, bytes: 0 }) },
        history: { list: vi.fn().mockResolvedValue([]) },
      },
    } as unknown as EngineAPI;

    await Promise.all([refreshResolverState(engine), refreshResolverState(engine)]);

    expect(engine.resolver.settings.get).toHaveBeenCalledTimes(1);
    expect(engine.resolver.sources.list).toHaveBeenCalledTimes(1);
    expect(engine.resolver.cache.stats).toHaveBeenCalledTimes(1);
    expect(engine.resolver.history.list).toHaveBeenCalledTimes(1);
  });
});
