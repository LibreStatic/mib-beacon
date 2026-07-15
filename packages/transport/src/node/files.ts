import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { FileStore } from '../types';

export function createNodeFileStore(dataDir?: string): FileStore {
  const base = dataDir ?? path.join(os.homedir(), '.mibbeacon');
  return {
    async readText(p) {
      return fs.readFile(p, 'utf8');
    },
    async writeText(p, content) {
      await fs.mkdir(path.dirname(p), { recursive: true });
      await fs.writeFile(p, content, 'utf8');
    },
    async appendText(p, content) {
      await fs.mkdir(path.dirname(p), { recursive: true });
      await fs.appendFile(p, content, 'utf8');
    },
    async readBytes(p) {
      return new Uint8Array(await fs.readFile(p));
    },
    async writeBytes(p, data) {
      await fs.mkdir(path.dirname(p), { recursive: true });
      await fs.writeFile(p, data);
    },
    async exists(p) {
      try {
        await fs.access(p);
        return true;
      } catch {
        return false;
      }
    },
    async remove(p) {
      await fs.rm(p, { recursive: true, force: true });
    },
    async ensureDir(p) {
      await fs.mkdir(p, { recursive: true });
    },
    dataDir() {
      return base;
    },
    join(...segments) {
      return path.join(...segments);
    },
  };
}
