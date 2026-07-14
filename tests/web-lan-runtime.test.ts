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
    expect(readme).toContain('docker compose up --build -d');
    expect(readme).toContain('docker compose logs -f mibbeacon-server');
    expect(readme).toContain('docker compose down');
    expect(readme).toContain('no authentication');
  });

  it('defines a persistent, health-checked LAN service with explicit ports', () => {
    const compose = read('compose.yml');

    expect(compose).toContain('mibbeacon-server:');
    expect(compose).toContain('MIB_BEACON_SERVER_HOST: 0.0.0.0');
    expect(compose).toContain('MIB_BEACON_SERVER_DATA: /data');
    expect(compose).toContain('${MIB_BEACON_SERVER_PORT:-8899}:8899');
    expect(compose).toContain('${MIB_BEACON_TRAP_PORT:-1162}:1162/udp');
    expect(compose).toContain('mibbeacon-server-data:/data');
    expect(compose).toContain('healthcheck:');
    expect(compose).toContain('no-new-privileges:true');
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
});
