import { createContext, useContext, type ReactNode } from 'react';
import { useWindowDimensions } from 'react-native';
import { getResponsiveMode, type ResponsiveMode } from './responsive-layout';

export interface ResponsiveLayoutValue {
  width: number;
  height: number;
  mode: ResponsiveMode;
  supportsSplitView: boolean;
}

const ResponsiveLayoutContext = createContext<ResponsiveLayoutValue>({
  width: 390,
  height: 844,
  mode: 'compact',
  supportsSplitView: false,
});

export function ResponsiveLayoutProvider({ children }: { children: ReactNode }) {
  const { width, height } = useWindowDimensions();
  const mode = getResponsiveMode(width);
  return (
    <ResponsiveLayoutContext.Provider
      value={{ width, height, mode, supportsSplitView: mode !== 'compact' }}
    >
      {children}
    </ResponsiveLayoutContext.Provider>
  );
}

export function useResponsiveLayout(): ResponsiveLayoutValue {
  return useContext(ResponsiveLayoutContext);
}
