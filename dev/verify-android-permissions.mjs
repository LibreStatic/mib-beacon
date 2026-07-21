import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const ALLOWED_ANDROID_PERMISSIONS = new Set([
  'android.permission.INTERNET',
  'android.permission.POST_NOTIFICATIONS',
  // Android Gradle Plugin generates this app-owned signature permission to protect dynamic receivers.
  'com.librestatic.mibbeacon.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION',
]);

export function declaredPermissions(manifest) {
  return [...manifest.matchAll(/<uses-permission\s+[^>]*android:name="([^"]+)"[^>]*\/?\s*>/g)].map(
    (match) => match[1],
  );
}

export function verifyPermissions(manifest) {
  const permissions = declaredPermissions(manifest);
  const unexpected = permissions.filter(
    (permission) => !ALLOWED_ANDROID_PERMISSIONS.has(permission),
  );
  if (!permissions.includes('android.permission.INTERNET'))
    throw new Error('Merged Android manifest is missing INTERNET');
  if (unexpected.length)
    throw new Error(`Unexpected Android permissions: ${unexpected.join(', ')}`);
  return permissions;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2];
  if (!path) throw new Error('Usage: node dev/verify-android-permissions.mjs MERGED_MANIFEST');
  const permissions = verifyPermissions(readFileSync(path, 'utf8'));
  process.stdout.write(`Android permission audit passed: ${permissions.join(', ')}\n`);
}
