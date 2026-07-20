import { THEME_IMPORT_LIMITS, type RawThemeImportFile } from './theme-import';

export async function acquireBrowserThemeFiles(): Promise<RawThemeImportFile[]> {
  if (typeof document === 'undefined') throw new Error('A native theme picker is not configured.');
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.jsonc,.vsix,application/json,application/octet-stream';
    input.multiple = true;
    input.style.display = 'none';
    const settle = (files: RawThemeImportFile[]) => {
      input.remove();
      resolve(files);
    };
    input.addEventListener(
      'change',
      () => {
        void (async () => {
          try {
            const selected = Array.from(input.files ?? []);
            const files: RawThemeImportFile[] = [];
            for (const file of selected) {
              if (file.size > THEME_IMPORT_LIMITS.maxArchiveBytes) {
                throw new Error(`${file.name} exceeds the theme import size limit.`);
              }
              files.push({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
            }
            settle(files);
          } catch (cause) {
            input.remove();
            reject(cause);
          }
        })();
      },
      { once: true },
    );
    input.addEventListener('cancel', () => settle([]), { once: true });
    document.body.append(input);
    input.click();
  });
}
