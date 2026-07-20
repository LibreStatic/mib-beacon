import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSocket } from 'node:dgram';
import { createNodeTransport } from '@mibbeacon/transport/node';
import { createEngine } from './engine';
import type { DecodedVarbind, SnmpVarbindInput } from './snmp/types';

const LIVE_MIB = `LIVE-TEST-MIB DEFINITIONS ::= BEGIN
IMPORTS enterprises, OBJECT-TYPE FROM SNMPv2-SMI;
liveRoot OBJECT IDENTIFIER ::= { enterprises 99123 }
liveWritable OBJECT-TYPE
  SYNTAX Integer32 (0..10)
  MAX-ACCESS read-write
  STATUS current
  ::= { liveRoot 1 }
liveReadOnly OBJECT-TYPE
  SYNTAX OCTET STRING (SIZE (0..32))
  MAX-ACCESS read-only
  STATUS current
  ::= { liveRoot 2 }
END`;

const varbind = (oid: string, value: string | number): DecodedVarbind => ({
  oid,
  type: 2,
  typeName: 'Integer',
  value,
  rawValue: value,
  isError: false,
});

async function engineFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'mibbeacon-live-mibs-'));
  return {
    directory,
    engine: createEngine(createNodeTransport({ dataDir: directory }), {
      dbPath: join(directory, 'mibbeacon.db'),
    }),
  };
}

