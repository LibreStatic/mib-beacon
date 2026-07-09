import { useColorScheme } from 'react-native';

export interface Theme {
  bg: string;
  card: string;
  border: string;
  text: string;
  textDim: string;
  accent: string;
  ok: string;
  error: string;
  mono: string;
}

const light: Theme = {
  bg: '#f6f7f9',
  card: '#ffffff',
  border: '#d9dde3',
  text: '#12151a',
  textDim: '#5b6472',
  accent: '#2563eb',
  ok: '#15803d',
  error: '#b91c1c',
  mono: '#0b1020',
};

const dark: Theme = {
  bg: '#0e1116',
  card: '#171b22',
  border: '#2a303a',
  text: '#e6e9ee',
  textDim: '#9aa4b2',
  accent: '#60a5fa',
  ok: '#4ade80',
  error: '#f87171',
  mono: '#c8d3e5',
};

/**
 * Minimal light/dark palette for the feasibility spike. Full theming (Tamagui,
 * semantic tokens, density) is plan 09; this exists only so the spike screen is
 * legible in both schemes.
 */
export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}
