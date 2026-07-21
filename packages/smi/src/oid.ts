/** Canonicalize numeric OIDs, accepting the ASN.1 `iso` root alias for arc 1. */
export function normalizeNumericOid(value: string): string | null {
  const withoutLeadingDot = value.trim().replace(/^\./, '');
  const normalized = withoutLeadingDot.replace(/^iso(?=\.|$)/i, '1');
  return /^\d+(?:\.\d+)*$/.test(normalized) ? normalized : null;
}
