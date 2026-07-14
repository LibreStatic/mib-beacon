import { createContext, useContext, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { createTheme, type DensityMode, type Theme, type ThemeMode } from './theme-values';

export * from './theme-values';

const ThemeContext = createContext<Theme | null>(null);

export function ThemeProvider({
  mode,
  density,
  children,
}: {
  mode: ThemeMode;
  density: DensityMode;
  children: ReactNode;
}) {
  const system = useColorScheme();
  const scheme = mode === 'system' ? (system === 'dark' ? 'dark' : 'light') : mode;
  return (
    <ThemeContext.Provider value={createTheme(scheme, density)}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): Theme {
  const value = useContext(ThemeContext);
  const system = useColorScheme();
  return value ?? createTheme(system === 'dark' ? 'dark' : 'light', 'comfortable');
}