describe('live MIB engine API', () => {
  it('persists safe global settings and independent per-agent overrides', async () => {
    const { engine } = await engineFixture();
    await expect(engine.liveMibs.settings.get()).resolves.toMatchObject({
      scanConcurrency: 1,
      showReadOnly: false,
      writeMode: 'confirm',
    });
    await engine.liveMibs.settings.update({ scanConcurrency: 99, refreshIntervalMs: 100 });
    await expect(engine.liveMibs.settings.get()).resolves.toMatchObject({
      scanConcurrency: 8,
      refreshIntervalMs: 500,
    });

    await engine.liveMibs.agentOverrides.update('agent-a', {
      scanConcurrency: 2,
      showReadOnly: true,
    });
    await expect(engine.liveMibs.agentOverrides.get('agent-a')).resolves.toEqual({
      scanConcurrency: 2,
      showReadOnly: true,
    });
    await engine.liveMibs.agentOverrides.reset('agent-a');
    await expect(engine.liveMibs.agentOverrides.get('agent-a')).resolves.toBeNull();
  });

  it('stages uploads in ordered chunks and verifies the completed size', async () => {
    const { engine } = await engineFixture();
    const upload = await engine.liveMibs.uploads.create({
      name: 'firmware.bin',
      byteLength: 4,
    });
    await engine.liveMibs.uploads.append(upload.id, 0, 'AQI=');
    await expect(engine.liveMibs.uploads.append(upload.id, 1, 'AwQ=')).rejects.toThrow(
      /offset/i,
    );
    await engine.liveMibs.uploads.append(upload.id, 2, 'AwQ=');
    await expect(engine.liveMibs.uploads.complete(upload.id)).resolves.toMatchObject({
      name: 'firmware.bin',
      byteLength: 4,
      state: 'ready',
    });
    await engine.liveMibs.uploads.dispose(upload.id);
    await expect(engine.liveMibs.uploads.status(upload.id)).resolves.toBeNull();
  });

  it('applies a saved agent upload-size override when staging a file', async () => {
    const { engine } = await engineFixture();
    await engine.liveMibs.settings.update({ maximumUploadBytes: 2 });
    await engine.liveMibs.agentOverrides.update('agent-large-upload', {
      maximumUploadBytes: 8,
    });
    await expect(
      engine.liveMibs.uploads.create({ name: 'global.bin', byteLength: 4 }),
    ).rejects.toThrow(/2-byte limit/);
    await expect(
      engine.liveMibs.uploads.create({
        name: 'agent.bin',
        byteLength: 4,
        agentId: 'agent-large-upload',
      }),
    ).resolves.toMatchObject({ byteLength: 4 });
  });

  it('detects direct, block-stream, and Cisco transfer-control workflows', async () => {
    const { engine } = await engineFixture();
    await expect(
      engine.liveMibs.workflows.detect({
        syntax: 'OCTET STRING (SIZE 0..1024)',
        textualConventionChain: [],
        module: 'VENDOR-UPGRADE-MIB',
        name: 'firmwareBlock',
      }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'direct-binary' }),
        expect.objectContaining({ id: 'timed-block-stream' }),
      ]),
    );
    await expect(
      engine.liveMibs.workflows.detect({
        syntax: 'DisplayString',
        textualConventionChain: [],
        module: 'CISCO-FLASH-MIB',
        name: 'ciscoFlashCopySourceName',
      }),
    ).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'cisco-transfer-control' })]),
    );
  });

  it('streams a writable-only scan and reports terminal status', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mibbeacon-live-scan-'));
    const requested: string[][] = [];
    const engine = createEngine(createNodeTransport({ dataDir: directory }), {
      dbPath: join(directory, 'mibbeacon.db'),
      agentTester: async (_agent, oids) => {
        requested.push(oids);
        return oids.map((oid) => varbind(oid, 3));
      },
    });
    await engine.mibs.importTexts([{ name: 'LIVE-TEST-MIB', content: LIVE_MIB }]);
    const events: string[] = [];
    engine.events.subscribe('live-mibs', (event) => events.push(event.kind));
    const { handleId } = await engine.liveMibs.scan.start({
      agent: { host: '127.0.0.1', version: 'v2c', community: 'public' },
      scopeOid: '1.3.6.1.4.1.99123',
      concurrency: 1,
      includeReadOnly: false,
    });
    const terminal = await waitForLiveScan(engine, handleId);
    expect(terminal).toMatchObject({ state: 'done', count: 1, taskCount: 1 });
    expect(requested).toEqual([['1.3.6.1.4.1.99123.1.0']]);
    expect(events).toEqual(expect.arrayContaining(['started', 'batch', 'done']));
  });

  it('schedules adaptive preferred scalar instances before the rest of the scope', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mibbeacon-live-preferred-'));
    const requested: string[][] = [];
    const engine = createEngine(createNodeTransport({ dataDir: directory }), {
      dbPath: join(directory, 'mibbeacon.db'),
      agentTester: async (_agent, oids) => {
        requested.push(oids);
        return oids.map((oid) => varbind(oid, 3));
      },
    });
    await engine.mibs.importTexts([{ name: 'LIVE-TEST-MIB', content: LIVE_MIB }]);
    const { handleId } = await engine.liveMibs.scan.start({
      agent: { host: '127.0.0.1', version: 'v2c', community: 'public' },
      scopeOid: '1.3.6.1.4.1.99123',
      concurrency: 1,
      includeReadOnly: true,
      preferredOids: ['1.3.6.1.4.1.99123.2.0'],
    });
    await waitForLiveScan(engine, handleId);
    expect(requested[0]).toEqual(['1.3.6.1.4.1.99123.2.0']);
  });

  it('sets and verifies a cell while returning the authoritative value', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mibbeacon-live-write-'));
    const sets: SnmpVarbindInput[][] = [];
    const engine = createEngine(createNodeTransport({ dataDir: directory }), {
      dbPath: join(directory, 'mibbeacon.db'),
      agentTester: async (_agent, oids) => oids.map((oid) => varbind(oid, 7)),
      agentSetter: async (_agent, varbinds) => {
        sets.push(varbinds);
        return varbinds.map((input) => varbind(input.oid, Number(input.value)));
      },
    });
    const result = await engine.liveMibs.writeCell({
      agent: { host: '127.0.0.1', version: 'v2c', community: 'private' },
      varbind: { oid: '1.3.6.1.4.1.99123.1.0', type: 'Integer', value: '7' },
      verify: true,
    });
    expect(sets).toHaveLength(1);
    expect(result).toMatchObject({
      verified: true,
      value: expect.objectContaining({ oid: '1.3.6.1.4.1.99123.1.0', value: 7 }),
    });
  });

  it('rejects a Set when authoritative read-back differs from the requested value', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mibbeacon-live-mismatch-'));
    const engine = createEngine(createNodeTransport({ dataDir: directory }), {
      dbPath: join(directory, 'mibbeacon.db'),
      agentTester: async (_agent, oids) => oids.map((oid) => varbind(oid, 6)),
      agentSetter: async (_agent, varbinds) =>
        varbinds.map((input) => varbind(input.oid, Number(input.value))),
    });
    await expect(
      engine.liveMibs.writeCell({
        agent: { host: '127.0.0.1', version: 'v2c', community: 'private' },
        varbind: { oid: '1.3.6.1.4.1.99123.1.0', type: 'Integer', value: '7' },
        verify: true,
      }),
    ).rejects.toThrow(/read-back.*6.*requested.*7/i);
  });

  it('rejects a Set outside structured MIB constraints before contacting the agent', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mibbeacon-live-constraint-'));
    let setCalls = 0;
    const engine = createEngine(createNodeTransport({ dataDir: directory }), {
      dbPath: join(directory, 'mibbeacon.db'),
      agentSetter: async () => {
        setCalls += 1;
        return [];
      },
    });
    await engine.mibs.importTexts([{ name: 'LIVE-TEST-MIB', content: LIVE_MIB }]);
    await expect(
      engine.liveMibs.writeCell({
        agent: { host: '127.0.0.1', version: 'v2c', community: 'private' },
        varbind: { oid: '1.3.6.1.4.1.99123.1.0', type: 'Integer', value: '99' },
      }),
    ).rejects.toThrow(/0\.\.10/);
    expect(setCalls).toBe(0);
  });

  it('runs a direct binary workflow from staged bytes without exposing a file path', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mibbeacon-live-workflow-'));
    const sets: SnmpVarbindInput[][] = [];
    const engine = createEngine(createNodeTransport({ dataDir: directory }), {
      dbPath: join(directory, 'mibbeacon.db'),
      agentSetter: async (_agent, varbinds) => {
        sets.push(varbinds);
        return varbinds.map((input) => varbind(input.oid, input.value));
      },
    });
    await engine.liveMibs.settings.update({ maximumUploadBytes: 1_024 });
    const upload = await engine.liveMibs.uploads.create({ name: 'image.bin', byteLength: 4 });
    await engine.liveMibs.uploads.append(upload.id, 0, '3q2+7w==');
    await engine.liveMibs.uploads.complete(upload.id);
    const { handleId } = await engine.liveMibs.workflows.start({
      adapterId: 'direct-binary',
      uploadId: upload.id,
      agent: { host: '127.0.0.1', version: 'v2c', community: 'private' },
      direct: { oid: '1.3.6.1.4.1.99123.9.0', type: 'OctetString' },
    });
    const status = await waitForWorkflow(engine, handleId);
    expect(status).toMatchObject({ state: 'done', sentBytes: 4, totalBytes: 4 });
    expect(sets).toEqual([
      [
        {
          oid: '1.3.6.1.4.1.99123.9.0',
          type: 'OctetString',
          value: 'deadbeef',
          encoding: 'hex',
        },
      ],
    ]);
    expect(JSON.stringify(status)).not.toContain(directory);
  });

  it('serves staged bytes through an opt-in managed Cisco TFTP workflow', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mibbeacon-live-tftp-'));
    const engine = createEngine(createNodeTransport({ dataDir: directory }), {
      dbPath: join(directory, 'mibbeacon.db'),
      agentSetter: async (_agent, varbinds) =>
        varbinds.map((input) => varbind(input.oid, input.value)),
    });
    await engine.liveMibs.settings.update({
      managedTransfersEnabled: true,
      maximumUploadBytes: 1_024,
    });
    const upload = await engine.liveMibs.uploads.create({ name: 'image.bin', byteLength: 4 });
    await engine.liveMibs.uploads.append(upload.id, 0, '3q2+7w==');
    await engine.liveMibs.uploads.complete(upload.id);
    const { handleId } = await engine.liveMibs.workflows.start({
      adapterId: 'cisco-transfer-control',
      uploadId: upload.id,
      agent: { host: '127.0.0.1', version: 'v2c', community: 'private' },
      controlVarbinds: [
        { oid: '1.3.6.1.4.1.99123.10.0', type: 'Integer', value: '4' },
      ],
      managedTransfer: { bindAddress: '127.0.0.1', port: 0, timeoutMs: 2_000 },
    });
    const serving = await waitForWorkflowMessage(engine, handleId, /TFTP.*:(\d+)$/);
    const port = Number(serving.message!.match(/:(\d+)$/)![1]);
    const client = createSocket('udp4');
    const payload = await new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('TFTP fixture timed out')), 1_000);
      client.on('message', (message) => {
        clearTimeout(timer);
        const block = message.readUInt16BE(2);
        const ack = Buffer.from([0, 4, (block >> 8) & 0xff, block & 0xff]);
        client.send(ack, port, '127.0.0.1');
        resolve(message.subarray(4));
      });
      client.send(
        Buffer.concat([
          Buffer.from([0, 1]),
          Buffer.from('image.bin\0octet\0', 'ascii'),
        ]),
        port,
        '127.0.0.1',
      );
    });
    client.close();
    expect(payload.toString('hex')).toBe('deadbeef');
    await expect(waitForWorkflow(engine, handleId)).resolves.toMatchObject({
      state: 'done',
      sentBytes: 4,
    });
  });
});

async function waitForLiveScan(
  engine: ReturnType<typeof createEngine>,
  handleId: string,
) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const status = await engine.liveMibs.scan.status(handleId);
    if (status && ['done', 'partial', 'error', 'cancelled'].includes(status.state)) return status;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('live scan did not finish');
}

async function waitForWorkflow(
  engine: ReturnType<typeof createEngine>,
  handleId: string,
) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const status = await engine.liveMibs.workflows.status(handleId);
    if (status && ['done', 'error', 'cancelled'].includes(status.state)) return status;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('live workflow did not finish');
}

async function waitForWorkflowMessage(
  engine: ReturnType<typeof createEngine>,
  handleId: string,
  pattern: RegExp,
) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const status = await engine.liveMibs.workflows.status(handleId);
    if (status?.message && pattern.test(status.message)) return status;
    if (status?.state === 'error') throw new Error(status.message);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('workflow message did not appear');
}
