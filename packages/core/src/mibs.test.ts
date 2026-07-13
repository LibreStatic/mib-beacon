import { describe, it, expect } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { createNodeTransport, nodeStorageFactory } from '@omc/transport/node';
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
const OTHER_MIB = TOY_MIB.replaceAll('TOY-MIB', 'OTHER-MIB')
  .replaceAll('toyMIB', 'otherMIB')
  .replaceAll('toyValue', 'otherValue')
  .replaceAll('99999', '99998');

function makeEngine(dbPath: string) {
  return createEngine(createNodeTransport({ dataDir: tmpdir() }), { dbPath });
}

describe('engine mibs domain', () => {
  it('rejects oversized and over-count file batches before inspection or import', async () => {
    const engine = makeEngine(':memory:');
    const tooMany = Array.from({ length: 1_001 }, (_, index) => ({
      name: `${index}.mib`,
      content: TOY_MIB,
    }));
    await expect(engine.mibs.inspectFiles(tooMany)).rejects.toThrow(/1,000/);
    await expect(engine.mibs.startImport({ files: tooMany })).rejects.toThrow(/1,000/);

    const oversized = [{ name: 'large.mib', content: 'x'.repeat(5 * 1024 * 1024 + 1) }];
    await expect(engine.mibs.inspectFiles(oversized)).rejects.toThrow(/5 MiB/);
    await expect(engine.mibs.startImport({ files: oversized })).rejects.toThrow(/5 MiB/);
  });
  it('inspects file metadata without loading or persisting it', async () => {
    const engine = makeEngine(':memory:');
    const before = await engine.mibs.list();

    const inspection = await engine.mibs.inspectFiles([
      { name: 'TOY-MIB.mib', relativePath: 'selected/TOY-MIB.mib', content: TOY_MIB },
    ]);

    expect(inspection.files[0]).toMatchObject({
      name: 'TOY-MIB.mib',
      relativePath: 'selected/TOY-MIB.mib',
      modules: ['TOY-MIB'],
    });
    expect(await engine.mibs.list()).toEqual(before);
    expect(await engine.mibs.node('toyValue')).toBeNull();
  });

  it('imports, lists, browses, searches, resolves', async () => {
    const engine = makeEngine(':memory:');
    const result = await engine.mibs.importTexts([{ name: 'TOY-MIB', content: TOY_MIB }]);
    expect(result.loaded).toContain('TOY-MIB');

    const modules = await engine.mibs.list();
    expect(modules.some((m) => m.name === 'TOY-MIB' && !m.isBase)).toBe(true);

    const module = await engine.mibs.module('TOY-MIB');
    expect(module?.dependencies.some((d) => d.name === 'SNMPv2-SMI' && d.loaded)).toBe(true);
    const focused = await engine.mibs.moduleTree('TOY-MIB', '1.3.6.1.4.1');
    expect(focused).toEqual([expect.objectContaining({ name: 'toyMIB', role: 'module' })]);

    // roots: arc 0 (zeroDotZero) and arc 1 (iso)
    const roots = await engine.mibs.tree();
    expect(roots.some((r) => r.name === 'iso')).toBe(true);

    const node = await engine.mibs.node('toyValue');
    expect(node?.oid).toBe('1.3.6.1.4.1.99999.1');

    const hits = await engine.mibs.search('toyValue');
    expect(hits[0]?.oid).toBe('1.3.6.1.4.1.99999.1');

    const resolved = await engine.mibs.resolve('1.3.6.1.4.1.99999.1.0');
    expect(resolved?.name).toBe('toyValue.0');

    const catalogEvents: string[] = [];
    const unsubscribe = engine.events.subscribe('tools', (event) => catalogEvents.push(event.kind));
    await engine.mibs.unload('TOY-MIB');
    unsubscribe();
    expect(catalogEvents).toContain('catalog-changed');
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

  it('persists a multi-module source once and preserves ownership across replacement restart', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'omc-multi-source-'));
    const dbPath = join(dir, 'omc.db');
    const bundle = `${TOY_MIB}\n${OTHER_MIB}`;
    const engine1 = makeEngine(dbPath);
    await engine1.mibs.importTexts([{ name: 'bundle.mib', content: bundle }]);
    const db1 = nodeStorageFactory.open(dbPath);
    expect(db1.get<{ count: number }>('SELECT COUNT(*) AS count FROM mib_modules')?.count).toBe(1);
    db1.close();

    const engine2 = makeEngine(dbPath);
    expect(await engine2.mibs.replacementGroup('TOY-MIB')).toEqual(['OTHER-MIB', 'TOY-MIB']);
    expect(await engine2.mibs.replacementGroup('SNMPv2-MIB')).toBeNull();
    expect(await engine2.mibs.node('toyValue')).not.toBeNull();
    expect(await engine2.mibs.node('otherValue')).not.toBeNull();
    const replacement = bundle.replace('99999', '99997').replace('99998', '99996');
    const operation = await engine2.mibs.startImport({
      files: [{ name: 'replacement.mib', content: replacement }],
      replaceModules: ['TOY-MIB'],
    });
    for (let index = 0; index < 100; index += 1) {
      const status = await engine2.resolver.status(operation.handleId);
      if (status && ['done', 'error'].includes(status.state)) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(await engine2.resolver.status(operation.handleId)).toMatchObject({ state: 'done' });

    const engine3 = makeEngine(dbPath);
    expect((await engine3.mibs.node('toyValue'))?.oid).toContain('99997');
    expect((await engine3.mibs.node('otherValue'))?.oid).toContain('99996');
    const db3 = nodeStorageFactory.open(dbPath);
    expect(db3.get<{ count: number }>('SELECT COUNT(*) AS count FROM mib_modules')?.count).toBe(1);
    db3.close();
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
