import { describe, expect, it } from 'vitest';
import { useAppStore } from './store';

describe('engine session transient reset', () => {
  it('clears prior-engine operation authority while preserving preferences and local file draft', () => {
    const themeMode = useAppStore.getState().themeMode;
    useAppStore.setState({
      running: 'old-operation',
      moduleFocus: { module: { name: 'OLD-MIB' } } as never,
      selected: { oid: '1.3.6' } as never,
      expanded: { '1': true },
      hits: [{ oid: '1.3.6' }] as never,
      childrenCache: { '': [{ oid: '1' }] } as never,
      searchPhase: 'searching',
      searchError: 'old search',
      agentOperationStatuses: { old: { state: 'running' } },
      operationPduLog: [{ old: true }],
      results: [{ oid: '1' }] as never,
      stats: { count: 4, batches: 2, ms: 10 },
      queryError: 'old query',
      oidName: 'old name',
      setPreviousValues: [{ oid: '1.3' }] as never,
      setReview: true,
      setDraft: { oid: '1.3', type: 'Integer', value: '7' } as never,
      setStaging: [{ oid: '1.4', type: 'Integer', value: '8' }] as never,
      sendBusy: true,
      sendError: 'old send',
      sendHistory: [{ id: 'old-send' }] as never,
      tableView: { entryOid: '1' } as never,
      importBusy: true,
      importHandle: 'old-import',
      importStatus: { handleId: 'old-import', state: 'running', failures: [] },
      importProgress: [{ id: 'old', kind: 'progress', at: 1 }],
      importCompleted: 1,
      importTotal: 2,
      fileImportDraft: {
        handleId: 'old-import',
        visible: false,
      } as never,
      consent: { handleId: 'old-consent', missingModules: [], sourceHosts: [] },
      consentQueue: [{ handleId: 'queued', missingModules: [], sourceHosts: [] }],
      sourceTestHandles: { source: 'old-test' },
      sourcePreviewHandle: 'old-preview',
      lookupHandles: { '1.3.6': 'old-lookup' },
      vendorMibBrowseHandles: { '1.3.6': 'old-vendor' },
    });

    useAppStore.getState().resetEngineSessionTransientState();

    expect(useAppStore.getState()).toMatchObject({
      running: null,
      moduleFocus: null,
      selected: null,
      expanded: {},
      hits: [],
      childrenCache: {},
      searchPhase: 'idle',
      searchError: null,
      agentOperationStatuses: {},
      operationPduLog: [],
      results: [],
      stats: { count: 0, batches: 0, ms: 0 },
      queryError: null,
      oidName: null,
      setPreviousValues: [],
      setReview: false,
      sendBusy: false,
      sendError: null,
      sendHistory: [],
      tableView: null,
      importBusy: false,
      importHandle: null,
      importStatus: null,
      importProgress: [],
      importCompleted: 0,
      importTotal: 0,
      consent: null,
      consentQueue: [],
      sourceTestHandles: {},
      sourcePreviewHandle: null,
      lookupHandles: {},
      vendorMibBrowseHandles: {},
      themeMode,
    });
    expect(useAppStore.getState().fileImportDraft).toMatchObject({
      handleId: null,
      visible: true,
    });
    expect(useAppStore.getState().setDraft).toMatchObject({ oid: '1.3', value: '7' });
    expect(useAppStore.getState().setStaging).toEqual([
      expect.objectContaining({ oid: '1.4', value: '8' }),
    ]);
  });
});
