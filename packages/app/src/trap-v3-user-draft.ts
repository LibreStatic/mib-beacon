import type {
  AuthProtocol,
  PrivProtocol,
  SecurityLevel,
  TrapV3UserDraft,
} from '@mibbeacon/core/client';

export type TrapCredentialIntent = 'retain' | 'replace' | 'clear';

export interface TrapV3UserDraftInput {
  name: string;
  level: SecurityLevel;
  authProtocol: AuthProtocol;
  privProtocol: PrivProtocol;
  authIntent: TrapCredentialIntent;
  privIntent: TrapCredentialIntent;
  authKey: string;
  privKey: string;
  hasAuthKey?: boolean;
  hasPrivKey?: boolean;
}

/** Converts explicit credential controls into the write-only engine contract. */
export function buildTrapV3UserDraft(input: TrapV3UserDraftInput): TrapV3UserDraft {
  const authKeyPresent = Boolean(input.authKey.trim());
  const privKeyPresent = Boolean(input.privKey.trim());
  if (input.level !== 'noAuthNoPriv' && input.authIntent === 'replace' && !authKeyPresent)
    throw new Error('Enter an authentication replacement key');
  if (input.level === 'authPriv' && input.privIntent === 'replace' && !privKeyPresent)
    throw new Error('Enter a privacy replacement key');
  if (
    input.level !== 'noAuthNoPriv' &&
    (input.authIntent === 'clear' || (input.authIntent === 'retain' && !input.hasAuthKey))
  )
    throw new Error('This security level requires an authentication key; choose Replace');
  if (
    input.level === 'authPriv' &&
    (input.privIntent === 'clear' || (input.privIntent === 'retain' && !input.hasPrivKey))
  )
    throw new Error('This security level requires a privacy key; choose Replace');
  return {
    name: input.name,
    level: input.level,
    ...(input.level === 'noAuthNoPriv' ? {} : { authProtocol: input.authProtocol }),
    ...(input.level === 'authPriv' ? { privProtocol: input.privProtocol } : {}),
    ...(input.level !== 'noAuthNoPriv' && input.authIntent === 'replace'
      ? { authKey: input.authKey }
      : input.authIntent === 'clear'
        ? { clearAuthKey: true }
        : {}),
    ...(input.level === 'authPriv' && input.privIntent === 'replace'
      ? { privKey: input.privKey }
      : input.privIntent === 'clear'
        ? { clearPrivKey: true }
        : {}),
  };
}
