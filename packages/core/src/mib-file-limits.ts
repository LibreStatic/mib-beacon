import type { MibTextFile } from '@omc/smi';
import { OmcError } from './errors';

export const MAX_MIB_FILE_COUNT = 1_000;
export const MAX_MIB_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_MIB_BATCH_BYTES = 50 * 1024 * 1024;

export function validateMibFileBatch(files: readonly MibTextFile[]): void {
  if (files.length > MAX_MIB_FILE_COUNT) {
    throw new OmcError('CONTENT_VALIDATION_FAILED', 'MIB batch exceeds 1,000 candidates');
  }
  let total = 0;
  for (const file of files) {
    const bytes = new TextEncoder().encode(file.content).byteLength;
    if (bytes > MAX_MIB_FILE_BYTES) {
      throw new OmcError('CONTENT_VALIDATION_FAILED', `${file.name} exceeds the 5 MiB file limit`);
    }
    total += bytes;
    if (total > MAX_MIB_BATCH_BYTES) {
      throw new OmcError('CONTENT_VALIDATION_FAILED', 'MIB batch exceeds the 50 MiB total limit');
    }
  }
}
