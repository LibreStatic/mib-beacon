import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EngineAPI } from '@mibbeacon/core/client';
import { AgentPersistentCollectionsController } from './agent-persistent-collections';

const profile = (id: string, name = id) => ({
  id,
  name,
  host: '127.0.0.1',
  port: 161,
  transport: 'udp4' as const,
  version: 'v2c' as const,
  timeoutMs: 5000,
  retries: 1,
  getBulkNonRepeaters: 0,
  getBulkMaxRepetitions: 20,
  hasCommunity: true,
  hasAuthKey: false,
  hasPrivKey: false,
  createdAt: 1,
  updatedAt: 1,
});
const group = (id: string, agentIds: string[] = []) => ({
  id,
  name: id,
  agentIds,
  createdAt: 1,
  updatedAt: 1,
});

function fixture() {
  let profiles = [profile('a')];
  let groups = [group('g', ['a'])];
  const engine = {
    agents: {
      list: vi.fn(async () => profiles),
      create: vi.fn(async () => {
        const value = profile('b');
        profiles = [...profiles, value];
        return value;
      }),
      update: vi.fn(),
      delete: vi.fn(async (id: string) => {
        profiles = profiles.filter((x) => x.id !== id);
        groups = groups.map((x) => ({ ...x, agentIds: x.agentIds.filter((a) => a !== id) }));
      }),
      groups: {
        list: vi.fn(async () => groups),
        create: vi.fn(async () => {
          const value = group('h');
          groups = [...groups, value];
          return value;
        }),
        update: vi.fn(),
        delete: vi.fn(async (id: string) => {
          groups = groups.filter((x) => x.id !== id);
        }),
      },
    },
  } as unknown as EngineAPI;
  return { engine };
}

