import { useColorScheme } from 'react-native';

export interface Theme {
  scheme: 'light' | 'dark';
  bg: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  textDim: string;
  accent: string;
  accentText: string;
  accentSoft: string;
  ok: string;
  warn: string;
  error: string;
  errorSoft: string;
  mono: string;
  /** node-kind glyph colors */
  kind: {
    table: string;
    entry: string;
    column: string;
    scalar: string;
    notification: string;
    subtree: string;
    module: string;
  };
}

const dark: Theme = {
  scheme: 'dark',
  bg: '#0b0e13',
  surface: '#141924',
  surfaceAlt: '#1b2231',
  border: '#242e42',
  text: '#e8ecf3',
  textDim: '#8b96a8',
  accent: '#4f8ef7',
  accentText: '#ffffff',
  accentSoft: 'rgba(79,142,247,0.16)',
  ok: '#34d399',
  warn: '#fbbf24',
  error: '#f87171',
  errorSoft: 'rgba(248,113,113,0.14)',
  mono: '#b9c7e0',
  kind: {
    table: '#c084fc',
    entry: '#f59e0b',
    column: '#60a5fa',
    scalar: '#34d399',
    notification: '#f87171',
    subtree: '#64748b',
    module: '#22d3ee',
  },
};

const light: Theme = {
  scheme: 'light',
  bg: '#f4f6f9',
  surface: '#ffffff',
  surfaceAlt: '#eef1f6',
  border: '#d7dde8',
  text: '#131720',
  textDim: '#5c6675',
  accent: '#2563eb',
  accentText: '#ffffff',
  accentSoft: 'rgba(37,99,235,0.10)',
  ok: '#0f9d63',
  warn: '#b45309',
  error: '#dc2626',
  errorSoft: 'rgba(220,38,38,0.08)',
  mono: '#1e293b',
  kind: {
    table: '#7c3aed',
    entry: '#b45309',
    column: '#2563eb',
    scalar: '#0f9d63',
    notification: '#dc2626',
    subtree: '#64748b',
    module: '#0891b2',
  },
};

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}
