import { describe, expect, it } from 'vitest';
import * as vendorBrowser from './vendor-mib-browser';

const { shouldOfferVendorMibBrowse } = vendorBrowser;

describe('vendor MIB browser affordance', () => {
  it('offers vendor browsing only when enterprise evidence exists without local ownership', () => {
    expect(
      shouldOfferVendorMibBrowse({
        loaded: null,
        cached: null,
        enterprise: { number: 9, organization: 'Cisco Systems' },
      }),
    ).toEqual({ vendor: 'Cisco Systems', label: 'Browse MIBs for Cisco Systems?' });
  });

  it('suppresses the affordance when a loaded or cached MIB already owns the OID', () => {
    expect(
      shouldOfferVendorMibBrowse({
        loaded: { name: 'ciscoRoot' },
        cached: null,
        enterprise: { number: 9, organization: 'Cisco Systems' },
      }),
    ).toBeNull();
    expect(
      shouldOfferVendorMibBrowse({
        loaded: null,
        cached: { name: 'ciscoRoot' },
        enterprise: { number: 9, organization: 'Cisco Systems' },
      }),
    ).toBeNull();
  });

  it('uses cached imports only for candidates available offline', () => {
    const importAction = (
      vendorBrowser as typeof vendorBrowser & {
        vendorMibImportAction?: (
          fromCache: boolean,
          candidate: { availableOffline: boolean },
        ) => { mode: string; label: string; disabled: boolean };
      }
    ).vendorMibImportAction;

    expect(importAction?.(false, { availableOffline: false })).toEqual({
      mode: 'download',
      label: 'Download & import',
      disabled: false,
    });
    expect(importAction?.(true, { availableOffline: true })).toEqual({
      mode: 'cached',
      label: 'Load cached',
      disabled: false,
    });
    expect(importAction?.(true, { availableOffline: false })).toEqual({
      mode: 'unavailable',
      label: 'Unavailable offline',
      disabled: true,
    });
  });
});
