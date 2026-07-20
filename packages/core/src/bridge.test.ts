import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { EngineAPI } from './api/engine-api';
import { dispatchEngineCall, ENGINE_EVENT_CHANNELS, ENGINE_METHODS } from './bridge';

describe('engine bridge', () => {
  it('forwards Live MIB scan events to remote clients', () => {
    expect(ENGINE_EVENT_CHANNELS).toContain('live-mibs');
  });

  it('registers every method invoked by the remote engine proxy', () => {
    const proxySource = readFileSync(new URL('./proxy.ts', import.meta.url), 'utf8');
    const proxyMethods = [
      ...new Set([...proxySource.matchAll(/call\('([^']+)'/g)].map((match) => match[1])),
    ];

    expect(proxyMethods.filter((method) => !(method in ENGINE_METHODS))).toEqual([]);
  });

  it('dispatches the in-memory logs query, level, and export methods', async () => {
    const query = vi.fn().mockResolvedValue([{ id: 'log-1', level: 'error' }]);
    const setLevel = vi.fn().mockResolvedValue(undefined);
    const exportLogs = vi.fn().mockResolvedValue({ path: '/tmp/logs.jsonl', count: 1 });
    const engine = {
      logs: { query, setLevel, export: exportLogs },
    } as unknown as EngineAPI;
    const filter = { minLevel: 'warn' as const, limit: 10 };

    await expect(dispatchEngineCall(engine, 'logs.query', [filter])).resolves.toEqual({
      ok: true,
      value: [{ id: 'log-1', level: 'error' }],
    });
    await expect(dispatchEngineCall(engine, 'logs.setLevel', ['warn'])).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    await expect(dispatchEngineCall(engine, 'logs.export', ['/tmp/logs.jsonl'])).resolves.toEqual({
      ok: true,
      value: { path: '/tmp/logs.jsonl', count: 1 },
    });
    expect(query).toHaveBeenCalledWith(filter);
    expect(setLevel).toHaveBeenCalledWith('warn');
    expect(exportLogs).toHaveBeenCalledWith('/tmp/logs.jsonl');
  });

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

  it('dispatches MIB translations used by remote web clients', async () => {
    const translation = { oid: '1', name: 'iso', module: 'SNMPv2-SMI' };
    const translate = vi.fn().mockResolvedValue(translation);
    const engine = { mibs: { translate } } as unknown as EngineAPI;

    await expect(dispatchEngineCall(engine, 'mibs.translate', ['iso'])).resolves.toEqual({
      ok: true,
      value: translation,
    });
    expect(translate).toHaveBeenCalledWith('iso');
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

  it('dispatches agent profile and group methods without exposing a credential resolver', async () => {
    const list = vi.fn().mockResolvedValue([]);
    const createGroup = vi.fn().mockResolvedValue({ id: 'group-1', name: 'Lab', agentIds: [] });
    const engine = {
      agents: { list, groups: { create: createGroup } },
    } as unknown as EngineAPI;

    await expect(dispatchEngineCall(engine, 'agents.list', [])).resolves.toEqual({
      ok: true,
      value: [],
    });
    await expect(
      dispatchEngineCall(engine, 'agents.groups.create', [{ name: 'Lab', agentIds: [] }]),
    ).resolves.toMatchObject({ ok: true, value: { id: 'group-1' } });
    await expect(dispatchEngineCall(engine, 'agents.resolve', ['agent-1'])).resolves.toMatchObject({
      ok: false,
      error: { message: expect.stringMatching(/unknown method/i) },
    });
  });
});
