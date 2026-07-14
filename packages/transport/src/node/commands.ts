import { spawn } from 'node:child_process';
import type { CommandRunner } from '../types';

export const nodeCommandRunner: CommandRunner = {
  run(command, args, options = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { shell: false, windowsHide: true });
      const buffers: Record<'stdout' | 'stderr', string> = { stdout: '', stderr: '' };
      const consume = (stream: 'stdout' | 'stderr', chunk: Buffer) => {
        buffers[stream] += chunk.toString('utf8');
        const lines = buffers[stream].split(/\r?\n/);
        buffers[stream] = lines.pop() ?? '';
        for (const line of lines) if (line) options.onLine?.(line, stream);
      };
      child.stdout.on('data', (chunk: Buffer) => consume('stdout', chunk));
      child.stderr.on('data', (chunk: Buffer) => consume('stderr', chunk));
      child.once('error', reject);
      child.once('close', (exitCode, signal) => {
        for (const stream of ['stdout', 'stderr'] as const) {
          if (buffers[stream]) options.onLine?.(buffers[stream], stream);
        }
        resolve({ exitCode, ...(signal ? { signal } : {}) });
      });
      const abort = () => child.kill('SIGTERM');
      options.signal?.addEventListener('abort', abort, { once: true });
      child.once('close', () => options.signal?.removeEventListener('abort', abort));
    });
  },
};
