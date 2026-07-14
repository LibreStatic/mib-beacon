import { describe, expect, it } from 'vitest';
import { MibStore } from './mib-store';

const SEARCH_MIB = `SEARCH-RANKING-MIB DEFINITIONS ::= BEGIN
searchRoot OBJECT IDENTIFIER ::= { iso 424252 }
alphaTarget OBJECT IDENTIFIER ::= { searchRoot 1 }
target OBJECT IDENTIFIER ::= { searchRoot 2 }
describedNode OBJECT-TYPE
  SYNTAX INTEGER
  ACCESS read-only
  STATUS mandatory
  DESCRIPTION "Unique searchable phrase for a description match"
  ::= { searchRoot 3 }
ifHCInOctets OBJECT IDENTIFIER ::= { searchRoot 4 }
END`;

describe('ranked MIB search', () => {
  it('collects before limiting so an exact name beats an earlier substring', () => {
    const store = new MibStore();
    store.importTexts([{ name: 'search.mib', content: SEARCH_MIB }]);

    expect(store.index.search('target', 1)[0]).toEqual(
      expect.objectContaining({ name: 'target', matched: 'name' }),
    );
  });

  it('finds fuzzy names and returns name highlight spans', () => {
    const store = new MibStore();
    store.importTexts([{ name: 'search.mib', content: SEARCH_MIB }]);

    expect(store.index.search('targt')[0]).toEqual(
      expect.objectContaining({
        name: 'target',
        matched: 'name',
        highlights: expect.arrayContaining([
          expect.objectContaining({ field: 'name', start: 0, end: expect.any(Number) }),
        ]),
      }),
    );
    expect(store.index.search('ifhcinoc').some(({ name }) => name === 'ifHCInOctets')).toBe(true);
  });

  it('ranks description only after names and marks the matching text range', () => {
    const store = new MibStore();
    store.importTexts([{ name: 'search.mib', content: SEARCH_MIB }]);

    expect(store.index.search('searchable phrase')[0]).toEqual(
      expect.objectContaining({
        name: 'describedNode',
        matched: 'description',
        highlights: [
          expect.objectContaining({
            field: 'description',
            start: expect.any(Number),
            end: expect.any(Number),
          }),
        ],
      }),
    );
  });
});
