/** Stable cross-platform content key used for private MIB file copies and resolver cache entries. */
export function contentAddress(content: string): string {
  const bytes = new TextEncoder().encode(content);
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return `${bytes.byteLength.toString(16)}-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
