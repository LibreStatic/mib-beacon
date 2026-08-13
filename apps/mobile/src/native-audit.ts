import { Linking, Platform } from 'react-native';
import type { HostNotificationAdapter } from '@mibbeacon/app';

export const NATIVE_AUDIT_NOTIFICATION_TITLE = 'MIB Beacon native adapter audit';
export const NATIVE_AUDIT_NOTIFICATION_BODY = 'Release notification delivery verified.';
export const NATIVE_AUDIT_SHARE_FILE = 'mib-beacon-native-adapter-audit.png';

// A complete 1x1 PNG. Keeping the fixed fixture in the release bundle lets the
// audit exercise the production cache-file/Sharing adapter without accepting
// caller-controlled data or inventing a second native implementation.
export const NATIVE_AUDIT_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

// These exact, argument-free URLs are inert on physical devices. They exist only
// to let CI drive user-visible native effects in an Android emulator release APK.
const AUDIT_URLS = new Set([
  'mibbeacon://localhost/__native-audit/notification',
  'mibbeacon://localhost/__native-audit/share-png',
]);

export function isAndroidEmulator(): boolean {
  if (Platform.OS !== 'android') return false;
  const constants = Platform.constants;
  const fingerprint = String(constants.Fingerprint ?? '').toLowerCase();
  const model = String(constants.Model ?? '').toLowerCase();
  const brand = String(constants.Brand ?? '').toLowerCase();
  return (
    fingerprint.includes('generic') ||
    fingerprint.includes('emulator') ||
    model.includes('sdk_gphone') ||
    model.includes('emulator') ||
    (brand === 'google' && model.includes('sdk'))
  );
}

/**
 * Installs two exact, non-secret audit triggers only on recognized Android
 * emulator builds. Physical devices and every other URL are inert. The triggers
 * exercise already user-reachable local notification and PNG sharing behavior;
 * they grant no authority, expose no data, and never enable arbitrary input.
 */
export function installNativeEffectsAudit(
  notifications: HostNotificationAdapter,
  sharePng: (capture: { fileName: string; base64: string }) => Promise<void>,
): () => void {
  if (!isAndroidEmulator()) return () => undefined;

  let handled: string | null = null;
  const run = async (url: string | null) => {
    if (!url || url === handled || !AUDIT_URLS.has(url)) return;
    if (url === 'mibbeacon://localhost/__native-audit/notification') {
      handled = url;
      await notifications.show({
        title: NATIVE_AUDIT_NOTIFICATION_TITLE,
        body: NATIVE_AUDIT_NOTIFICATION_BODY,
      });
    } else if (url === 'mibbeacon://localhost/__native-audit/share-png') {
      handled = url;
      await sharePng({
        fileName: NATIVE_AUDIT_SHARE_FILE,
        base64: NATIVE_AUDIT_PNG_BASE64,
      });
    }
  };

  void Linking.getInitialURL()
    .then(run)
    .catch((error) => console.error('NATIVE_AUDIT', error));
  const subscription = Linking.addEventListener('url', ({ url }) => {
    void run(url).catch((error) => console.error('NATIVE_AUDIT', error));
  });
  return () => subscription.remove();
}
