import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const forbiddenMibExtension = /\.(mib|my|smi)$/i;
const sensitiveName =
  /(^|\/)(\.env(?:\..*)?|id_(?:rsa|dsa|ecdsa|ed25519)|google-services\.json|[^/]+\.(?:key|p12|pfx|jks|keystore))$/i;
const textExtension = new Set([
  '.js',
  '.cjs',
  '.mjs',
  '.bundle',
  '.json',
  '.html',
  '.xml',
  '.txt',
  '.yml',
  '.yaml',
  '.plist',
  '.md',
  '.pem',
]);
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
];

const roots = process.argv.slice(2).map((path) => resolve(path));
if (!roots.length) throw new Error('Usage: node dev/scan-release-artifacts.mjs PATH [...]');

const temporary = [];
const violations = [];

function inspectFile(path, displayPath) {
  const normalized = displayPath.replaceAll('\\', '/');
  if (forbiddenMibExtension.test(normalized))
    violations.push(`${normalized}: bundled MIB document`);
  if (sensitiveName.test(normalized)) violations.push(`${normalized}: sensitive filename`);
  const stat = statSync(path);
  if (!textExtension.has(extname(path).toLowerCase()) || stat.size > 8 * 1024 * 1024) return;
  const content = readFileSync(path, 'utf8');
  for (const pattern of secretPatterns) {
    if (pattern.test(content))
      violations.push(`${normalized}: content matches secret pattern ${pattern}`);
  }
}

function walk(path, label = basename(path)) {
  const stat = statSync(path);
  if (stat.isDirectory()) {
    for (const entry of readdirSync(path)) walk(join(path, entry), join(label, entry));
    return;
  }
  inspectFile(path, label);
  if (['.apk', '.aab', '.ipa'].includes(extname(path).toLowerCase())) {
    const destination = mkdtempSync(join(tmpdir(), 'mibbeacon-artifact-'));
    temporary.push(destination);
    const result = spawnSync('unzip', ['-qq', path, '-d', destination], { encoding: 'utf8' });
    if (result.status !== 0)
      violations.push(`${label}: archive could not be inspected (${result.stderr.trim()})`);
    else walk(destination, `${label}:contents`);
  }
}

try {
  for (const root of roots) walk(root, relative(process.cwd(), root) || basename(root));
  if (violations.length)
    throw new Error(`Release artifact scan failed:\n- ${violations.join('\n- ')}`);
  process.stdout.write(
    `Release artifact scan passed for ${roots.length} path(s): no vendor MIB files or secrets found.\n`,
  );
} finally {
  for (const path of temporary) rmSync(path, { recursive: true, force: true });
}
