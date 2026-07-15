import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

describe('mobile application chrome', () => {
  it('uses two equally sized 44px square header actions', () => {
    const appRoot = read('packages/app/src/AppRoot.tsx');

    expect(appRoot.match(/<MobileHeaderAction\b/g)).toHaveLength(2);
    expect(appRoot).toMatch(/mobileHeaderAction:\s*\{[^}]*width:\s*44[^}]*height:\s*44/s);
  });

  it('reserves the collapsed packet trigger lane above compact content', () => {
    const appRoot = read('packages/app/src/AppRoot.tsx');
    const packetLayout = read('packages/app/src/packet-console.ts');

    expect(packetLayout).toContain('export const MOBILE_PACKET_CONSOLE_COLLAPSED_SIZE = 24;');
    expect(appRoot).toContain("mode === 'compact' ? styles.mobileBody : null");
    expect(appRoot).toMatch(
      /mobileBody:\s*\{[^}]*paddingTop:\s*MOBILE_PACKET_CONSOLE_COLLAPSED_SIZE[^}]*\}/s,
    );
  });
});
