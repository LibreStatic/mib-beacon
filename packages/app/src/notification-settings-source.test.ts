import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

describe('notification settings integration', () => {
  it('exposes notification controls in Settings instead of trap-only implicit permission prompts', () => {
    const settingsSource = fs.readFileSync('packages/app/src/screens/SettingsScreen.tsx', 'utf8');
    const navigationSource = fs.readFileSync('packages/app/src/settings-navigation.ts', 'utf8');
    const appRootSource = fs.readFileSync('packages/app/src/AppRoot.tsx', 'utf8');

    expect(navigationSource).toContain("{ id: 'notifications', label: 'Notifications' }");
    expect(settingsSource).toContain('Trap rule notifications');
    expect(settingsSource).toContain('Watch alert notifications');
    expect(settingsSource).toContain('Request notification permission');
    expect(settingsSource).toContain('Notifications are not supported by this host');
    expect(appRootSource).toContain('notifyTrapRule(');
    expect(appRootSource).not.toContain('NotificationApi.requestPermission()');
  });

  it('declares native notification capability for Android hosts', () => {
    const mobilePackage = fs.readFileSync('apps/mobile/package.json', 'utf8');
    const mobileApp = fs.readFileSync('apps/mobile/App.tsx', 'utf8');
    const appJson = fs.readFileSync('apps/mobile/app.json', 'utf8');

    expect(mobilePackage).toContain('expo-notifications');
    expect(mobileApp).toContain("import * as Notifications from 'expo-notifications'");
    expect(mobileApp).toContain('notifications: nativeNotifications');
    expect(appJson).toContain('android.permission.POST_NOTIFICATIONS');
  });
});
