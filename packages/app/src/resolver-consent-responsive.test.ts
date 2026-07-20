import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('resolver consent responsiveness', () => {
  it('keeps consent content scrollable with actions outside the scrolling body', () => {
    const source = readFileSync(new URL('./AppRoot.tsx', import.meta.url), 'utf8');
    const consentModal = source.slice(
      source.indexOf('function ResolverConsentModal'),
      source.indexOf('const styles = StyleSheet.create'),
    );

    expect(consentModal).toContain('<Dialog');
    expect(consentModal).toContain('footer={');
    expect(consentModal).toContain('<View style={styles.modalActions}>');
    expect(consentModal).not.toContain('<Modal');
  });
});
