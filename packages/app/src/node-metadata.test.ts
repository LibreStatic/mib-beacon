import { describe, expect, it } from 'vitest';
import { moduleCatalogSummary, nodeMetadataRows } from './node-metadata';

describe('node inspector metadata rows', () => {
  it('surfaces table, textual-convention, duplicate, and path metadata', () => {
    expect(
      nodeMetadataRows({
        oid: '1.2.3',
        name: 'row',
        kind: 'entry',
        hasChildren: true,
        childCount: 2,
        namedPath: 'iso.example.row',
        syntax: 'DisplayString',
        indexes: ['name'],
        impliedIndexes: ['name'],
        augments: ['baseEntry'],
        textualConventionChain: ['DisplayString', 'OCTET STRING'],
        displayHint: '255a',
        definitions: [
          { module: 'A-MIB', name: 'row' },
          { module: 'B-MIB', name: 'otherRow' },
        ],
        warnings: ['Duplicate OID'],
      }),
    ).toEqual(
      expect.arrayContaining([
        { label: 'Named path', value: 'iso.example.row' },
        { label: 'Index', value: 'name (IMPLIED)' },
        { label: 'Augments', value: 'baseEntry' },
        { label: 'TC chain', value: 'DisplayString → OCTET STRING' },
        { label: 'Display hint', value: '255a' },
        { label: 'Definitions', value: 'A-MIB::row, B-MIB::otherRow' },
        { label: 'Warnings', value: 'Duplicate OID' },
      ]),
    );
  });
});

describe('module catalog summary', () => {
  it('shows revision and organization without inventing missing values', () => {
    expect(
      moduleCatalogSummary({
        name: 'TEST-MIB',
        objectCount: 4,
        isBase: false,
        revision: '202607130000Z',
        organization: 'MIBBeacon',
      }),
    ).toBe('rev 202607130000Z · MIBBeacon');
    expect(moduleCatalogSummary({ name: 'EMPTY-MIB', objectCount: 0, isBase: false })).toBeNull();
  });
});
