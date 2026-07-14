import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

interface CorpusLock {
  version: number;
  corpora: Record<string, { repository: string; revision: string; paths: string[] }>;
}

const corpusDir = dirname(fileURLToPath(import.meta.url));
const lock = JSON.parse(readFileSync(join(corpusDir, 'corpus-lock.json'), 'utf8')) as CorpusLock;

if (lock.version !== 1) throw new Error(`Unsupported corpus lock version: ${lock.version}`);

for (const [name, corpus] of Object.entries(lock.corpora)) {
  if (!/^[0-9a-f]{40}$/.test(corpus.revision)) {
    throw new Error(`${name} revision must be a full 40-character Git commit`);
  }
  const destination = join(corpusDir, name);
  if (existsSync(destination)) rmSync(destination, { recursive: true, force: true });
  run(['init', destination]);
  run(['-C', destination, 'remote', 'add', 'origin', corpus.repository]);
  if (!(corpus.paths.length === 1 && corpus.paths[0] === '.')) {
    run(['-C', destination, 'sparse-checkout', 'init', '--cone']);
    run(['-C', destination, 'sparse-checkout', 'set', ...corpus.paths]);
  }
  run(['-C', destination, 'fetch', '--depth', '1', 'origin', corpus.revision]);
  run(['-C', destination, 'checkout', '--detach', 'FETCH_HEAD']);
  const actual = capture(['-C', destination, 'rev-parse', 'HEAD']);
  if (actual !== corpus.revision) {
    throw new Error(`${name} checkout mismatch: expected ${corpus.revision}, got ${actual}`);
  }
  process.stdout.write(`Fetched ${name} at ${actual}\n`);
}

function run(args: string[]): void {
  execFileSync('git', args, { stdio: 'inherit' });
}

function capture(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}
