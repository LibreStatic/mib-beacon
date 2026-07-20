#!/usr/bin/env node

/**
 * Vendor the MIT-licensed Code-OSS default color themes as strict JSON.
 *
 * Run from the repository root:
 *   pnpm --filter @mibbeacon/ui exec node ../../dev/sync-vscode-themes.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, printParseErrorCode } from 'jsonc-parser';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = join(repositoryRoot, 'packages', 'ui', 'src', 'vscode-default-themes');
const revision = process.env.VSCODE_THEME_REVISION ?? 'da20a6d0ddd819136575cd284741993a9e724c2f';
const upstreamRoot = `https://raw.githubusercontent.com/microsoft/vscode/${revision}`;
const themeFiles = [
  '2026-dark.json',
  '2026-light.json',
  'dark_modern.json',
  'dark_plus.json',
  'dark_vs.json',
  'hc_black.json',
  'hc_light.json',
  'light_modern.json',
  'light_plus.json',
  'light_vs.json',
];

async function download(path) {
  const response = await globalThis.fetch(`${upstreamRoot}/${path}`);
  if (!response.ok) throw new Error(`${response.status} downloading ${path}`);
  return response.text();
}

await mkdir(outputDirectory, { recursive: true });

for (const file of themeFiles) {
  const source = await download(`extensions/theme-defaults/themes/${file}`);
  const errors = [];
  const value = parse(source, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  });
  if (errors.length) {
    throw new Error(
      `${file}: ${errors
        .map(({ error, offset }) => `${printParseErrorCode(error)} at ${offset}`)
        .join(', ')}`,
    );
  }
  await writeFile(join(outputDirectory, file), `${JSON.stringify(value, null, 2)}\n`);
}

const license = await download('LICENSE.txt');
await writeFile(join(outputDirectory, 'CODE-OSS-LICENSE.txt'), license);
await writeFile(
  join(outputDirectory, 'UPSTREAM.md'),
  `# Code-OSS default color themes

These files are normalized JSON copies of the default color themes from
\`microsoft/vscode\` at revision:

\`${revision}\`

Upstream paths:

- \`extensions/theme-defaults/package.json\`
- \`extensions/theme-defaults/themes/*.json\`

The upstream Code-OSS license is included as \`CODE-OSS-LICENSE.txt\`.
The normalization removes JSON-with-comments syntax only; theme data is not
manually restyled.

Regenerate with:

\`\`\`sh
pnpm --filter @mibbeacon/ui exec node ../../dev/sync-vscode-themes.mjs
\`\`\`
`,
);

console.log(`Vendored ${themeFiles.length} Code-OSS themes at ${revision}.`);
