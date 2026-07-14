import { readFileSync, statSync } from 'node:fs';
import { basename, extname } from 'node:path';

const MIB_EXTENSIONS = new Set(['.mib', '.my', '.smi']);
export const MAX_ASSOCIATED_FILE_BYTES = 5 * 1024 * 1024;

interface SerializedMibFile {
  name: string;
  relativePath: string;
  contentBase64: string;
}

export interface AssociatedMibImport {
  name: string;
  relativePath: string;
  bytes: Uint8Array;
}

/** Extract only supported MIB documents from OS launch/second-instance arguments. */
export function mibPathsFromArguments(arguments_: readonly string[]): string[] {
  return [
    ...new Set(arguments_.filter((value) => MIB_EXTENSIONS.has(extname(value).toLowerCase()))),
  ];
}

export function isMibAssociationPath(path: string): boolean {
  return MIB_EXTENSIONS.has(extname(path).toLowerCase());
}

/**
 * Read launch documents while the launching process can still access them.
 *
 * Flatpak's document portal may expose a forwarded file only inside the new
 * sandbox. Electron then gives the already-running instance that sandbox-only
 * path, which it cannot necessarily read. Single-instance additional data is
 * the portable handoff channel between those processes.
 */
export function createMibSingleInstanceData(
  arguments_: readonly string[],
  maxBytes = MAX_ASSOCIATED_FILE_BYTES,
): Record<string, unknown> {
  const mibbeaconAssociatedMibFiles: SerializedMibFile[] = [];
  for (const path of mibPathsFromArguments(arguments_)) {
    try {
      if (statSync(path).size > maxBytes) continue;
      const bytes = readFileSync(path);
      if (bytes.byteLength > maxBytes) continue;
      mibbeaconAssociatedMibFiles.push({
        name: basename(path),
        // OS associations select one document, not a directory tree. Never
        // expose an absolute host/portal path to the renderer: its import
        // validator intentionally rejects absolute paths.
        relativePath: basename(path),
        contentBase64: bytes.toString('base64'),
      });
    } catch {
      // The primary process still attempts the original path as a fallback.
    }
  }
  return { mibbeaconAssociatedMibFiles };
}

/** Decode and strictly validate file bytes supplied by a sibling app process. */
export function mibImportsFromSingleInstanceData(
  data: unknown,
  maxBytes = MAX_ASSOCIATED_FILE_BYTES,
): AssociatedMibImport[] {
  if (!data || typeof data !== 'object') return [];
  const value = (data as { mibbeaconAssociatedMibFiles?: unknown }).mibbeaconAssociatedMibFiles;
  if (!Array.isArray(value)) return [];
  const imports: AssociatedMibImport[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') continue;
    const { name, relativePath, contentBase64 } = candidate as Partial<SerializedMibFile>;
    if (
      typeof name !== 'string' ||
      typeof relativePath !== 'string' ||
      typeof contentBase64 !== 'string' ||
      relativePath !== name ||
      name !== basename(name) ||
      !isMibAssociationPath(name) ||
      contentBase64.length > Math.ceil(maxBytes / 3) * 4 + 4
    ) {
      continue;
    }
    const bytes = Buffer.from(contentBase64, 'base64');
    if (bytes.byteLength > maxBytes || bytes.toString('base64') !== contentBase64) continue;
    imports.push({ name, relativePath, bytes: new Uint8Array(bytes) });
  }
  return imports;
}
