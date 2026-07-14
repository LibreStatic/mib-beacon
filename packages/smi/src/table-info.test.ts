import { describe, expect, it } from 'vitest';
import { MibStore } from './mib-store';

const TABLE_MIB = `TABLE-INFO-MIB DEFINITIONS ::= BEGIN
IMPORTS
  MODULE-IDENTITY, OBJECT-TYPE, enterprises FROM SNMPv2-SMI
  DisplayString FROM SNMPv2-TC;

tableInfoMib MODULE-IDENTITY
  LAST-UPDATED "202607130000Z"
  ORGANIZATION "MIBBeacon"
  CONTACT-INFO "none"
  DESCRIPTION "table fixture"
  REVISION "202607130000Z"
  DESCRIPTION "initial revision"
  ::= { enterprises 424243 }

sampleTable OBJECT-TYPE
  SYNTAX SEQUENCE OF SampleEntry
  MAX-ACCESS not-accessible
  STATUS current
  DESCRIPTION "table"
  ::= { tableInfoMib 1 }

sampleEntry OBJECT-TYPE
  SYNTAX SampleEntry
  MAX-ACCESS not-accessible
  STATUS current
  DESCRIPTION "entry"
  INDEX { IMPLIED sampleKey }
  ::= { sampleTable 1 }

SampleEntry ::= SEQUENCE {
  sampleKey DisplayString,
  sampleValue INTEGER
}

sampleKey OBJECT-TYPE
  SYNTAX DisplayString (SIZE (0..255))
  MAX-ACCESS read-only
  STATUS current
  DESCRIPTION "key"
  ::= { sampleEntry 1 }

sampleValue OBJECT-TYPE
  SYNTAX INTEGER
  MAX-ACCESS read-only
  STATUS current
  DESCRIPTION "value"
  ::= { sampleEntry 2 }

augmentTable OBJECT-TYPE
  SYNTAX SEQUENCE OF AugmentEntry
  MAX-ACCESS not-accessible
  STATUS current
  DESCRIPTION "augment table"
  ::= { tableInfoMib 2 }

augmentEntry OBJECT-TYPE
  SYNTAX AugmentEntry
  MAX-ACCESS not-accessible
  STATUS current
  DESCRIPTION "augment entry"
  AUGMENTS { sampleEntry }
  ::= { augmentTable 1 }

AugmentEntry ::= SEQUENCE {
  augmentValue INTEGER
}

augmentValue OBJECT-TYPE
  SYNTAX INTEGER
  MAX-ACCESS read-only
  STATUS current
  DESCRIPTION "augment value"
  ::= { augmentEntry 1 }
END`;

describe('table and textual-convention metadata', () => {
  it('surfaces IMPLIED indexes, AUGMENTS, and resolved DisplayString hints', () => {
    const store = new MibStore();
    expect(store.importTexts([{ name: 'table-info.mib', content: TABLE_MIB }]).errors).toEqual([]);

    expect(store.index.node('sampleEntry')).toEqual(
      expect.objectContaining({ indexes: ['sampleKey'], impliedIndexes: ['sampleKey'] }),
    );
    expect(store.index.node('augmentEntry')).toEqual(
      expect.objectContaining({ augments: ['sampleEntry'] }),
    );
    expect(store.index.node('sampleKey')).toEqual(
      expect.objectContaining({
        textualConventionChain: ['DisplayString', 'OCTET STRING'],
        displayHint: '255a',
      }),
    );
    expect(store.listModules().find(({ name }) => name === 'TABLE-INFO-MIB')).toEqual(
      expect.objectContaining({
        lastUpdated: '202607130000Z',
        revision: '202607130000Z',
        organization: 'MIBBeacon',
      }),
    );
  });

  it('retains duplicate OID definitions while making the latest module the display winner', () => {
    const store = new MibStore();
    const mib = (module: string, symbol: string) => `${module} DEFINITIONS ::= BEGIN
${symbol} OBJECT IDENTIFIER ::= { iso 424249 }
END`;
    expect(
      store.importTexts([{ name: 'first.mib', content: mib('FIRST-MIB', 'firstRoot') }]).errors,
    ).toEqual([]);
    expect(
      store.importTexts([{ name: 'second.mib', content: mib('SECOND-MIB', 'secondRoot') }]).errors,
    ).toEqual([]);

    expect(store.index.node('1.424249')).toEqual(
      expect.objectContaining({
        name: 'secondRoot',
        module: 'SECOND-MIB',
        definitions: [
          { module: 'FIRST-MIB', name: 'firstRoot' },
          { module: 'SECOND-MIB', name: 'secondRoot' },
        ],
        warnings: ['Duplicate OID 1.424249 is defined by FIRST-MIB and SECOND-MIB'],
      }),
    );
    expect(store.index.node('firstRoot', 'FIRST-MIB')?.name).toBe('firstRoot');
  });
});
