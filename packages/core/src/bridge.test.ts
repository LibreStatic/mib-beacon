import { describe, expect, it, vi } from 'vitest';
import type { EngineAPI } from './api/engine-api';
import { dispatchEngineCall } from './bridge';

describe('engine bridge', () => {
  it('dispatches typed Set requests', async () => {
    const set = vi.fn().mockResolvedValue([{ oid: '1.3.6.1', value: 7 }]);
    const engine = { ops: { set } } as unknown as EngineAPI;
    const request = {
      agent: { host: '127.0.0.1', version: 'v2c' as const, community: 'private' },
      varbinds: [{ oid: '1.3.6.1', type: 'Integer' as const, value: '7' }],
    };

    await expect(dispatchEngineCall(engine, 'ops.set', [request])).resolves.toEqual({
      ok: true,
      value: [{ oid: '1.3.6.1', value: 7 }],
    });
    expect(set).toHaveBeenCalledWith(request);
  });

  it('dispatches notification send requests', async () => {
    const send = vi.fn().mockResolvedValue({ kind: 'trap', sentAt: 1, acknowledged: false });
    const engine = { traps: { send } } as unknown as EngineAPI;
    const request = {
      target: { host: '127.0.0.1', port: 1162, version: 'v2c' as const, community: 'public' },
      kind: 'trap' as const,
      trapOid: '1.3.6.1.6.3.1.1.5.1',
      varbinds: [],
    };
    await expect(dispatchEngineCall(engine, 'traps.send', [request])).resolves.toEqual({
      ok: true,
      value: { kind: 'trap', sentAt: 1, acknowledged: false },
    });
    expect(send).toHaveBeenCalledWith(request);
  });

  it('dispatches stateful resolver methods with structured-clone-safe values', async () => {
    const startImport = vi.fn().mockResolvedValue({ handleId: 'import-1' });
    const respondConsent = vi.fn().mockResolvedValue(undefined);
    const engine = {
      mibs: { startImport },
      resolver: { respondConsent },
    } as unknown as EngineAPI;
    const request = { files: [{ name: 'x.mib', content: 'X' }] };

    await expect(dispatchEngineCall(engine, 'mibs.startImport', [request])).resolves.toEqual({
      ok: true,
      value: { handleId: 'import-1' },
    });
    await expect(
      dispatchEngineCall(engine, 'resolver.respondConsent', [
        'import-1',
        { allow: true, askAgain: false },
      ]),
    ).resolves.toEqual({ ok: true, value: undefined });
    expect(startImport).toHaveBeenCalledWith(request);
    expect(respondConsent).toHaveBeenCalledWith('import-1', { allow: true, askAgain: false });
  });

  it('dispatches file inspection with relative paths intact', async () => {
    const inspection = { files: [], duplicateDefinitions: [], externalMissingImports: [] };
    const inspectFiles = vi.fn().mockResolvedValue(inspection);
    const engine = { mibs: { inspectFiles } } as unknown as EngineAPI;
    const files = [{ name: 'x.mib', relativePath: 'folder/x.mib', content: 'X' }];

    await expect(dispatchEngineCall(engine, 'mibs.inspectFiles', [files])).resolves.toEqual({
      ok: true,
      value: inspection,
    });
    expect(inspectFiles).toHaveBeenCalledWith(files);
  });

  it('dispatches replacement-group metadata without source bodies', async () => {
    const replacementGroup = vi.fn().mockResolvedValue(['A-MIB', 'B-MIB']);
    const engine = { mibs: { replacementGroup } } as unknown as EngineAPI;
    await expect(dispatchEngineCall(engine, 'mibs.replacementGroup', ['A-MIB'])).resolves.toEqual({
      ok: true,
      value: ['A-MIB', 'B-MIB'],
    });
    expect(replacementGroup).toHaveBeenCalledWith('A-MIB');
  });

  it('dispatches unsaved resolver source previews', async () => {
    const preview = vi.fn().mockResolvedValue({ handleId: 'preview-1' });
    const engine = { resolver: { sources: { preview } } } as unknown as EngineAPI;
    const draft = { config: { id: 'draft', kind: 'json-catalog' } };
    await expect(dispatchEngineCall(engine, 'resolver.sources.preview', [draft])).resolves.toEqual({
      ok: true,
      value: { handleId: 'preview-1' },
    });
    expect(preview).toHaveBeenCalledWith(draft);
  });
});
