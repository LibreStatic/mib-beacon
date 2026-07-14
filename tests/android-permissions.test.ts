import { describe, expect, it } from 'vitest';
import { declaredPermissions, verifyPermissions } from '../dev/verify-android-permissions.mjs';

describe('Android release permission gate', () => {
  it('allows only Internet and the app-owned receiver signature permission', () => {
    const manifest = `<manifest>
      <uses-permission android:name="android.permission.INTERNET" />
      <uses-permission android:name="com.librestatic.mibbeacon.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION" />
    </manifest>`;
    expect(verifyPermissions(manifest)).toHaveLength(2);
    expect(declaredPermissions(manifest)).toContain('android.permission.INTERNET');
  });

  it('rejects inherited location or storage permissions', () => {
    expect(() =>
      verifyPermissions(`<manifest>
      <uses-permission android:name="android.permission.INTERNET" />
      <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
    </manifest>`),
    ).toThrow('ACCESS_FINE_LOCATION');
  });
});
