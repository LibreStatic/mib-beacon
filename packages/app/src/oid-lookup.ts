export function observiumSearchUrl(oid: string): string {
  return `https://mibs.observium.org/search?q=${encodeURIComponent(oid.trim().replace(/^\./, ''))}`;
}
