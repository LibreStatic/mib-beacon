/**
 * Engine-level feasibility spike (docs/plans/02 §Spike). Drives the REAL engine
 * (createEngine + Node transport) against the dev snmpd container, covering
 * S1 (v2c Get), S2 (v3 crypto matrix incl. DES + AES-256 interop), S4 (trap
 * receive), S5 (streaming walk). S3 (on-device RN) is hardware-bound and run
 * separately via apps/mobile.
 *
 * Run:  docker compose -f dev/snmpd/docker-compose.yml up -d --build
 *       pnpm --filter @mibbeacon/core spike
 * Env overrides: MIB_BEACON_SPIKE_HOST (default 127.0.0.1), MIB_BEACON_SPIKE_PORT (1611),
 *                MIB_BEACON_SPIKE_TRAP_PORT (1162).
 */
import { spawnSync } from 'node:child_process';
import { createNodeTransport } from '@mibbeacon/transport/node';
import { createEngine } from '../index';
import type { AgentSpec, AuthProtocol, PrivProtocol } from '../snmp/types';

const HOST = process.env.MIB_BEACON_SPIKE_HOST ?? '127.0.0.1';
const PORT = Number(process.env.MIB_BEACON_SPIKE_PORT ?? 1611);
const TRAP_PORT = Number(process.env.MIB_BEACON_SPIKE_TRAP_PORT ?? 1162);
const SYS_DESCR = '1.3.6.1.2.1.1.1.0';

let pass = 0;
let fail = 0;
const line = (s: string) => console.log(s);
const ok = (label: string, detail = '') => {
  pass++;
  line(`  ✅ ${label}${detail ? ' — ' + detail : ''}`);
};
const bad = (label: string, detail = '') => {
  fail++;
  line(`  ❌ ${label}${detail ? ' — ' + detail : ''}`);
};
const warn = (label: string, detail = '') => {
  line(`  ⚠️  ${label}${detail ? ' — ' + detail : ''}`);
};

