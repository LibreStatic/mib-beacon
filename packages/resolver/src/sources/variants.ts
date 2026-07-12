const DEFAULT_EXTENSIONS = ['', '.txt', '.mib', '.my', '.TXT', '.MIB', '.MY'] as const;

/** Return the bounded pysmi-compatible filename candidates for a module name. */
export function getMibFilenameVariants(moduleName: string, fixedExtension?: string): string[] {
  const trimmedName = moduleName.trim();
  if (!trimmedName) return [];

  if (fixedExtension) {
    const extension = fixedExtension.startsWith('.') ? fixedExtension : `.${fixedExtension}`;
    const names = unique([trimmedName, trimmedName.toUpperCase(), trimmedName.toLowerCase()]);
    const extensions = unique([extension, extension.toLowerCase(), extension.toUpperCase()]);
    return names.flatMap((name) => extensions.map((candidate) => `${name}${candidate}`));
  }

  const names = unique([trimmedName, trimmedName.toUpperCase(), trimmedName.toLowerCase()]);
  return names.flatMap((name) => DEFAULT_EXTENSIONS.map((extension) => `${name}${extension}`));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
