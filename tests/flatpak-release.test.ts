import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  immutableSources,
  prepareManifest,
} from '../packaging/flatpak/scripts/prepare-flatpak-release.mjs';

const shaA = 'a'.repeat(64);
const shaB = 'b'.repeat(64);
const options = {
  x64Url: 'https://example.test/x64.tar.xz',
  x64Sha256: shaA,
  arm64Url: 'https://example.test/arm64.tar.xz',
  arm64Sha256: shaB,
};

describe('Flatpak immutable release preparation', () => {
  it('permits Electron safeStorage to use the desktop Secret Service', () => {
    const manifest = readFileSync(
      new URL('../packaging/flatpak/com.librestatic.mibbeacon.yml', import.meta.url),
      'utf8',
    );
    expect(manifest).toContain('--talk-name=org.freedesktop.secrets');
    expect(manifest).toContain('--password-store=gnome-libsecret');
  });

  it('registers MIME globs for every supported MIB association', () => {
    const mime = readFileSync(
      new URL('../packaging/flatpak/com.librestatic.mibbeacon.xml', import.meta.url),
      'utf8',
    );
    expect(mime).toContain('type="application/x-mib"');
    expect(mime).toContain('pattern="*.mib"');
    expect(mime).toContain('pattern="*.my"');
    expect(mime).toContain('type="text/x-smi"');
    expect(mime).toContain('pattern="*.smi"');

    const desktop = readFileSync(
      new URL('../packaging/flatpak/com.librestatic.mibbeacon.desktop', import.meta.url),
      'utf8',
    );
    expect(desktop).toContain('text/x-smi;application/smil+xml;');
  });

  it('emits architecture-specific HTTPS sources with fixed hashes', () => {
    expect(immutableSources(options)).toContain('only-arches: [x86_64]');
    expect(immutableSources(options)).toContain('only-arches: [aarch64]');
    expect(immutableSources(options)).toContain(`sha256: ${shaA}`);
  });

  it('replaces the local CI staging source and preserves metadata files', () => {
    const template = `sources:\n      # CI stages anything\n      - type: dir\n        path: staging\n      - type: file\n        path: app.desktop\n`;
    const result = prepareManifest(template, options);
    expect(result).not.toContain('path: staging');
    expect(result).toContain('path: app.desktop');
    expect(result).toContain(options.arm64Url);
  });

  it('rejects mutable or unhashed sources', () => {
    expect(() => immutableSources({ ...options, x64Url: 'http://example.test/app' })).toThrow(
      'HTTPS',
    );
    expect(() => immutableSources({ ...options, arm64Sha256: 'latest' })).toThrow('SHA-256');
  });
});
