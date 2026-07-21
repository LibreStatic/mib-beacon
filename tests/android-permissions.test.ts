import { describe, expect, it } from 'vitest';
import { declaredPermissions, verifyPermissions } from '../dev/verify-android-permissions.mjs';

describe('Android release permission gate', () => {
  it('allows Internet, runtime notifications, and the app-owned receiver signature permission', () => {
    const manifest = `<manifest>
      <uses-permission android:name="android.permission.INTERNET" />
      <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
      <uses-permission android:name="com.librestatic.mibbeacon.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION" />
    </manifest>`;
    expect(verifyPermissions(manifest)).toHaveLength(3);
    expect(declaredPermissions(manifest)).toContain('android.permission.INTERNET');
    expect(declaredPermissions(manifest)).toContain('android.permission.POST_NOTIFICATIONS');
  });

  it('rejects inherited location or storage permissions', () => {
    expect(() =>
      verifyPermissions(`<manifest>
      <uses-permission android:name="android.permission.INTERNET" />
      <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
    </manifest>`),
    ).toThrow('ACCESS_FINE_LOCATION');
  });

  it('rejects inherited notification scheduling, push, and vendor badge permissions', () => {
    for (const permission of [
      'android.permission.RECEIVE_BOOT_COMPLETED',
      'android.permission.WAKE_LOCK',
      'com.google.android.c2dm.permission.RECEIVE',
      'com.sec.android.provider.badge.permission.WRITE',
    ]) {
      expect(() =>
        verifyPermissions(`<manifest>
        <uses-permission android:name="android.permission.INTERNET" />
        <uses-permission android:name="${permission}" />
      </manifest>`),
      ).toThrow(permission);
    }
  });
});
