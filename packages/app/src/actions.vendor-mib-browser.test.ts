import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineAPI, ResolverOperationStatus } from '@mibbeacon/core/client';
import { browseVendorMibs, loadLookupCandidate } from './actions';
import { useAppStore } from './store';

function runningStatus(handleId: string): ResolverOperationStatus {
  const now = Date.now();
  return {
    handleId,
    state: 'resolving',
    startedAt: now,
    updatedAt: now,
    missingModules: [],
    sourceHosts: [],
    loadedModules: [],
    failures: [],
  };
}

describe('vendor MIB browser action ownership', () => {
  beforeEach(() => {
    useAppStore.setState({
      importBusy: false,
      importHandle: null,
      importStatus: null,
      vendorMibBrowseHandles: {},
      vendorMibBrowses: {},
    });
  });

  it('coalesces concurrent browse starts for the same OID', async () => {
    const browse = vi.fn(async () => ({ handleId: 'browse-1' }));
    const engine = {
      resolver: {
        settings: { get: vi.fn(async () => ({ enabled: true })) },
        browseVendorMibs: browse,
        status: vi.fn(async () => runningStatus('browse-1')),
      },
    } as unknown as EngineAPI;

    await Promise.all([
      browseVendorMibs(engine, '1.3.6.1.4.1.99003', 'Acme'),
      browseVendorMibs(engine, '1.3.6.1.4.1.99003', 'Acme'),
    ]);

    expect(browse).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent candidate import starts', async () => {
    const resolveModules = vi.fn(async () => ({ handleId: 'import-1' }));
    const engine = {
      resolver: {
        resolveModules,
        status: vi.fn(async () => runningStatus('import-1')),
      },
    } as unknown as EngineAPI;

    await Promise.all([
      loadLookupCandidate(engine, 'ACME-MIB', false, 'acme-source'),
      loadLookupCandidate(engine, 'ACME-MIB', false, 'acme-source'),
    ]);

    expect(resolveModules).toHaveBeenCalledTimes(1);
  });

  it('refreshes loaded ownership after a candidate import completes', async () => {
    const oid = '1.3.6.1.4.1.99003';
    useAppStore.setState({
      oidLookups: {
        [oid]: {
          state: 'done',
          result: {
            oid,
            loaded: null,
            cached: null,
            enterprise: { number: 99003, organization: 'Acme' },
            oidBase: null,
            oidRef: null,
            fromCache: false,
            candidates: [],
          },
        },
      },
    });
    const now = Date.now();
    const resolve = vi.fn(async () => ({
      name: 'acmeRoot',
      module: 'ACME-MIB',
      oid,
      definitionOid: oid,
    }));
    const engine = {
      mibs: {
        list: vi.fn(async () => []),
        tree: vi.fn(async () => []),
        resolve,
      },
      resolver: {
        resolveModules: vi.fn(async () => ({ handleId: 'import-1' })),
        status: vi.fn(async () => ({
          ...runningStatus('import-1'),
          state: 'done',
          updatedAt: now,
          result: { loaded: ['ACME-MIB'], errors: [] },
        })),
        settings: { get: vi.fn(async () => ({ enabled: true })) },
        sources: { list: vi.fn(async () => []) },
        cache: { stats: vi.fn(async () => ({ entries: 1, bytes: 100 })) },
        history: { list: vi.fn(async () => []) },
      },
    } as unknown as EngineAPI;

    await loadLookupCandidate(engine, 'ACME-MIB', false, 'acme-source');

    expect(resolve).toHaveBeenCalledWith(oid);
    expect(useAppStore.getState().oidLookups[oid]?.result?.loaded).toMatchObject({
      name: 'acmeRoot',
      module: 'ACME-MIB',
    });
  });
});
