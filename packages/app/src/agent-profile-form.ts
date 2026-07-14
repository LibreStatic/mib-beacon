import type {
  AgentCreateDraft,
  AgentProfile,
  AgentV3Input,
  AuthProtocol,
  PrivProtocol,
  SecurityLevel,
  SnmpVersion,
} from '@mibbeacon/core/client';

export interface AgentEditorState {
  name: string;
  host: string;
  port: string;
  transport: 'udp4' | 'udp6';
  version: SnmpVersion;
  timeoutMs: string;
  retries: string;
  getBulkNonRepeaters: string;
  getBulkMaxRepetitions: string;
  community: string;
  user: string;
  level: SecurityLevel;
  authProtocol: AuthProtocol;
  authKey: string;
  privProtocol: PrivProtocol;
  privKey: string;
  context: string;
  contextEngineId: string;
}

export const EMPTY_AGENT_EDITOR: AgentEditorState = {
  name: '',
  host: '',
  port: '161',
  transport: 'udp4',
  version: 'v2c',
  timeoutMs: '5000',
  retries: '1',
  getBulkNonRepeaters: '0',
  getBulkMaxRepetitions: '20',
  community: '',
  user: '',
  level: 'authPriv',
  authProtocol: 'sha256',
  authKey: '',
  privProtocol: 'aes',
  privKey: '',
  context: '',
  contextEngineId: '',
};

export function editAgentProfile(profile: AgentProfile): AgentEditorState {
  return {
    ...EMPTY_AGENT_EDITOR,
    name: profile.name,
    host: profile.host,
    port: String(profile.port),
    transport: profile.transport,
    version: profile.version,
    timeoutMs: String(profile.timeoutMs),
    retries: String(profile.retries),
    getBulkNonRepeaters: String(profile.getBulkNonRepeaters),
    getBulkMaxRepetitions: String(profile.getBulkMaxRepetitions),
    user: profile.v3?.user ?? '',
    level: profile.v3?.level ?? 'authPriv',
    authProtocol: profile.v3?.authProtocol ?? 'sha256',
    privProtocol: profile.v3?.privProtocol ?? 'aes',
    context: profile.v3?.context ?? '',
    contextEngineId: profile.v3?.contextEngineId ?? '',
  };
}

export function agentDraftFromEditor(editor: AgentEditorState): AgentCreateDraft {
  const v3: AgentV3Input | undefined =
    editor.version === 'v3'
      ? {
          user: editor.user,
          level: editor.level,
          ...(editor.level !== 'noAuthNoPriv' ? { authProtocol: editor.authProtocol } : {}),
          ...(editor.level === 'authPriv' ? { privProtocol: editor.privProtocol } : {}),
          ...(editor.context ? { context: editor.context } : {}),
          ...(editor.contextEngineId ? { contextEngineId: editor.contextEngineId } : {}),
        }
      : undefined;
  return {
    profile: {
      name: editor.name,
      host: editor.host,
      port: Number(editor.port) || 161,
      transport: editor.transport,
      version: editor.version,
      timeoutMs: Number(editor.timeoutMs) || 5_000,
      retries: Math.max(0, Number(editor.retries) || 0),
      getBulkNonRepeaters: Math.max(0, Number(editor.getBulkNonRepeaters) || 0),
      getBulkMaxRepetitions: Math.max(1, Number(editor.getBulkMaxRepetitions) || 20),
    },
    ...(v3 ? { v3 } : {}),
    secrets:
      editor.version === 'v3'
        ? {
            ...(editor.level !== 'noAuthNoPriv' && editor.authKey
              ? { authKey: editor.authKey }
              : {}),
            ...(editor.level === 'authPriv' && editor.privKey
              ? { privKey: editor.privKey }
              : {}),
          }
        : editor.community
          ? { community: editor.community }
          : {},
  };
}
