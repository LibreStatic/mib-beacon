import { createContext, useContext, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { getDefaultThemeForScheme } from './default-themes';
import {
  createTheme,
  resolveThemeProviderTheme,
  type DensityMode,
  type Theme,
  type ThemeMode,
} from './theme-values';
import type { ThemeDescriptor } from './theme-types';

export * from './theme-values';

const ThemeContext = createContext<Theme | null>(null);

export function ThemeProvider({
  mode,
  density,
  lightTheme,
  darkTheme,
  children,
}: {
  mode: ThemeMode;
  density: DensityMode;
  lightTheme?: ThemeDescriptor;
  darkTheme?: ThemeDescriptor;
  children: ReactNode;
}) {
  const system = useColorScheme();
  const systemScheme = system === 'dark' ? 'dark' : 'light';
  return (
    <ThemeContext.Provider
      value={resolveThemeProviderTheme({
        mode,
        systemScheme,
        density,
        lightTheme: lightTheme ?? getDefaultThemeForScheme('light'),
        darkTheme: darkTheme ?? getDefaultThemeForScheme('dark'),
      })}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): Theme {
  const value = useContext(ThemeContext);
  const system = useColorScheme();
  const scheme = system === 'dark' ? 'dark' : 'light';
  return value ?? createTheme(scheme, 'comfortable', getDefaultThemeForScheme(scheme));
}
