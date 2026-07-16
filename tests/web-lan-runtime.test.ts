import { readFileSync, readlinkSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

describe('web LAN runtime', () => {
  it('documents web LAN as a runtime kind with Compose lifecycle commands', () => {
    const readme = read('README.md');

    expect(readme).toContain('## Runtime kinds');
    expect(readme).toContain('Web LAN');
    expect(readme).toContain('docker compose -f compose.yml up --build -d');
    expect(readme).toContain('docker compose -f compose.yml logs -f mibbeacon-server');
    expect(readme).toContain('docker compose -f compose.yml down');
    expect(readme).toContain('no authentication');
  });

  it('shares the Linux host network so SNMP can reach agents on the server host', () => {
    const compose = read('compose.yml');

    expect(compose).toContain('mibbeacon-server:');
    expect(compose).toContain('network_mode: host');
    expect(compose).toContain('MIB_BEACON_SERVER_HOST: 0.0.0.0');
    expect(compose).toContain('MIB_BEACON_SERVER_PORT: ${MIB_BEACON_SERVER_PORT:-8899}');
    expect(compose).toContain('MIB_BEACON_SERVER_DATA: /data');
    expect(compose).not.toContain('ports:');
    expect(compose).toContain('mibbeacon-server-data:/data');
    expect(compose).toContain('healthcheck:');
    expect(compose).toContain('no-new-privileges:true');
  });

  it('documents host networking and local-agent addressing', () => {
    const readme = read('README.md');

    expect(readme).toContain('network_mode: host');
    expect(readme).toContain('127.0.0.1');
    expect(readme).toContain('Linux');
  });

  it('keeps the legacy Docker Compose filename as a link to the canonical file', () => {
    expect(readlinkSync(new URL('../docker-compose.yml', import.meta.url))).toBe('compose.yml');
  });

  it('builds the web and Node bundles and runs the container as a non-root user', () => {
    const dockerfile = read('apps/server/Dockerfile');
    const serverPackage = JSON.parse(read('apps/server/package.json')) as {
      scripts?: Record<string, string>;
    };

    expect(serverPackage.scripts?.build).toContain('build:web');
    expect(serverPackage.scripts?.build).toContain('build:server');
    expect(serverPackage.scripts?.['build:server']).toContain('--format=cjs');
    expect(serverPackage.scripts?.['build:server']).not.toContain('--external:');
    expect(dockerfile).toContain('COPY tsconfig.base.json ./');
    expect(dockerfile).toContain('pnpm --filter @mibbeacon/server build');
    expect(dockerfile).not.toContain('pnpm --offline');
    expect(dockerfile).toContain('USER node');
    expect(dockerfile).toContain('HEALTHCHECK');
    expect(dockerfile).toContain('CMD ["node", "dist/server.cjs"]');
  });

  it('provides the Node-style global expected by React Native animation internals', () => {
    const serverVite = read('apps/server/vite.config.ts');
    const desktopVite = read('apps/desktop/electron.vite.config.ts');

    expect(serverVite).toContain("global: 'globalThis'");
    expect(desktopVite).toContain("global: 'globalThis'");
  });
});
