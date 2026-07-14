import { parentPort } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { parseCheckMibText } from '../../packages/smi/src/index.ts';

if (!parentPort) throw new Error('corpus parse worker must run in a worker thread');

parentPort.on('message', ({ id, content }: { id: number; content: string }) => {
  const started = performance.now();
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...values: unknown[]) => warnings.push(values.map(String).join(' '));
  try {
    const result = parseCheckMibText(content);
    parentPort!.postMessage({
      id,
      durationMs: performance.now() - started,
      warnings,
      ...result,
    });
  } catch (error) {
    parentPort!.postMessage({
      id,
      durationMs: performance.now() - started,
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    console.warn = originalWarn;
  }
});
