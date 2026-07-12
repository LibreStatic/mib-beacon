export const DEFAULT_MIB_MAX_BYTES = 5 * 1024 * 1024;
const HEADER_SCAN_BYTES = 2 * 1024;

export type MibContentValidation =
  | { ok: true; moduleName: string; warnings: string[] }
  | {
      ok: false;
      code: 'CONTENT_TOO_LARGE' | 'HTML_RESPONSE' | 'INVALID_MIB_HEADER' | 'MODULE_NAME_MISMATCH';
      message: string;
    };

export interface MibContentValidationOptions {
  maxBytes?: number;
}

/** Validate untrusted source text before passing it to the SMI parser. */
export function validateMibContent(
  requestedName: string,
  body: string,
  options: MibContentValidationOptions = {},
): MibContentValidation {
  const maxBytes = options.maxBytes ?? DEFAULT_MIB_MAX_BYTES;
  const bytes = new TextEncoder().encode(body).byteLength;
  if (bytes > maxBytes) {
    return {
      ok: false,
      code: 'CONTENT_TOO_LARGE',
      message: `MIB content is ${bytes} bytes; maximum is ${maxBytes}`,
    };
  }

  const prefix = body.slice(0, HEADER_SCAN_BYTES);
  if (/<html\b|<!doctype\s+html\b/i.test(prefix)) {
    return { ok: false, code: 'HTML_RESPONSE', message: 'Response contains HTML, not a MIB' };
  }

  const header = prefix.match(/^\s*(?:(?:--[^\r\n]*)(?:\r?\n|$)\s*)*([A-Za-z][A-Za-z0-9-]*)\s+(?:PIB-)?DEFINITIONS\b[\s\S]*?::=\s*BEGIN/im);
  if (!header?.[1]) {
    return {
      ok: false,
      code: 'INVALID_MIB_HEADER',
      message: 'No SMI or PIB definition header found in the first 2 KiB',
    };
  }

  const moduleName = header[1];
  if (moduleName.toLowerCase() !== requestedName.trim().toLowerCase()) {
    return {
      ok: false,
      code: 'MODULE_NAME_MISMATCH',
      message: `Requested ${requestedName} but content defines ${moduleName}`,
    };
  }
  return { ok: true, moduleName, warnings: [] };
}
