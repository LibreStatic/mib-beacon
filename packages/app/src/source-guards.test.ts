import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const files = walk(SRC);
const uiVscodeThemeSource = readFileSync(join(SRC, '../../ui/src/vscode-theme.ts'), 'utf-8');
const uiPrimitivesSource = readFileSync(join(SRC, '../../ui/src/primitives.tsx'), 'utf-8');
const commandPaletteSource = readFileSync(join(SRC, 'components/CommandPalette.tsx'), 'utf-8');

describe('source guards', () => {
  it('never imports the bare Text primitive from react-native (use @mibbeacon/ui)', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf-8');
      const match = text.match(/import\s*\{([^}]*)\}\s*from\s*'react-native';/s);
      if (!match) continue;
      const names = match[1]!.split(',').map((n) => n.trim());
      if (names.includes('Text')) offenders.push(file.replace(SRC, 'src'));
    }
    expect(offenders).toEqual([]);
  });

  it('uses the ESM jsonc-parser entry that Metro can bundle for native releases', () => {
    expect(uiVscodeThemeSource).toContain("from 'jsonc-parser/lib/esm/main.js'");
    expect(uiVscodeThemeSource).not.toContain("from 'jsonc-parser'");
  });

  it('keeps field and disabled-button copy on contrast-normalized tokens', () => {
    expect(uiPrimitivesSource).toContain('color: t.workbench.inputForeground');
    expect(uiPrimitivesSource).toContain('backgroundColor: t.workbench.inputBackground');
    expect(uiPrimitivesSource).toContain('placeholderTextColor={t.workbench.inputForeground}');
    expect(uiPrimitivesSource).not.toMatch(/opacity:\s*isDisabled\s*\?/);
    expect(commandPaletteSource).not.toContain("backgroundColor: 'transparent'");
  });

  it('routes every app switch through the theme-aware primitive', () => {
    const offenders = files
      .filter((file) => readFileSync(file, 'utf-8').includes('<Switch'))
      .map((file) => file.replace(SRC, 'src'));
    expect(offenders).toEqual([]);
    expect(uiPrimitivesSource).toContain('styles.webSwitchTrack');
    expect(uiPrimitivesSource).toContain('accessibilityRole="switch"');
    expect(uiPrimitivesSource).toContain("'aria-checked': Boolean(props.value)");
  });
});
