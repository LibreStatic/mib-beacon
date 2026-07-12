import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as NetSnmp from 'net-snmp';

const fake = vi.hoisted(() => ({
  set: vi.fn(),
  trap: vi.fn(),
  inform: vi.fn(),
  close: vi.fn(),
  on: vi.fn(),
}));

vi.mock('net-snmp', async (importOriginal) => {
  const original = await importOriginal<typeof NetSnmp>();
  return {
    ...original,
    default: {
      ...original.default,
      createSession: vi.fn(() => fake),
    },
  };
});

import snmp from 'net-snmp';
import { SnmpSession } from './session';

describe('SnmpSession.set', () => {
  beforeEach(() => vi.clearAllMocks());

  it('encodes typed inputs and decodes the response', async () => {
    fake.set.mockImplementation((varbinds, cb) => cb(null, varbinds));
    const session = new SnmpSession({ host: '127.0.0.1', version: 'v2c', community: 'private' });

    const result = await session.set([
      { oid: '1.3.6.1.2.1.1.5.0', type: 'OctetString', value: 'edge-router' },
    ]);

    expect(fake.set).toHaveBeenCalledWith(
      [{ oid: '1.3.6.1.2.1.1.5.0', type: snmp.ObjectType.OctetString, value: 'edge-router' }],
      expect.any(Function),
    );
    expect(result[0]).toMatchObject({
      oid: '1.3.6.1.2.1.1.5.0',
      value: 'edge-router',
      isError: false,
    });
  });
});

describe('SnmpSession.sendNotification', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends a v2 trap with typed payload and options', async () => {
    fake.trap.mockImplementation((_oid, _varbinds, _options, cb) => cb(null));
    const session = new SnmpSession({
      host: '127.0.0.1',
      port: 1162,
      version: 'v2c',
      community: 'public',
    });

    expect(snmp.createSession).toHaveBeenCalledWith(
      '127.0.0.1',
      'public',
      expect.objectContaining({ port: 1162, trapPort: 1162 }),
    );

    const result = await session.sendNotification({
      kind: 'trap',
      trapOid: '1.3.6.1.6.3.1.1.5.3',
      upTime: 123,
      varbinds: [{ oid: '1.3.6.1.2.1.2.2.1.1.7', type: 'Integer', value: '7' }],
    });

    expect(fake.trap).toHaveBeenCalledWith(
      '1.3.6.1.6.3.1.1.5.3',
      [{ oid: '1.3.6.1.2.1.2.2.1.1.7', type: snmp.ObjectType.Integer, value: 7 }],
      { upTime: 123 },
      expect.any(Function),
    );
    expect(result).toMatchObject({ kind: 'trap', acknowledged: false });
  });

  it('maps standard notification OIDs to generic v1 trap types', async () => {
    fake.trap.mockImplementation((_type, _varbinds, _options, cb) => cb(null));
    const session = new SnmpSession({ host: '127.0.0.1', version: 'v1', community: 'public' });
    await session.sendNotification({
      kind: 'trap',
      trapOid: '1.3.6.1.6.3.1.1.5.1',
      varbinds: [],
    });
    expect(fake.trap).toHaveBeenCalledWith(snmp.TrapType.ColdStart, [], {}, expect.any(Function));
  });

  it('reports an inform acknowledgement and rejects informs over v1', async () => {
    fake.inform.mockImplementation((_oid, varbinds, _options, cb) => cb(null, varbinds));
    const v2 = new SnmpSession({ host: '127.0.0.1', version: 'v2c', community: 'public' });
    await expect(
      v2.sendNotification({ kind: 'inform', trapOid: '1.3.6.1.6.3.1.1.5.1', varbinds: [] }),
    ).resolves.toMatchObject({ kind: 'inform', acknowledged: true, responseVarbinds: [] });

    const v1 = new SnmpSession({ host: '127.0.0.1', version: 'v1', community: 'public' });
    await expect(
      v1.sendNotification({ kind: 'inform', trapOid: '1.3.6.1.6.3.1.1.5.1', varbinds: [] }),
    ).rejects.toMatchObject({ code: 'REQ_FAILED' });
  });

  it('rejects an invalid notification uptime before sending', async () => {
    const session = new SnmpSession({ host: '127.0.0.1', version: 'v2c', community: 'public' });
    await expect(
      session.sendNotification({
        kind: 'trap',
        trapOid: '1.3.6.1.6.3.1.1.5.1',
        upTime: -1,
        varbinds: [],
      }),
    ).rejects.toThrow(/uptime/i);
    expect(fake.trap).not.toHaveBeenCalled();
  });

  it('rejects a malformed v1 agent address before sending', async () => {
    const session = new SnmpSession({ host: '127.0.0.1', version: 'v1', community: 'public' });
    await expect(
      session.sendNotification({
        kind: 'trap',
        trapOid: '1.3.6.1.6.3.1.1.5.1',
        agentAddress: '999.hello.1',
        varbinds: [],
      }),
    ).rejects.toThrow(/agent address/i);
    expect(fake.trap).not.toHaveBeenCalled();
  });
});
