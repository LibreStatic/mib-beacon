import { describe, it, expect } from 'vitest';
import { MibStore } from './mib-store';
import { formatSyntax } from './format-syntax';

const TOY_MIB = `
TOY-MIB DEFINITIONS ::= BEGIN

IMPORTS
    MODULE-IDENTITY, OBJECT-TYPE, Integer32, enterprises
        FROM SNMPv2-SMI;

toyMIB MODULE-IDENTITY
    LAST-UPDATED "202601010000Z"
    ORGANIZATION "MIB Beacon"
    CONTACT-INFO "test"
    DESCRIPTION "A toy MIB for unit tests."
    ::= { enterprises 99999 }

toyObjects OBJECT IDENTIFIER ::= { toyMIB 1 }

toyGauge OBJECT-TYPE
    SYNTAX      Integer32 (0..100)
    MAX-ACCESS  read-only
    STATUS      current
    DESCRIPTION "A toy gauge value."
    ::= { toyObjects 1 }

END
`;

const OTHER_MIB = TOY_MIB.replaceAll('TOY-MIB', 'OTHER-MIB')
  .replaceAll('toyMIB', 'otherMIB')
  .replaceAll('toyObjects', 'otherObjects')
  .replaceAll('toyGauge', 'otherGauge')
  .replaceAll('99999', '99998');

const DUPLICATE_MIB = TOY_MIB.replaceAll('TOY-MIB', 'DUPLICATE-MIB')
  .replaceAll('toyMIB', 'duplicateMIB')
  .replaceAll('toyObjects', 'duplicateObjects')
  .replaceAll('toyGauge', 'duplicateGauge')
  .replace('A toy gauge value.', 'Duplicate module gauge.');

