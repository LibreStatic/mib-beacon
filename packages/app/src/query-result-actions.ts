import type { MibNodeDetail, MibsAPI } from '@mibbeacon/core/client';

type ResultMibsAPI = Pick<MibsAPI, 'resolve' | 'node'>;

export async function resolveResultNode(
  mibs: ResultMibsAPI,
  instanceOid: string,
): Promise<MibNodeDetail | null> {
  const resolved = await mibs.resolve(instanceOid);
  if (!resolved) return null;
  return mibs.node(resolved.definitionOid, resolved.module);
}

export function canOpenResultTable(
  node: Pick<MibNodeDetail, 'kind'> | null | undefined,
): boolean {
  return node != null && ['table', 'entry', 'column'].includes(node.kind);
}

interface CopyResultEnvironment {
  clipboard?: { writeText(text: string): Promise<void> };
  legacyCopy?: (text: string) => boolean;
}

function legacyBrowserCopy(text: string): boolean {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  return copied;
}

function browserCopyEnvironment(): CopyResultEnvironment {
  return {
    clipboard: typeof navigator !== 'undefined' ? navigator.clipboard : undefined,
    legacyCopy: legacyBrowserCopy,
  };
}

export async function copyResultText(
  text: string,
  environment: CopyResultEnvironment = browserCopyEnvironment(),
): Promise<void> {
  if (environment.clipboard) {
    try {
      await environment.clipboard.writeText(text);
      return;
    } catch {
      // LAN-hosted HTTP pages do not always have Clipboard API permission.
    }
  }
  if (environment.legacyCopy?.(text)) return;
  throw new Error('Could not copy the result row in this browser.');
}
