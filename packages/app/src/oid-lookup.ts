import { normalizeNumericOid } from '@mibbeacon/core/client';

export function observiumSearchUrl(oid: string): string {
  const normalized = normalizeNumericOid(oid) ?? oid.trim().replace(/^\./, '');
  return `https://mibs.observium.org/search?q=${encodeURIComponent(normalized)}`;
}