async function main() {
  const transport = createNodeTransport({ dataDir: '/tmp/mibbeacon-spike' });
  const engine = createEngine(transport, { dbPath: ':memory:' });

  const info = await engine.system.info();
  line('\n=== Engine info ===');
  line(`  platform=${info.platform} engine=${info.engineVersion} net-snmp=${info.netSnmpVersion}`);
  line(`  ciphers: des-cbc=${info.ciphers.des} aes-128-cfb=${info.ciphers.aes128} aes-256-cfb=${info.ciphers.aes256}`);

  // --- S1: v2c Get ---
  line('\n=== S1: v2c Get sysDescr ===');
  const v2c: AgentSpec = { host: HOST, port: PORT, version: 'v2c', community: 'public' };
  try {
    const [vb] = await engine.ops.get({ agent: v2c, oids: [SYS_DESCR] });
    if (vb && !vb.isError) ok('v2c Get', `${vb.typeName}="${vb.value}"`);
    else bad('v2c Get', vb?.errorText ?? 'no varbind');
  } catch (e) {
    bad('v2c Get', String(e));
  }

  // --- S2: v3 crypto matrix ---
  line('\n=== S2: v3 crypto matrix ===');
  const v3 = (
    user: string,
    authProtocol: AuthProtocol,
    authKey: string,
    privProtocol: PrivProtocol,
    privKey: string,
  ): AgentSpec => ({
    host: HOST,
    port: PORT,
    version: 'v3',
    v3: { user, level: 'authPriv', authProtocol, authKey, privProtocol, privKey },
  });

  const v3Cases: Array<{ label: string; spec: AgentSpec }> = [
    { label: 'SHA-256/AES-128', spec: v3('spike_sha256_aes128', 'sha256', 'authpass_sha256', 'aes', 'privpass_aes128') },
    { label: 'MD5/DES', spec: v3('spike_md5_des', 'md5', 'authpass_md5xxx', 'des', 'privpass_desxxx') },
    // net-snmp "AES-256" variant is ambiguous (Blumenthal vs Reeder) — try both.
    { label: 'SHA-512/AES-256(blumenthal)', spec: v3('spike_sha512_aes256', 'sha512', 'authpass_sha512', 'aes256b', 'privpass_aes256') },
    { label: 'SHA-512/AES-256(reeder)', spec: v3('spike_sha512_aes256', 'sha512', 'authpass_sha512', 'aes256r', 'privpass_aes256') },
  ];
  for (const c of v3Cases) {
    try {
      const [vb] = await engine.ops.get({ agent: c.spec, oids: [SYS_DESCR] });
      if (vb && !vb.isError) ok(`v3 ${c.label}`, `value="${vb.value}"`);
      else bad(`v3 ${c.label}`, vb?.errorText ?? 'no varbind');
    } catch (e) {
      const err = e as { code?: string; message?: string; hint?: string };
      const detail = `${err.code ?? ''} ${err.message ?? String(e)}`;
      // DES: OpenSSL 3 / BoringSSL do not enable DES by default. Accepted
      // limitation (DES deprecated since RFC 7860, 2014). Not a spike failure.
      if (c.label === 'MD5/DES' && !info.ciphers.des) {
        warn(`v3 ${c.label}`, `unavailable without DES cipher (accepted limitation): ${detail.trim()}`);
      } else {
        bad(`v3 ${c.label}`, `${detail}${err.hint ? ' | hint: ' + err.hint : ''}`);
      }
    }
  }

  // --- S4: trap receive ---
  line('\n=== S4: trap receive ===');
  try {
    await engine.traps.startReceiver({ port: TRAP_PORT, disableAuthorization: true, communities: ['public'] });
    // node-net-snmp binds the receiver socket asynchronously; give it a moment
    // before we fire a (blocking) snmptrap. (Plan 05: make startReceiver await bind.)
    await new Promise((r) => setTimeout(r, 400));
    const got = new Promise<boolean>((resolve) => {
      const unsub = engine.events.subscribe('traps', (e) => {
        if (e.kind === 'trap') {
          unsub();
          resolve(true);
        }
      });
      setTimeout(() => {
        unsub();
        resolve(false);
      }, 4000);
    });
    const r = spawnSync('snmptrap', [
      '-v2c', '-c', 'public', `${HOST}:${TRAP_PORT}`, '', '1.3.6.1.6.3.1.1.5.1',
      SYS_DESCR, 's', 'spike-trap',
    ]);
    if (r.error) bad('snmptrap CLI', String(r.error));
    const received = await got;
    if (received) {
      const list = await engine.traps.list();
      ok('trap received + decoded', `${list.length} in store, first varbinds=${list[0]?.varbinds.length ?? 0}`);
    } else {
      bad('trap receive', 'no trap within 4s');
    }
    await engine.traps.stopReceiver();
  } catch (e) {
    bad('trap receiver', String(e));
  }

  // --- S5: streaming walk perf ---
  line('\n=== S5: streaming walk of 1.3.6.1.2.1 ===');
  try {
    let batches = 0;
    let count = 0;
    const t0 = Date.now();
    const done = new Promise<void>((resolve, reject) => {
      const unsub = engine.events.subscribe('ops', (e) => {
        if (e.kind === 'batch') {
          batches++;
          count += (e.payload as unknown[]).length;
        } else if (e.kind === 'done') {
          unsub();
          resolve();
        } else if (e.kind === 'error') {
          unsub();
          reject(new Error(JSON.stringify(e.payload)));
        }
      });
    });
    await engine.ops.startWalk({ agent: v2c, baseOid: '1.3.6.1.2.1' });
    await done;
    const ms = Date.now() - t0;
    if (count >= 1000) ok('walk streamed', `${count} varbinds in ${batches} batches, ${ms}ms`);
    else bad('walk streamed', `only ${count} varbinds (${batches} batches, ${ms}ms) — expected ≥1000`);
  } catch (e) {
    bad('walk', String(e));
  }

  line(`\n=== Spike summary: ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('spike crashed:', e);
  process.exit(2);
});