describe('MibStore', () => {
  it('forks a base-only catalog without recursively rebuilding an empty batch', () => {
    const store = new MibStore();
    const fork = store.fork();
    expect(fork.listModules()).toEqual(store.listModules());
  });
  it('ignores fake module boundaries in descriptions and comments and rejects same-file duplicates', () => {
    const store = new MibStore();
    const deceptive = TOY_MIB.replace(
      'A toy MIB for unit tests.',
      'FAKE-MIB DEFINITIONS ::= BEGIN and END are documentation only.',
    ).replace(
      'toyObjects OBJECT IDENTIFIER',
      '-- COMMENT-MIB DEFINITIONS ::= BEGIN\ntoyObjects OBJECT IDENTIFIER',
    );
    const imported = store.importTexts([{ name: 'deceptive.mib', content: deceptive }]);
    expect(imported.loaded).toEqual(['TOY-MIB']);
    expect(store.listModules().some((module) => module.name === 'FAKE-MIB')).toBe(false);

    const duplicate = store.importTexts([
      { name: 'duplicate.mib', content: `${OTHER_MIB}\n${OTHER_MIB}` },
    ]);
    expect(duplicate.loaded).toEqual([]);
    expect(duplicate.errors[0]?.message).toMatch(/duplicate module definition OTHER-MIB/);
  });
  it('preserves module split offsets across astral Unicode in strings and comments', () => {
    const store = new MibStore();
    const first = TOY_MIB.replace(
      'A toy MIB for unit tests.',
      `Emoji ${'😀'.repeat(80)} must not shift the next module boundary.`,
    ).replace(
      'toyObjects OBJECT IDENTIFIER',
      `-- astral comment ${'🚀'.repeat(80)}\ntoyObjects OBJECT IDENTIFIER`,
    );
    const result = store.importTexts([
      { name: 'emoji-bundle.mib', content: `${first}\n${OTHER_MIB}` },
    ]);

    expect(result.errors).toEqual([]);
    expect(result.loaded).toEqual(expect.arrayContaining(['TOY-MIB', 'OTHER-MIB']));
    expect(store.index.node('otherGauge')).not.toBeNull();
  });
  it('imports a dependency batch in reverse order with one serialization pass', () => {
    const store = new MibStore();
    const parent = `PARENT-MIB DEFINITIONS ::= BEGIN
IMPORTS childNode FROM CHILD-MIB;
parentNode OBJECT IDENTIFIER ::= { childNode 1 }
END`;
    const child = `CHILD-MIB DEFINITIONS ::= BEGIN
IMPORTS enterprises FROM SNMPv2-SMI;
childNode OBJECT IDENTIFIER ::= { enterprises 99101 }
END`;

    const result = store.importTexts([
      { name: 'parent.mib', content: parent },
      { name: 'child.mib', content: child },
    ]);

    expect(result.errors).toEqual([]);
    expect(result.loaded).toEqual(expect.arrayContaining(['PARENT-MIB', 'CHILD-MIB']));
    expect(store.index.node('parentNode')?.oid).toBe('1.3.6.1.4.1.99101.1');
  });

  it('imports an A to B to A cyclic import batch', () => {
    const store = new MibStore();
    const a = `A-MIB DEFINITIONS ::= BEGIN
IMPORTS enterprises FROM SNMPv2-SMI, bNode FROM B-MIB;
aNode OBJECT IDENTIFIER ::= { enterprises 99111 }
END`;
    const b = `B-MIB DEFINITIONS ::= BEGIN
IMPORTS enterprises FROM SNMPv2-SMI, aNode FROM A-MIB;
bNode OBJECT IDENTIFIER ::= { enterprises 99112 }
END`;

    const result = store.importTexts([
      { name: 'a.mib', content: a },
      { name: 'b.mib', content: b },
    ]);

    expect(result.errors).toEqual([]);
    expect(store.index.node('aNode')).not.toBeNull();
    expect(store.index.node('bNode')).not.toBeNull();
  });

  it('resolves a genuine cyclic type and OID dependency in one bounded batch', () => {
    const store = new MibStore();
    const a = `A-TYPED-MIB DEFINITIONS ::= BEGIN
IMPORTS enterprises, OBJECT-TYPE FROM SNMPv2-SMI, bType FROM B-TYPED-MIB;
aRoot OBJECT IDENTIFIER ::= { enterprises 99121 }
aValue OBJECT-TYPE
  SYNTAX bType
  MAX-ACCESS read-only
  STATUS current
  DESCRIPTION "cycle value"
  ::= { aRoot 1 }
END`;
    const b = `B-TYPED-MIB DEFINITIONS ::= BEGIN
IMPORTS TEXTUAL-CONVENTION FROM SNMPv2-TC, aRoot FROM A-TYPED-MIB;
bType ::= TEXTUAL-CONVENTION
  STATUS current
  DESCRIPTION "cycle type"
  SYNTAX INTEGER (0..10)
bNode OBJECT IDENTIFIER ::= { aRoot 2 }
END`;

    const result = store.importTexts([
      { name: 'a.mib', content: a },
      { name: 'b.mib', content: b },
    ]);

    expect(result.errors).toEqual([]);
    expect(store.index.node('aValue')).toMatchObject({
      oid: '1.3.6.1.4.1.99121.1',
      syntax: 'bType',
    });
    expect(store.index.node('bNode')?.oid).toBe('1.3.6.1.4.1.99121.2');
  });

  it('inspects a file batch without mutating the catalog', () => {
    const store = new MibStore();
    store.importTexts([{ name: 'toy.mib', content: TOY_MIB }]);
    const before = store.listModules();
    const duplicate = OTHER_MIB.replaceAll('OTHER-MIB', 'TOY-MIB');
    const external = `EXTERNAL-MIB DEFINITIONS ::= BEGIN
IMPORTS missingNode FROM MISSING-MIB;
externalNode OBJECT IDENTIFIER ::= { missingNode 1 }
END`;

    const inspection = store.inspectFiles([
      { name: 'duplicate.mib', relativePath: 'folder/duplicate.mib', content: duplicate },
      { name: 'external.mib', content: external },
    ]);

    expect(inspection.files[0]).toMatchObject({
      name: 'duplicate.mib',
      relativePath: 'folder/duplicate.mib',
      modules: ['TOY-MIB'],
      collisions: [{ module: 'TOY-MIB', kind: 'loaded-user' }],
    });
    expect(inspection.files[1]?.imports).toEqual([
      { module: 'MISSING-MIB', symbols: ['missingNode'], external: true },
    ]);
    expect(inspection.externalMissingImports).toEqual([
      { module: 'MISSING-MIB', symbols: ['missingNode'], requestedBy: ['external.mib'] },
    ]);
    expect(store.listModules()).toEqual(before);
    expect(store.index.node('externalNode')).toBeNull();
  });

  it('classifies duplicate module definitions and base collisions during inspection', () => {
    const store = new MibStore();
    const baseCollision = TOY_MIB.replaceAll('TOY-MIB', 'SNMPv2-MIB');

    const inspection = store.inspectFiles([
      { name: 'first.mib', content: TOY_MIB },
      { name: 'second.mib', content: TOY_MIB },
      { name: 'base.mib', content: baseCollision },
    ]);

    expect(inspection.duplicateDefinitions).toEqual([
      { module: 'TOY-MIB', files: ['first.mib', 'second.mib'] },
    ]);
    expect(inspection.files[0]?.collisions).toContainEqual({
      module: 'TOY-MIB',
      kind: 'batch-duplicate',
    });
    expect(inspection.files[2]?.collisions).toContainEqual({ module: 'SNMPv2-MIB', kind: 'base' });
  });

  it('replaces user modules atomically and rejects base replacements', () => {
    const store = new MibStore();
    store.importTexts([{ name: 'toy.mib', content: TOY_MIB }]);
    const replacement = TOY_MIB.replace('99999', '99997');

    const replaced = store.replaceTexts(
      [{ name: 'replacement.mib', content: replacement }],
      ['TOY-MIB'],
    );
    expect(replaced.errors).toEqual([]);
    expect(store.index.node('toyGauge')?.oid).toBe('1.3.6.1.4.1.99997.1.1');

    const failed = store.replaceTexts(
      [{ name: 'broken.mib', content: 'TOY-MIB DEFINITIONS ::= BEGIN broken END' }],
      ['TOY-MIB'],
    );
    expect(failed.errors).not.toEqual([]);
    expect(store.index.node('toyGauge')?.oid).toBe('1.3.6.1.4.1.99997.1.1');
    expect(() =>
      store.replaceTexts([{ name: 'base.mib', content: TOY_MIB }], ['SNMPv2-MIB']),
    ).toThrow(/base module/);
  });

  it('requires every module from a multi-module source during replacement', () => {
    const store = new MibStore();
    const bundled = `${TOY_MIB}\n${OTHER_MIB}`;
    expect(store.importTexts([{ name: 'bundle.mib', content: bundled }]).errors).toEqual([]);

    const inspection = store.inspectFiles([{ name: 'replacement.mib', content: TOY_MIB }]);
    expect(inspection.files[0]?.collisions[0]?.replacementGroup).toEqual(['TOY-MIB', 'OTHER-MIB']);
    const result = store.replaceTexts([{ name: 'replacement.mib', content: TOY_MIB }], ['TOY-MIB']);
    expect(result.errors[0]?.message).toContain('OTHER-MIB');
    expect(store.index.node('otherGauge')).not.toBeNull();
  });

  it('returns replacement ownership groups without exposing source content', () => {
    const store = new MibStore();
    store.importTexts([{ name: 'bundle.mib', content: `${TOY_MIB}\n${OTHER_MIB}` }]);

    expect(store.replacementGroup('TOY-MIB')).toEqual(['OTHER-MIB', 'TOY-MIB']);
    expect(store.replacementGroup('SNMPv2-MIB')).toBeNull();
    expect(store.replacementGroup('UNKNOWN-MIB')).toBeNull();
  });

  it('preloads base modules and indexes the standard tree', () => {
    const store = new MibStore();
    const modules = store.listModules();
    expect(modules.some((m) => m.name === 'SNMPv2-MIB' && m.isBase)).toBe(true);
    // sysDescr from the base set
    const node = store.index.node('1.3.6.1.2.1.1.1');
    expect(node?.name).toBe('sysDescr');
    expect(node?.syntax).toContain('DisplayString');
    expect(node?.access).toBe('read-only');
  });

  it('imports a MIB from raw text and exposes it in the tree', () => {
    const store = new MibStore();
    const result = store.importTexts([{ name: 'TOY-MIB.mib', content: TOY_MIB }]);
    expect(result.errors).toEqual([]);
    expect(result.loaded).toContain('TOY-MIB');

    const gauge = store.index.node('toyGauge');
    expect(gauge?.oid).toBe('1.3.6.1.4.1.99999.1.1');
    expect(gauge?.description).toContain('toy gauge');
    expect(gauge?.kind).toBe('scalar');

    // tree navigation reaches it
    const children = store.index.children('1.3.6.1.4.1.99999.1');
    expect(children.map((c) => c.name)).toContain('toyGauge');
  });

  it('builds a module-focused tree with dependencies and parent connectors', () => {
    const store = new MibStore();
    store.importTexts([
      { name: 'TOY-MIB.mib', content: TOY_MIB },
      { name: 'OTHER-MIB.mib', content: OTHER_MIB },
    ]);

    const view = store.module('TOY-MIB');
    expect(view?.module.name).toBe('TOY-MIB');
    expect(view?.dependencies).toContainEqual({
      name: 'SNMPv2-SMI',
      symbols: ['MODULE-IDENTITY', 'OBJECT-TYPE', 'Integer32', 'enterprises'],
      loaded: true,
    });

    expect(store.moduleChildren('TOY-MIB').map((n) => [n.name, n.role])).toContainEqual([
      'iso',
      'parent',
    ]);
    expect(store.moduleChildren('TOY-MIB', '1.3.6.1.4')).toContainEqual(
      expect.objectContaining({ name: 'enterprises', role: 'dependency', childCount: 1 }),
    );
    expect(store.moduleChildren('TOY-MIB', '1.3.6.1.4.1').map((n) => [n.name, n.role])).toEqual([
      ['toyMIB', 'module'],
    ]);
  });

  it('retains focused ownership and detail when modules define the same OID', () => {
    const store = new MibStore();
    store.importTexts([
      { name: 'TOY-MIB.mib', content: TOY_MIB },
      { name: 'DUPLICATE-MIB.mib', content: DUPLICATE_MIB },
    ]);

    expect(store.moduleChildren('DUPLICATE-MIB', '1.3.6.1.4.1.99999.1')).toContainEqual(
      expect.objectContaining({ name: 'duplicateGauge', role: 'module' }),
    );
    expect(store.index.node('1.3.6.1.4.1.99999.1.1', 'DUPLICATE-MIB')?.description).toContain(
      'Duplicate module gauge',
    );
    expect(store.index.searchModule('DUPLICATE-MIB', 'duplicateGauge')[0]).toMatchObject({
      name: 'duplicateGauge',
      module: 'DUPLICATE-MIB',
    });
  });

  it('returns null for an unknown module focus', () => {
    const store = new MibStore();
    expect(store.module('NOT-A-MIB')).toBeNull();
    expect(store.moduleChildren('NOT-A-MIB')).toEqual([]);
  });

  it('resolves instance OIDs by longest prefix', () => {
    const store = new MibStore();
    const r = store.index.resolve('1.3.6.1.2.1.1.1.0');
    expect(r?.name).toBe('sysDescr.0');
    expect(r?.definitionOid).toBe('1.3.6.1.2.1.1.1');
  });

  it('search finds by name, ranks exact first', () => {
    const store = new MibStore();
    const hits = store.index.search('sysDescr');
    expect(hits[0]?.name).toBe('sysDescr');
    const fuzzy = store.index.search('ifIn');
    expect(fuzzy.some((h) => h.name === 'ifInOctets')).toBe(true);
    expect(store.index.search('sysdescr')[0]?.name).toBe('sysDescr');
    expect(store.index.search('SYSDESCR')[0]?.name).toBe('sysDescr');
  });

  it('unloads a user module (and refuses base modules)', () => {
    const store = new MibStore();
    store.importTexts([{ name: 'TOY-MIB', content: TOY_MIB }]);
    expect(store.index.node('toyGauge')).not.toBeNull();
    store.unload('TOY-MIB');
    expect(store.index.node('toyGauge')).toBeNull();
    expect(store.listModules().some((m) => m.name === 'TOY-MIB')).toBe(false);
    expect(() => store.unload('SNMPv2-MIB')).toThrow(/base module/);
  });

  it('reports files with no module definition as errors', () => {
    const store = new MibStore();
    store.importTexts([{ name: 'TOY-MIB.mib', content: TOY_MIB }]);
    const result = store.importTexts([{ name: 'garbage.txt', content: 'not a mib at all' }]);
    expect(result.loaded).toEqual([]);
    expect(result.errors[0]?.message).toMatch(/no MIB module/);
    expect(store.index.node('toyGauge')).not.toBeNull();
    expect(store.listModules().some((module) => module.name === 'undefined')).toBe(false);
  });

  it('reports missing imported modules without retaining a ghost module', () => {
    const store = new MibStore();
    const result = store.importTexts([
      {
        name: 'DOCS-BPI2EXT-MIB.mib',
        content: `
DOCS-BPI2EXT-MIB DEFINITIONS ::= BEGIN
IMPORTS
    SnmpAdminString FROM SNMP-FRAMEWORK-MIB
    ifIndex FROM IF-MIB
    clabProjDocsis FROM CLAB-DEF-MIB
    DocsX509ASN1DEREncodedCertificate FROM DOCS-IETF-BPI2-MIB;

docsBpi2Ext31Mib OBJECT IDENTIFIER ::= { clabProjDocsis 29 }
END
`,
      },
    ]);

    expect(result.loaded).toEqual([]);
    expect(result.errors).toEqual([
      expect.objectContaining({
        name: 'DOCS-BPI2EXT-MIB.mib',
        code: 'MIB_MISSING_IMPORTS',
        missingImports: [
          { module: 'SNMP-FRAMEWORK-MIB', symbols: ['SnmpAdminString'] },
          { module: 'IF-MIB', symbols: ['ifIndex'] },
          { module: 'CLAB-DEF-MIB', symbols: ['clabProjDocsis'] },
          {
            module: 'DOCS-IETF-BPI2-MIB',
            symbols: ['DocsX509ASN1DEREncodedCertificate'],
          },
        ],
      }),
    ]);
    expect(result.errors[0]?.message).toContain(
      'Import dependencies first: SNMP-FRAMEWORK-MIB (SnmpAdminString)',
    );
    expect(store.listModules().some((module) => module.name === 'DOCS-BPI2EXT-MIB')).toBe(false);
    expect(store.index.node('docsBpi2Ext31Mib')).toBeNull();
  });
});

describe('formatSyntax', () => {
  it('formats strings, sizes, ranges, enums, and tables', () => {
    expect(formatSyntax('Integer32')).toBe('Integer32');
    expect(formatSyntax({ DisplayString: { sizes: [{ min: 0, max: 255 }] } })).toBe(
      'DisplayString (SIZE 0..255)',
    );
    expect(formatSyntax({ INTEGER: { up: 1, down: 2 } })).toBe('INTEGER { up(1), down(2) }');
    expect(formatSyntax({ 'SEQUENCE OF': 'IfEntry' })).toBe('SEQUENCE OF IfEntry');
  });
});
