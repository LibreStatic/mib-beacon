import { describe, expect, it } from 'vitest';
import { createTheme } from '@mibbeacon/ui/theme-values';
import { textToneColor } from '@mibbeacon/ui/text-tone';

const theme = createTheme('dark', 'comfortable');

describe('text tone color', () => {
  it('defaults to the primary text color when no tone is given', () => {
    expect(textToneColor(undefined, theme)).toBe(theme.text);
  });

  it('maps each tone to its theme token', () => {
    expect(textToneColor('ok', theme)).toBe(theme.ok);
    expect(textToneColor('error', theme)).toBe(theme.error);
    expect(textToneColor('warn', theme)).toBe(theme.warn);
    expect(textToneColor('dim', theme)).toBe(theme.textDim);
    expect(textToneColor('accent', theme)).toBe(theme.accent);
  });
});
