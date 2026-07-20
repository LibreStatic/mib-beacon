import { createContext, useContext, type ReactNode } from 'react';

const SafeAreaBottomInsetContext = createContext(0);

export function SafeAreaBottomInsetProvider({
  bottomInset,
  children,
}: {
  bottomInset: number;
  children: ReactNode;
}) {
  return (
    <SafeAreaBottomInsetContext.Provider value={bottomInset}>
      {children}
    </SafeAreaBottomInsetContext.Provider>
  );
}

export function useSafeAreaBottomInset(): number {
  return useContext(SafeAreaBottomInsetContext);
}
