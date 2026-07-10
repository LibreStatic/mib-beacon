import { describe, it, expect } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { createNodeTransport } from '@omc/transport/node';
import { createEngine } from './engine';

const TOY_MIB = `
TOY-MIB DEFINITIONS ::= BEGIN
IMPORTS
    MODULE-IDENTITY, OBJECT-TYPE, Integer32, enterprises FROM SNMPv2-SMI;
toyMIB MODULE-IDENTITY
    LAST-UPDATED "202601010000Z"
    ORGANIZATION "test" CONTACT-INFO "test" DESCRIPTION "toy"
    ::= { enterprises 99999 }
toyValue OBJECT-TYPE
    SYNTAX Integer32 MAX-ACCESS read-only STATUS current
    DESCRIPTION "toy value"
    ::= { toyMIB 1 }
END
`;

function makeEngine(dbPath: string) {
  return createEngine(createNodeTransport({ dataDir: tmpdir() }), { dbPath });
}

describe('engine mibs domain', () => {
  it('imports, lists, browses, searches, resolves', async () => {
    const engine = makeEngine(':memory:');
    const result = await engine.mibs.importTexts([{ name: 'TOY-MIB', content: TOY_MIB }]);
    expect(result.loaded).toContain('TOY-MIB');

    const modules = await engine.mibs.list();
    expect(modules.some((m) => m.name === 'TOY-MIB' && !m.isBase)).toBe(true);

    // roots: arc 0 (zeroDotZero) and arc 1 (iso)
    const roots = await engine.mibs.tree();
    expect(roots.some((r) => r.name === 'iso')).toBe(true);

    const node = await engine.mibs.node('toyValue');
    expect(node?.oid).toBe('1.3.6.1.4.1.99999.1');

    const hits = await engine.mibs.search('toyValue');
    expect(hits[0]?.oid).toBe('1.3.6.1.4.1.99999.1');

    const resolved = await engine.mibs.resolve('1.3.6.1.4.1.99999.1.0');
    expect(resolved?.name).toBe('toyValue.0');

    await engine.mibs.unload('TOY-MIB');
    expect(await engine.mibs.node('toyValue')).toBeNull();
  });

  it('persists user modules across engine restarts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'omc-mibs-'));
    const dbPath = join(dir, 'omc.db');

    const engine1 = makeEngine(dbPath);
    await engine1.mibs.importTexts([{ name: 'TOY-MIB', content: TOY_MIB }]);
    expect((await engine1.mibs.node('toyValue'))?.oid).toBe('1.3.6.1.4.1.99999.1');

    const engine2 = makeEngine(dbPath);
    expect((await engine2.mibs.node('toyValue'))?.oid).toBe('1.3.6.1.4.1.99999.1');
    expect((await engine2.mibs.list()).some((m) => m.name === 'TOY-MIB')).toBe(true);

    // unload persists too
    await engine2.mibs.unload('TOY-MIB');
    const engine3 = makeEngine(dbPath);
    expect(await engine3.mibs.node('toyValue')).toBeNull();
  });

  it('rejects a URL import that is not MIB content', async () => {
    const engine = makeEngine(':memory:');
    // data: URLs are not fetchable — spin a quick local server serving HTML
    const { createServer } = await import('node:http');
    const srv = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html><body>totally a mib</body></html>');
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const port = (srv.address() as { port: number }).port;
    await expect(engine.mibs.importUrl(`http://127.0.0.1:${port}/FAKE-MIB`)).rejects.toThrow(
      /not a MIB/,
    );
    srv.close();
  });
});
