import { describe, expect, it } from 'vitest';
import { buildTrapV3UserDraft } from './trap-v3-user-draft';

const base = {
  name: 'operator',
  level: 'authPriv' as const,
  authProtocol: 'sha256' as const,
  privProtocol: 'aes256r' as const,
  hasAuthKey: true,
  hasPrivKey: true,
};

describe('buildTrapV3UserDraft', () => {
  it('keeps stored credentials without publishing secret fields', () => {
    expect(
      buildTrapV3UserDraft({
        ...base,
        authIntent: 'retain',
        privIntent: 'retain',
        authKey: 'ignored',
        privKey: 'ignored',
      }),
    ).toEqual({
      name: base.name,
      level: base.level,
      authProtocol: base.authProtocol,
      privProtocol: base.privProtocol,
    });
  });

  it('publishes only explicitly replaced credentials', () => {
    expect(
      buildTrapV3UserDraft({
        ...base,
        authIntent: 'replace',
        privIntent: 'replace',
        authKey: 'new-auth',
        privKey: 'new-priv',
      }),
    ).toEqual({
      name: base.name,
      level: base.level,
      authProtocol: base.authProtocol,
      privProtocol: base.privProtocol,
      authKey: 'new-auth',
      privKey: 'new-priv',
    });
  });

  it('preserves replacement secret bytes after nonblank validation', () => {
    expect(
      buildTrapV3UserDraft({
        ...base,
        authIntent: 'replace',
        privIntent: 'replace',
        authKey: '  exact auth  ',
        privKey: '\texact priv\n',
      }),
    ).toMatchObject({ authKey: '  exact auth  ', privKey: '\texact priv\n' });
  });

  it('publishes explicit clears during a security downgrade', () => {
    expect(
      buildTrapV3UserDraft({
        ...base,
        level: 'noAuthNoPriv',
        authIntent: 'clear',
        privIntent: 'clear',
        authKey: '',
        privKey: '',
      }),
    ).toEqual({
      name: base.name,
      level: 'noAuthNoPriv',
      clearAuthKey: true,
      clearPrivKey: true,
    });
  });

  it('omits irrelevant privacy protocol for authNoPriv', () => {
    expect(
      buildTrapV3UserDraft({
        ...base,
        level: 'authNoPriv',
        authIntent: 'retain',
        privIntent: 'retain',
        authKey: '',
        privKey: '',
      }),
    ).toEqual({ name: base.name, level: 'authNoPriv', authProtocol: base.authProtocol });
  });

  it('omits irrelevant replacement credentials below their required levels', () => {
    expect(
      buildTrapV3UserDraft({
        ...base,
        level: 'noAuthNoPriv',
        authIntent: 'replace',
        privIntent: 'replace',
        authKey: '',
        privKey: '',
      }),
    ).toEqual({ name: base.name, level: 'noAuthNoPriv' });
  });

  it.each([
    ['authNoPriv', 'retain', false, 'retain', false, 'authentication'],
    ['authNoPriv', 'clear', true, 'retain', false, 'authentication'],
    ['authPriv', 'retain', true, 'retain', false, 'privacy'],
    ['authPriv', 'retain', true, 'clear', true, 'privacy'],
  ] as const)(
    'rejects invalid required credential intent for %s',
    (level, authIntent, hasAuthKey, privIntent, hasPrivKey, expected) => {
      expect(() =>
        buildTrapV3UserDraft({
          ...base,
          level,
          authIntent,
          privIntent,
          hasAuthKey,
          hasPrivKey,
          authKey: '',
          privKey: '',
        }),
      ).toThrow(expected);
    },
  );

  it('rejects blank replacement credentials', () => {
    expect(() =>
      buildTrapV3UserDraft({
        ...base,
        authIntent: 'replace',
        privIntent: 'retain',
        authKey: ' ',
        privKey: '',
      }),
    ).toThrow('replacement');
  });
});
