import { beforeEach, describe, expect, it } from 'vitest';
import type { AgentGroup, AgentProfile, EngineAPI } from '@mibbeacon/core/client';
import {
  buildAgentTarget,
  buildOperationTarget,
  deleteAgentProfile,
  refreshAgentGroups,
  refreshAgentProfiles,
  saveAgentProfile,
  testAgentProfile,
} from './actions';
import { useAppStore } from './store';
import { agentDraftFromEditor, editAgentProfile, EMPTY_AGENT_EDITOR } from './agent-profile-form';

const profile: AgentProfile = {
  id: 'agent-one',
  name: 'Core switch',
  host: '192.0.2.10',
  port: 161,
  transport: 'udp4',
  version: 'v2c',
  timeoutMs: 3000,
  retries: 2,
  getBulkNonRepeaters: 0,
  getBulkMaxRepetitions: 25,
  hasCommunity: true,
  hasAuthKey: false,
  hasPrivKey: false,
  createdAt: 1,
  updatedAt: 1,
};

describe('saved-agent quick picker', () => {
  beforeEach(() => {
    const state = useAppStore.getState();
    state.selectAgentProfile(null);
    state.selectAgentGroup(null);
    state.setAgentProfiles([]);
    state.setAgentGroups([]);
  });

  it('uses an opaque agent id and never copies saved credentials into the UI form', () => {
    useAppStore.getState().selectAgentProfile(profile);
    const state = useAppStore.getState();

    expect(state.agent).toMatchObject({ host: '192.0.2.10', community: '' });
    expect(buildAgentTarget(state.agent, state.selectedAgentId)).toEqual({ agentId: 'agent-one' });
  });

  it('switches back to an ad-hoc target when a saved profile field is edited', () => {
    useAppStore.getState().selectAgentProfile(profile);
    useAppStore.getState().setAgent({ host: '198.51.100.5', community: 'public' });
    const state = useAppStore.getState();

    expect(state.selectedAgentId).toBeNull();
    expect(buildAgentTarget(state.agent, state.selectedAgentId)).toMatchObject({
      agent: { host: '198.51.100.5', community: 'public' },
    });
  });

  it('clears a selected profile when an authoritative refresh no longer contains it', async () => {
    useAppStore.getState().selectAgentProfile(profile);
    const engine = { agents: { list: async () => [] } } as unknown as EngineAPI;

    await refreshAgentProfiles(engine);

    expect(useAppStore.getState().selectedAgentId).toBeNull();
  });

  it('does not let an older profile refresh overwrite a newer response', async () => {
    let resolveFirst: (profiles: AgentProfile[]) => void = () => undefined;
    let resolveSecond: (profiles: AgentProfile[]) => void = () => undefined;
    const first = new Promise<AgentProfile[]>((resolve) => (resolveFirst = resolve));
    const second = new Promise<AgentProfile[]>((resolve) => (resolveSecond = resolve));
    let request = 0;
    const engine = {
      agents: { list: () => (request++ === 0 ? first : second) },
    } as unknown as EngineAPI;
    const newer = { ...profile, id: 'agent-newer', name: 'Newer profile' };

    const olderRefresh = refreshAgentProfiles(engine);
    const newerRefresh = refreshAgentProfiles(engine);
    resolveSecond([newer]);
    await newerRefresh;
    resolveFirst([profile]);
    await olderRefresh;

    expect(useAppStore.getState().agentProfiles).toEqual([newer]);
  });

  it('keeps a confirmed create when the follow-up profile refresh fails', async () => {
    const created = { ...profile, id: 'agent-created', name: 'Created profile' };
    let creates = 0;
    const engine = {
      agents: {
        create: async () => {
          creates += 1;
          return created;
        },
        list: async () => {
          throw new Error('list unavailable');
        },
      },
    } as unknown as EngineAPI;

    const outcome = await saveAgentProfile(engine, null, agentDraftFromEditor(EMPTY_AGENT_EDITOR));

    expect(creates).toBe(1);
    expect(outcome.profile).toEqual(created);
    expect(outcome.refreshError).toEqual(new Error('list unavailable'));
    expect(useAppStore.getState().agentProfiles).toEqual([created]);
  });

  it('keeps a successful connection result when metadata refresh fails', async () => {
    const result = { latencyMs: 7, varbinds: [] };
    const engine = {
      agents: {
        test: async () => result,
        list: async () => {
          throw new Error('list unavailable');
        },
      },
    } as unknown as EngineAPI;

    const outcome = await testAgentProfile(engine, profile.id);

    expect(outcome.result).toEqual(result);
    expect(outcome.refreshError).toEqual(new Error('list unavailable'));
  });

  it('keeps a confirmed delete when follow-up profile and group refreshes fail', async () => {
    const group: AgentGroup = {
      id: 'group-one',
      name: 'Core devices',
      agentIds: [profile.id],
      createdAt: 1,
      updatedAt: 1,
    };
    const state = useAppStore.getState();
    state.setAgentProfiles([profile]);
    state.setAgentGroups([group]);
    state.selectAgentProfile(profile);
    const engine = {
      agents: {
        delete: async () => undefined,
        list: async () => {
          throw new Error('profiles unavailable');
        },
        groups: {
          list: async () => {
            throw new Error('groups unavailable');
          },
        },
      },
    } as unknown as EngineAPI;

    const outcome = await deleteAgentProfile(engine, profile.id);

    expect(outcome.refreshErrors).toHaveLength(2);
    expect(useAppStore.getState().agentProfiles).toEqual([]);
    expect(useAppStore.getState().agentGroups[0]?.agentIds).toEqual([]);
    expect(useAppStore.getState().selectedAgentId).toBeNull();
  });

  it('does not let an older group refresh overwrite a newer response', async () => {
    let resolveFirst: (groups: AgentGroup[]) => void = () => undefined;
    let resolveSecond: (groups: AgentGroup[]) => void = () => undefined;
    const first = new Promise<AgentGroup[]>((resolve) => (resolveFirst = resolve));
    const second = new Promise<AgentGroup[]>((resolve) => (resolveSecond = resolve));
    let request = 0;
    const engine = {
      agents: { groups: { list: () => (request++ === 0 ? first : second) } },
    } as unknown as EngineAPI;
    const newer: AgentGroup = {
      id: 'group-newer',
      name: 'Newer group',
      agentIds: [profile.id],
      createdAt: 2,
      updatedAt: 2,
    };

    const olderRefresh = refreshAgentGroups(engine);
    const newerRefresh = refreshAgentGroups(engine);
    resolveSecond([newer]);
    await newerRefresh;
    resolveFirst([]);
    await olderRefresh;

    expect(useAppStore.getState().agentGroups).toEqual([newer]);
  });

  it('keeps saved passwords write-only and emits only version-relevant fields', () => {
    const editor = editAgentProfile(profile);
    expect(editor).toMatchObject({ community: '', authKey: '', privKey: '' });
    expect(agentDraftFromEditor(editor).secrets).toEqual({});

    const v3Draft = agentDraftFromEditor({
      ...EMPTY_AGENT_EDITOR,
      name: 'Observer',
      host: '2001:db8::10',
      version: 'v3',
      user: 'observer',
      level: 'noAuthNoPriv',
      community: 'irrelevant',
      authKey: 'irrelevant',
      privKey: 'irrelevant',
    });
    expect(v3Draft).toMatchObject({
      profile: { version: 'v3' },
      v3: { user: 'observer', level: 'noAuthNoPriv' },
      secrets: {},
    });
  });

  it('uses an opaque group target and tracks independent agent statuses', () => {
    const state = useAppStore.getState();
    expect(buildOperationTarget(state.agent, 'agent-one', 'group-one')).toEqual({
      groupId: 'group-one',
    });
    state.clearAgentOperationStatuses();
    state.setAgentOperationStatus('agent-one', { state: 'done', count: 4 });
    state.setAgentOperationStatus('agent-two', { state: 'error', message: 'timeout' });
    expect(useAppStore.getState().agentOperationStatuses).toEqual({
      'agent-one': { state: 'done', count: 4 },
      'agent-two': { state: 'error', message: 'timeout' },
    });
  });
});