describe('AgentPersistentCollectionsController', () => {
  it('keeps every mounted profile/group write behind the shared authority', () => {
    for (const screen of ['AgentsScreen.tsx', 'ToolsScreen.tsx', 'LiveMibsScreen.tsx']) {
      const source = readFileSync(join(__dirname, 'screens', screen), 'utf8');
      expect(source).not.toMatch(
        /engine\.agents\.(create|update|delete|groups\.(create|update|delete))\s*\(/,
      );
    }
    const tools = readFileSync(join(__dirname, 'screens', 'ToolsScreen.tsx'), 'utf8');
    expect(tools).not.toContain('engine.tools.discovery.saveAgent(');
    expect(tools).toContain('.saveDiscoveredProfile(');
  });

  it('retains only sanitized public semantics in secret-bearing matchers', () => {
    const source = readFileSync(join(__dirname, 'agent-persistent-collections.ts'), 'utf8');
    const update = source.split('async updateProfile')[1]?.split('async saveDiscoveredProfile')[0];
    const discovery = source.split('async saveDiscoveredProfile')[1]?.split('deleteProfile(')[0];
    expect(update).toContain('profileUpdateMatch(');
    expect(update).toContain('semantic,');
    expect(update).not.toContain(
      'profileUpdateMatch(\n          found,\n          before.profiles.find((x) => x.id === id),\n          draft',
    );
    expect(discovery).toContain('publicIntent.ip');
    expect(discovery).not.toContain('candidate.host === input.ip');
  });
  it('loads once and serializes mixed profile/group writes', async () => {
    const { engine } = fixture();
    const controller = new AgentPersistentCollectionsController(engine);
    await controller.load();
    await Promise.all([
      controller.createProfile({
        profile: { name: 'b', host: 'x', version: 'v2c' },
        secrets: { community: 'private' },
      }),
      controller.createGroup({ name: 'h', agentIds: [] }),
    ]);
    expect(controller.snapshot().profiles.map((x) => x.id)).toEqual(['a', 'b']);
    expect(controller.snapshot().groups.map((x) => x.id)).toEqual(['g', 'h']);
  });

  it('coordinates dependent groups when deleting a profile', async () => {
    const { engine } = fixture();
    const controller = new AgentPersistentCollectionsController(engine);
    await controller.load();
    await controller.deleteProfile('a');
    expect(controller.snapshot().profiles).toEqual([]);
    expect(controller.snapshot().groups[0]?.agentIds).toEqual([]);
  });

  it('rejects a queued command after ownership is lost', async () => {
    const { engine } = fixture();
    const controller = new AgentPersistentCollectionsController(engine);
    let owns = true;
    const pending = controller.createGroup({ name: 'h', agentIds: [] }, () => owns);
    owns = false;
    await expect(pending).rejects.toThrow(/ownership/);
    expect(engine.agents.groups.create).not.toHaveBeenCalled();
  });

  it('denies replay of a failed secret-bearing command', async () => {
    const { engine } = fixture();
    vi.mocked(engine.agents.create).mockRejectedValueOnce(new Error('rejected'));
    const controller = new AgentPersistentCollectionsController(engine);
    await controller.load();
    await expect(
      controller.createProfile({
        profile: { name: 'b', host: 'x', version: 'v2c' },
        secrets: { community: 'do-not-log' },
      }),
    ).rejects.toThrow();
    await expect(controller.retryFailed()).rejects.toThrow(/Re-enter/);
    expect(JSON.stringify(controller.snapshot())).not.toContain('do-not-log');
  });

  it('confirms an ambiguous new secret-bearing profile from unique public presence metadata', async () => {
    const { engine } = fixture();
    vi.mocked(engine.agents.create).mockImplementationOnce(async () => {
      const created = profile('b');
      vi.mocked(engine.agents.list).mockResolvedValue([profile('a'), created]);
      throw new Error('Request timed out');
    });
    const controller = new AgentPersistentCollectionsController(engine);
    await controller.load();
    await expect(
      controller.createProfile({
        profile: { name: 'b', host: '127.0.0.1', version: 'v2c' },
        secrets: { community: 'private' },
      }),
    ).resolves.toMatchObject({ id: 'b' });
    expect(controller.snapshot().phase).toBe('success');
  });

  it('keeps replacement of an already-present write-only credential uncertain', async () => {
    const { engine } = fixture();
    vi.mocked(engine.agents.update).mockRejectedValueOnce(new Error('Request timed out'));
    const controller = new AgentPersistentCollectionsController(engine);
    await controller.load();
    await expect(
      controller.updateProfile('a', { secrets: { community: 'replacement' } }),
    ).rejects.toThrow(/credential-bearing/);
    expect(controller.snapshot()).toMatchObject({
      phase: 'uncertain',
      retryable: false,
      canAcknowledgeUncertainty: true,
    });
    expect(JSON.stringify(controller.snapshot())).not.toContain('replacement');
  });

  it('settles an active command on disposal and does not commit its late result', async () => {
    const { engine } = fixture();
    let resolve!: () => void;
    vi.mocked(engine.agents.groups.create).mockImplementationOnce(
      () =>
        new Promise<never>((done) => {
          resolve = () => done(group('late') as never);
        }),
    );
    const controller = new AgentPersistentCollectionsController(engine);
    await controller.load();
    const pending = controller.createGroup({ name: 'late', agentIds: [] });
    await Promise.resolve();
    controller.dispose();
    await expect(pending).rejects.toThrow(/disposed/);
    resolve();
  });

  it('routes discovery saves through the same sensitive authority', async () => {
    const { engine } = fixture();
    engine.tools = { discovery: { saveAgent: vi.fn(async () => profile('discovered')) } } as never;
    vi.mocked(engine.agents.list)
      .mockResolvedValueOnce([profile('a')])
      .mockResolvedValueOnce([profile('a'), profile('discovered')]);
    const controller = new AgentPersistentCollectionsController(engine);
    await controller.load();
    await expect(
      controller.saveDiscoveredProfile({ ip: '192.0.2.2', community: 'private' }),
    ).resolves.toMatchObject({ id: 'discovered' });
    expect(controller.snapshot().profiles.map((x) => x.id)).toContain('discovered');
  });

  it('forces rollback-unknown failures into non-retryable uncertain recovery', async () => {
    const { engine } = fixture();
    vi.mocked(engine.agents.update).mockRejectedValueOnce(
      new Error('Secret rollback outcome unknown after agent update failure'),
    );
    const controller = new AgentPersistentCollectionsController(engine);
    await controller.load();
    await expect(
      controller.updateProfile('a', { secrets: { community: 'never-expose' } }),
    ).rejects.toThrow(/credential-bearing/);
    expect(controller.snapshot()).toMatchObject({
      phase: 'uncertain',
      retryable: false,
      canAcknowledgeUncertainty: true,
    });
    expect(JSON.stringify(controller.snapshot())).not.toContain('never-expose');
  });

  it('does not let an older load failure reject queued work after a newer refresh starts', async () => {
    let rejectOld!: (cause: unknown) => void;
    const old = new Promise<ReturnType<typeof profile>[]>((_resolve, reject) => {
      rejectOld = reject;
    });
    const { engine } = fixture();
    vi.mocked(engine.agents.list)
      .mockReturnValueOnce(old)
      .mockResolvedValueOnce([profile('newer')])
      .mockResolvedValue([profile('newer')]);
    const controller = new AgentPersistentCollectionsController(engine);
    const loading = controller.load().catch(() => undefined);
    const queued = controller.createGroup({ name: 'h', agentIds: [] });
    await controller.refresh();
    rejectOld(new Error('old load failed'));
    await loading;
    await expect(queued).resolves.toBeUndefined();
    expect(controller.snapshot().readiness.phase).toBe('ready');
  });

  it('ignores secret inputs that are inactive for the selected version', async () => {
    const { engine } = fixture();
    const created = { ...profile('b'), hasAuthKey: false, hasPrivKey: false };
    vi.mocked(engine.agents.create).mockImplementationOnce(async () => {
      vi.mocked(engine.agents.list).mockResolvedValue([profile('a'), created]);
      throw new Error('Request timed out');
    });
    const controller = new AgentPersistentCollectionsController(engine);
    await controller.load();
    await expect(
      controller.createProfile({
        profile: { name: 'b', host: '127.0.0.1', version: 'v2c' },
        secrets: { community: 'private', authKey: 'irrelevant', privKey: 'irrelevant' },
      }),
    ).resolves.toMatchObject({ id: 'b' });
  });

  it('does not commit an older successful read after a newer read starts', async () => {
    const { engine } = fixture();
    const controller = new AgentPersistentCollectionsController(engine);
    await controller.load();
    let resolveOld!: (value: ReturnType<typeof profile>[]) => void;
    let resolveNew!: (value: ReturnType<typeof profile>[]) => void;
    vi.mocked(engine.agents.list)
      .mockReturnValueOnce(new Promise((resolve) => (resolveOld = resolve)))
      .mockReturnValueOnce(new Promise((resolve) => (resolveNew = resolve)));
    const oldRead = controller.refresh();
    const newRead = controller.refresh();
    resolveOld([profile('stale')]);
    await oldRead;
    expect(controller.snapshot().profiles.map((item) => item.id)).toEqual(['a']);
    resolveNew([profile('newer')]);
    await newRead;
    expect(controller.snapshot().profiles.map((item) => item.id)).toEqual(['newer']);
  });

  it('retries a non-sensitive reverted group command after clearing the blocked phase', async () => {
    const { engine } = fixture();
    vi.mocked(engine.agents.groups.create).mockRejectedValueOnce(new Error('rejected'));
    const controller = new AgentPersistentCollectionsController(engine);
    await controller.load();
    await expect(controller.createGroup({ name: 'h', agentIds: [] })).rejects.toThrow('rejected');
    expect(controller.snapshot().phase).toBe('error-reverted');
    await expect(controller.retryFailed()).resolves.toBeUndefined();
    expect(controller.snapshot().phase).toBe('success');
  });

  it('matches ambiguous updates with core trimming while ignoring inactive secrets', async () => {
    const { engine } = fixture();
    const updated = { ...profile('a'), name: 'Trimmed', host: 'example.test' };
    vi.mocked(engine.agents.update).mockImplementationOnce(async () => {
      vi.mocked(engine.agents.list).mockResolvedValue([updated]);
      throw new Error('Request timed out');
    });
    const controller = new AgentPersistentCollectionsController(engine);
    await controller.load();
    await expect(
      controller.updateProfile('a', {
        profile: { name: '  Trimmed  ', host: '  example.test  ' },
        secrets: { authKey: 'inactive-secret', privKey: 'inactive-secret' },
      }),
    ).resolves.toMatchObject({ name: 'Trimmed', host: 'example.test' });
    expect(controller.snapshot().phase).toBe('success');
  });

  it('rejects a blocked sensitive submit before queueing or calling the engine', async () => {
    const { engine } = fixture();
    vi.mocked(engine.agents.create).mockRejectedValueOnce(new Error('rejected'));
    const controller = new AgentPersistentCollectionsController(engine);
    await controller.load();
    const draft = {
      profile: { name: 'b', host: '127.0.0.1', version: 'v2c' as const },
      secrets: { community: 'never-retain' },
    };
    await expect(controller.createProfile(draft)).rejects.toThrow(/credential-bearing/);
    await expect(controller.createProfile(draft)).rejects.toThrow(/Resolve the previous/);
    expect(controller.snapshot().queued).toBe(0);
    expect(engine.agents.create).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(controller.snapshot())).not.toContain('never-retain');
  });

  it('mounts visible shared recovery and gates profile/discovery submits cross-screen', () => {
    for (const screen of ['ToolsScreen.tsx', 'LiveMibsScreen.tsx']) {
      const source = readFileSync(join(__dirname, 'screens', screen), 'utf8');
      expect(source).toContain('<AgentCollectionRecovery engine={engine} owns={ownsEngine} />');
      expect(source).toContain('agentCollectionsBlocked');
    }
    const recovery = readFileSync(
      join(__dirname, 'components', 'AgentCollectionRecovery.tsx'),
      'utf8',
    );
    expect(recovery).toContain('Reconcile agents');
    expect(recovery).toContain('Acknowledge and re-enter');
    expect(recovery).toContain('Acknowledge uncertainty');
  });

  it('drops queued credential commands when the active credential write fails', async () => {
    const { engine } = fixture();
    let rejectFirst!: (cause: unknown) => void;
    vi.mocked(engine.agents.create).mockImplementationOnce(
      () => new Promise((_resolve, reject) => (rejectFirst = reject)),
    );
    const controller = new AgentPersistentCollectionsController(engine);
    await controller.load();
    const first = controller.createProfile({
      profile: { name: 'first', host: '127.0.0.1', version: 'v2c' },
      secrets: { community: 'first-secret' },
    });
    const second = controller.createProfile({
      profile: { name: 'second', host: '127.0.0.2', version: 'v2c' },
      secrets: { community: 'second-secret' },
    });
    rejectFirst(new Error('rejected'));
    await expect(first).rejects.toThrow(/credential-bearing/);
    await expect(second).rejects.toThrow(/cancelled/i);
    expect(controller.snapshot()).toMatchObject({ phase: 'error-reverted', queued: 0 });
    expect(JSON.stringify(controller.snapshot())).not.toMatch(/first-secret|second-secret/);
    controller.acknowledge();
    await Promise.resolve();
    expect(engine.agents.create).toHaveBeenCalledTimes(1);
  });

  it('clears credential drafts on sensitive failures across mounted screens', () => {
    const agents = readFileSync(join(__dirname, 'screens', 'AgentsScreen.tsx'), 'utf8');
    const tools = readFileSync(join(__dirname, 'screens', 'ToolsScreen.tsx'), 'utf8');
    const live = readFileSync(join(__dirname, 'screens', 'LiveMibsScreen.tsx'), 'utf8');
    expect(agents).toMatch(
      /setEditor\([\s\S]*community:\s*''[\s\S]*authKey:\s*''[\s\S]*privKey:\s*''/,
    );
    expect(tools).toMatch(
      /setTargetEditor\([\s\S]*community:\s*''[\s\S]*authKey:\s*''[\s\S]*privKey:\s*''/,
    );
    const pollCreate = tools.split('title="Create series"')[1]?.split('</Card>')[0];
    expect(pollCreate).not.toContain("setCommunities('')");
    const discoverySave = tools.split('title="Save agent"')[1]?.split('title="Open Query"')[0];
    expect(discoverySave).toContain("setCommunities('')");
    expect(discoverySave).toContain('communityForDiscoveryResult(result.credentialLabel)');
    expect(discoverySave).toContain('!community');
    expect(live).toMatch(
      /setProfileEditor\([\s\S]*community:\s*''[\s\S]*authKey:\s*''[\s\S]*privKey:\s*''/,
    );
  });

  it('guards the post-reconcile error path before AgentsScreen writes UI or toasts', () => {
    const agents = readFileSync(join(__dirname, 'screens', 'AgentsScreen.tsx'), 'utf8');
    expect(agents).toMatch(/catch \{\s*if \(!ownsEngine\(\)\) return;\s*message =/);
    expect(agents).toMatch(/if \(!ownsEngine\(\)\) return;\s*setError\(message\)/);
    expect(agents).toMatch(/finally \{\s*if \(ownsEngine\(\)\) setEditorBusy\(false\)/);
    expect(agents).toMatch(/finally \{\s*if \(ownsEngine\(\)\) setTestingId\(null\)/);
    expect(agents).toMatch(/finally \{\s*if \(ownsEngine\(\)\) setDeletingId\(null\)/);
    expect(agents).toMatch(/accessibilityLiveRegion="polite"[\s\S]*agentCollectionStatusText/);
    const tools = readFileSync(join(__dirname, 'screens', 'ToolsScreen.tsx'), 'utf8');
    const discoverySave = tools.split('title="Save agent"')[1]?.split('title="Open Query"')[0];
    expect(discoverySave).toMatch(/finally\([\s\S]*if \(!ownsEngine\(\)\) return/);
  });
});
