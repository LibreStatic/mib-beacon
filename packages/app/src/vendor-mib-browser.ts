export interface VendorMibBrowseEvidence {
  loaded: { name?: string } | null;
  cached: { name?: string } | null;
  enterprise: { organization: string } | null;
}

export function shouldOfferVendorMibBrowse(
  evidence: VendorMibBrowseEvidence,
): { vendor: string; label: string } | null {
  const vendor = evidence.enterprise?.organization.trim();
  if (!vendor || evidence.loaded || evidence.cached) return null;
  return { vendor, label: `Browse MIBs for ${vendor}?` };
}

export function vendorMibImportAction(
  fromCache: boolean,
  candidate: { availableOffline: boolean },
): { mode: 'download' | 'cached' | 'unavailable'; label: string; disabled: boolean } {
  if (!fromCache) return { mode: 'download', label: 'Download & import', disabled: false };
  if (candidate.availableOffline)
    return { mode: 'cached', label: 'Load cached', disabled: false };
  return { mode: 'unavailable', label: 'Unavailable offline', disabled: true };
}
