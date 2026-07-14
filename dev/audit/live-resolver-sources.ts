#!/usr/bin/env -S pnpm exec tsx
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createBuiltinSources } from '../../packages/resolver/src/sources/builtins';
import { createNodeTransport } from '../../packages/transport/src/node';

const TEST_MODULES: Record<string, string> = {
  pysnmp: 'IF-MIB',
  'pysnmp-github': 'IF-MIB',
  librenms: 'IF-MIB',
  cisco: 'CISCO-SMI',
  'cisco-mirror': 'CISCO-SMI',
  netdisco: 'IF-MIB',
  'mibbrowser-online': 'IF-MIB',
  circitor: 'IF-MIB',
};

const outputIndex = process.argv.indexOf('--output');
const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined;
if (outputIndex >= 0 && !outputPath) throw new Error('--output requires a path');

const sources = createBuiltinSources(createNodeTransport().http);
const results = [];

for (const source of sources) {
  const module = TEST_MODULES[source.id] ?? 'IF-MIB';
  const startedAt = Date.now();
  try {
    const result = await source.fetch(module, { signal: AbortSignal.timeout(45_000) });
    if (result.status === 'found') {
      results.push({
        id: source.id,
        name: source.name,
        configuredEnabled: source.enabled,
        module,
        status: result.status,
        elapsedMs: Date.now() - startedAt,
        location: result.location,
        declaredModule: result.moduleName,
        bytes: Buffer.byteLength(result.content),
        sha256: createHash('sha256').update(result.content).digest('hex'),
        warnings: result.warnings ?? [],
      });
    } else {
      results.push({
        id: source.id,
        name: source.name,
        configuredEnabled: source.enabled,
        module,
        status: result.status,
        elapsedMs: Date.now() - startedAt,
        stage: result.stage,
        httpStatus: result.httpStatus,
        reason: result.reason,
      });
    }
  } catch (error) {
    results.push({
      id: source.id,
      name: source.name,
      configuredEnabled: source.enabled,
      module,
      status: 'error',
      elapsedMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const failedRequired = results.filter(
  (result) => result.configuredEnabled && result.status !== 'found',
);
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  consent: 'Explicit operator-invoked external-network audit; never run during normal startup.',
  requiredEnabledSourcesPassed: failedRequired.length === 0,
  results,
};
const serialized = `${JSON.stringify(report, null, 2)}\n`;

if (outputPath) {
  const absolute = resolve(outputPath);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, serialized);
  console.log(`Live resolver audit written to ${absolute}`);
} else {
  process.stdout.write(serialized);
}

for (const result of results) {
  console.log(
    `${result.configuredEnabled ? 'required' : 'disabled'} ${result.id}: ${result.status} (${result.elapsedMs} ms)`,
  );
}

if (failedRequired.length > 0) {
  console.error(`Live resolver audit failed for: ${failedRequired.map(({ id }) => id).join(', ')}`);
  process.exitCode = 1;
}
