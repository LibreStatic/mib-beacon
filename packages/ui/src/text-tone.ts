import type { Theme } from './theme-values';

export type TextTone = 'ok' | 'error' | 'warn' | 'dim' | 'accent';

/** Resolve a text tone to a theme color; falls back to the primary text color. */
export function textToneColor(tone: TextTone | undefined, t: Theme): string {
  switch (tone) {
    case 'ok':
      return t.ok;
    case 'error':
      return t.error;
    case 'warn':
      return t.warn;
    case 'dim':
      return t.textDim;
    case 'accent':
      return t.accent;
    default:
      return t.text;
  }
}
