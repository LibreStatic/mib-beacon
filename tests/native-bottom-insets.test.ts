import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mobileAppSource = readFileSync(new URL('../apps/mobile/App.tsx', import.meta.url), 'utf8');
const appRootSource = readFileSync(
  new URL('../packages/app/src/AppRoot.tsx', import.meta.url),
  'utf8',
);
const dialogSource = readFileSync(
  new URL('../packages/ui/src/dialog.tsx', import.meta.url),
  'utf8',
);

describe('native bottom safe-area handling', () => {
  it('passes the device bottom inset into the compact navigation bar', () => {
    expect(mobileAppSource).toContain('SafeAreaProvider');
    expect(mobileAppSource).toContain('useSafeAreaInsets');
    expect(mobileAppSource).toContain("edges={['top', 'left', 'right']}");
    expect(mobileAppSource).toContain('safeAreaBottomInset={insets.bottom}');
    expect(appRootSource).toContain('safeAreaBottomInset?: number');
    expect(appRootSource).toContain('paddingBottom: TABBAR_BASE_PADDING + safeAreaBottomInset');
    expect(appRootSource).toContain(
      '<SafeAreaBottomInsetProvider bottomInset={safeAreaBottomInset}>',
    );
  });

  it('lets native bottom sheets cover the Android system navigation area', () => {
    expect(dialogSource).toContain('navigationBarTranslucent');
    expect(dialogSource).toContain('statusBarTranslucent');
    expect(dialogSource).toContain('const safeAreaBottomInset = useSafeAreaBottomInset()');
    expect(dialogSource).toContain('paddingBottom: DIALOG_CARD_PADDING + safeAreaBottomInset');
  });
});
