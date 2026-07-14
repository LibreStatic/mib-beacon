import { readFile, readdir, writeFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { classifyCorpusFailure, summarizeCorpusResults, type CorpusFileResult } from './report';

interface Candidate {
  corpus: string;
  absolutePath: string;
  relativePath: string;
  content: string;
}

const corpusDir = dirname(fileURLToPath(import.meta.url));
const corpusNames = ['netdisco', 'librenms'];
const candidates: Candidate[] = [];

for (const corpus of corpusNames) {
  const root = join(corpusDir, corpus);
  for (const absolutePath of await walkFiles(root)) {
    if (absolutePath.includes(`${join(root, '.git')}/`)) continue;
    const content = await readFile(absolutePath, 'utf8').catch(() => '');
    if (!/(?:PIB-)?DEFINITIONS\s*::=\s*BEGIN/i.test(content.slice(0, 256 * 1024))) continue;
    candidates.push({
      corpus,
      absolutePath,
      relativePath: relative(root, absolutePath),
      content,
    });
  }
}

if (candidates.length === 0) {
  throw new Error('No fetched MIB corpus files found. Run `pnpm corpus:fetch` first.');
}
const requestedLimit = Number.parseInt(process.env.CORPUS_LIMIT ?? '', 10);
if (requestedLimit > 0) candidates.splice(requestedLimit);

const results: CorpusFileResult[] = [];
const workerCount = Math.max(
  1,
  Math.min(Number.parseInt(process.env.CORPUS_WORKERS ?? '', 10) || availableParallelism(), 8),
);
const timeoutMs = Number.parseInt(process.env.CORPUS_FILE_TIMEOUT_MS ?? '', 10) || 5_000;
let cursor = 0;
let completed = 0;

await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

const report = {
  generatedAt: new Date().toISOString(),
  revisions: JSON.parse(await readFile(join(corpusDir, 'corpus-lock.json'), 'utf8')) as unknown,
  summary: summarizeCorpusResults(results),
  files: results.sort(
    (left, right) => left.corpus.localeCompare(right.corpus) || left.path.localeCompare(right.path),
  ),
};
await writeFile(join(corpusDir, 'corpus-report.json'), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report.summary, null, 2)}\n`);

async function walkFiles(root: string): Promise<string[]> {
  const output: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) output.push(...(await walkFiles(path)));
    else if (entry.isFile()) output.push(path);
  }
  return output;
}

async function runWorker(): Promise<void> {
  let worker = createWorker();
  while (true) {
    const index = cursor;
    cursor += 1;
    const candidate = candidates[index];
    if (!candidate) break;

    const result = await parseWithTimeout(worker, index, candidate.content, timeoutMs);
    if (result.timedOut) {
      await worker.terminate();
      worker = createWorker();
      results.push({
        corpus: candidate.corpus,
        path: candidate.relativePath,
        status: 'failed',
        durationMs: timeoutMs,
        errorClass: 'MIB_PARSE_TIMEOUT',
        diagnostics: [{ severity: 'error', message: `Parser exceeded ${timeoutMs}ms` }],
      });
    } else if (result.ok && result.warnings.length > 0) {
      results.push({
        corpus: candidate.corpus,
        path: candidate.relativePath,
        status: 'recovered-with-diagnostics',
        durationMs: roundMs(result.durationMs),
        diagnostics: result.warnings.map((message) => ({ severity: 'warning', message })),
      });
    } else if (result.ok) {
      results.push({
        corpus: candidate.corpus,
        path: candidate.relativePath,
        status: 'ok',
        durationMs: roundMs(result.durationMs),
      });
    } else {
      results.push({
        corpus: candidate.corpus,
        path: candidate.relativePath,
        status: 'failed',
        durationMs: roundMs(result.durationMs),
        errorClass: classifyCorpusFailure(result.message),
        diagnostics: [{ severity: 'error', message: result.message }],
      });
    }

    completed += 1;
    if (completed % 100 === 0 || completed === candidates.length) {
      process.stderr.write(`corpus: ${completed}/${candidates.length} files classified\n`);
    }
  }
  await worker.terminate();
}

function createWorker(): Worker {
  return new Worker(new URL('./parse-worker.mjs', import.meta.url));
}

type WorkerResult =
  | { timedOut: true }
  | { timedOut: false; ok: true; durationMs: number; warnings: string[] }
  | { timedOut: false; ok: false; durationMs: number; message: string };

function parseWithTimeout(
  worker: Worker,
  id: number,
  content: string,
  timeout: number,
): Promise<WorkerResult> {
  return new Promise((resolve) => {
    const finish = (result: WorkerResult): void => {
      clearTimeout(timer);
      worker.off('message', onMessage);
      worker.off('error', onError);
      worker.off('exit', onExit);
      resolve(result);
    };
    const onMessage = (message: {
      id: number;
      ok: boolean;
      durationMs: number;
      message?: string;
      warnings?: string[];
    }): void => {
      if (message.id !== id) return;
      finish(
        message.ok
          ? {
              timedOut: false,
              ok: true,
              durationMs: message.durationMs,
              warnings: message.warnings ?? [],
            }
          : {
              timedOut: false,
              ok: false,
              durationMs: message.durationMs,
              message: message.message ?? 'MIB parser rejected the document',
            },
      );
    };
    const onError = (error: Error): void =>
      finish({ timedOut: false, ok: false, durationMs: 0, message: error.message });
    const onExit = (code: number): void =>
      finish({
        timedOut: false,
        ok: false,
        durationMs: 0,
        message: `Corpus worker exited unexpectedly with code ${code}`,
      });
    const timer = setTimeout(() => finish({ timedOut: true }), timeout);
    worker.on('message', onMessage);
    worker.once('error', onError);
    worker.once('exit', onExit);
    worker.postMessage({ id, content });
  });
}

function roundMs(value: number): number {
  return Math.round(value * 100) / 100;
}
