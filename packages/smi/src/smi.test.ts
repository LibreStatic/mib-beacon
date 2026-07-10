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
    ORGANIZATION "Open MIB Catalog"
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

describe('MibStore', () => {
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
    const result = store.importTexts([{ name: 'garbage.txt', content: 'not a mib at all' }]);
    expect(result.loaded).toEqual([]);
    expect(result.errors[0]?.message).toMatch(/no MIB module/);
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
