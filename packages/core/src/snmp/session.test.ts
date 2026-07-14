import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as NetSnmp from 'net-snmp';

const fake = vi.hoisted(() => ({
  getBulk: vi.fn(),
  subtree: vi.fn(),
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

  it('maps a multi-Set error back to the offending staged row', async () => {
    fake.set.mockImplementation((_varbinds, callback) => {
      const error = Object.assign(
        new Error('notWritable: 1.3.6.1.2.1.1.6.0'),
        { name: 'RequestFailedError' },
      );
      callback(error);
    });
    const session = new SnmpSession({ host: '127.0.0.1', version: 'v2c' });
    await expect(
      session.set([
        { oid: '1.3.6.1.2.1.1.5.0', type: 'OctetString', value: 'name' },
        { oid: '1.3.6.1.2.1.1.6.0', type: 'OctetString', value: 'location' },
      ]),
    ).rejects.toMatchObject({
      code: 'SET_NOT_WRITABLE',
      details: { errorIndex: 2, oid: '1.3.6.1.2.1.1.6.0' },
    });
  });
});

describe('SnmpSession bulk and walk guards', () => {
  beforeEach(() => vi.clearAllMocks());

  it('runs GetBulk with explicit sizing and decodes every returned varbind', async () => {
    fake.getBulk.mockImplementation((_oids, _nonRepeaters, _maxRepetitions, callback) =>
      callback(null, [
        { oid: '1.3.6.1.2.1.1.1.0', type: snmp.ObjectType.Integer, value: 7 },
      ]),
    );
    const session = new SnmpSession({ host: '127.0.0.1', version: 'v2c' });

    await expect(session.getBulk(['1.3.6.1.2.1'], 1, 25)).resolves.toMatchObject([
      { oid: '1.3.6.1.2.1.1.1.0', value: 7 },
    ]);
    expect(fake.getBulk).toHaveBeenCalledWith(
      ['1.3.6.1.2.1'],
      1,
      25,
      expect.any(Function),
    );
  });

  it('rejects non-increasing and over-cap walk feeds with actionable codes', async () => {
    fake.subtree.mockImplementation((_oid, _maxRepetitions, feed, done) => {
      feed([
        { oid: '1.3.6.1.2', type: snmp.ObjectType.Integer, value: 1 },
        { oid: '1.3.6.1.1', type: snmp.ObjectType.Integer, value: 2 },
      ]);
      done(null);
    });
    const nonIncreasing = new SnmpSession({ host: '127.0.0.1', version: 'v2c' });
    await expect(nonIncreasing.walk('1.3.6', () => undefined)).rejects.toMatchObject({
      code: 'REQ_OID_NOT_INCREASING',
    });

    fake.subtree.mockImplementation((_oid, _maxRepetitions, feed, done) => {
      feed([
        { oid: '1.3.6.1.1', type: snmp.ObjectType.Integer, value: 1 },
        { oid: '1.3.6.1.2', type: snmp.ObjectType.Integer, value: 2 },
      ]);
      done(null);
    });
    const capped = new SnmpSession({ host: '127.0.0.1', version: 'v2c' });
    await expect(
      capped.walk('1.3.6', () => undefined, { maxVarbinds: 1 }),
    ).rejects.toThrow(/hard cap.*1/i);
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

  it('supplies uptime without relying on a host process.uptime implementation', async () => {
    fake.trap.mockImplementation((_oid, _varbinds, _options, cb) => cb(null));
    const session = new SnmpSession({
      host: '127.0.0.1',
      version: 'v2c',
      community: 'public',
    });

    await session.sendNotification({
      kind: 'trap',
      trapOid: '1.3.6.1.6.3.1.1.5.1',
      varbinds: [],
    });

    expect(fake.trap).toHaveBeenCalledWith(
      '1.3.6.1.6.3.1.1.5.1',
      [],
      { upTime: expect.any(Number) },
      expect.any(Function),
    );
    expect(fake.trap.mock.calls[0]?.[2].upTime).toBeGreaterThan(0);
  });

  it('maps standard notification OIDs to generic v1 trap types', async () => {
    fake.trap.mockImplementation((_type, _varbinds, _options, cb) => cb(null));
    const session = new SnmpSession({ host: '127.0.0.1', version: 'v1', community: 'public' });
    await session.sendNotification({
      kind: 'trap',
      trapOid: '1.3.6.1.6.3.1.1.5.1',
      varbinds: [],
    });
    expect(fake.trap).toHaveBeenCalledWith(
      snmp.TrapType.ColdStart,
      [],
      { upTime: expect.any(Number) },
      expect.any(Function),
    );
  });

  it('maps v2-form enterprise notification OIDs and explicit v1 envelope fields', async () => {
    fake.trap.mockImplementation((_type, _varbinds, _options, cb) => cb(null));
    const session = new SnmpSession({ host: '127.0.0.1', version: 'v1', community: 'public' });
    await session.sendNotification({
      kind: 'trap',
      trapOid: '1.3.6.1.4.1.9.0.42',
      varbinds: [],
    });
    expect(fake.trap).toHaveBeenLastCalledWith(
      '1.3.6.1.4.1.9.42',
      [],
      { upTime: expect.any(Number) },
      expect.any(Function),
    );

    await session.sendNotification({
      kind: 'trap',
      trapOid: '1.3.6.1.4.1.9.0.99',
      v1Enterprise: '1.3.6.1.4.1.9',
      v1Generic: 6,
      v1Specific: 99,
      varbinds: [],
    });
    expect(fake.trap).toHaveBeenLastCalledWith(
      '1.3.6.1.4.1.9.99',
      [],
      { upTime: expect.any(Number) },
      expect.any(Function),
    );
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
