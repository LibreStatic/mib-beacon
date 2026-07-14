import { describe, expect, it } from 'vitest';
import { observiumSearchUrl } from './oid-lookup';

describe('OID lookup references', () => {
  it('builds an encoded Observium human-reference link without scraping it', () => {
    expect(observiumSearchUrl(' .1.3.6.1.4.1.9 ')).toBe(
      'https://mibs.observium.org/search?q=1.3.6.1.4.1.9',
    );
  });
});
