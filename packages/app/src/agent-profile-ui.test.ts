import { beforeEach, describe, expect, it } from 'vitest';
import type { AgentProfile } from '@mibbeacon/core/client';
import { buildAgentTarget, buildOperationTarget } from './actions';
import { useAppStore } from './store';
import {
  agentDraftFromEditor,
  editAgentProfile,
  EMPTY_AGENT_EDITOR,
} from './agent-profile-form';

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
  beforeEach(() => useAppStore.getState().selectAgentProfile(null));

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
