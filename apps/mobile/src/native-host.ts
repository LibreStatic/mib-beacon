import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Notifications from 'expo-notifications';
import * as Sharing from 'expo-sharing';
import { Buffer } from 'buffer';
import type { HostNotificationAdapter, NotificationPermissionState } from '@mibbeacon/app';

type NativeChartPngCapture = {
  fileName: string;
  base64: string;
  mimeType?: 'image/png';
};

export const NATIVE_NOTIFICATION_CHANNEL_ID = 'mibbeacon-alerts';

function mapNativeNotificationPermission(status: string): NotificationPermissionState {
  if (status === 'granted') return 'granted';
  if (status === 'denied') return 'denied';
  return 'default';
}

async function ensureNotificationChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(NATIVE_NOTIFICATION_CHANNEL_ID, {
    name: 'MIB Beacon alerts',
    importance: Notifications.AndroidImportance.HIGH,
  });
}

export const nativeNotifications: HostNotificationAdapter = {
  label: 'native notifications',
  async getPermission() {
    const permission = await Notifications.getPermissionsAsync();
    return mapNativeNotificationPermission(permission.status);
  },
  async requestPermission() {
    await ensureNotificationChannel();
    const permission = await Notifications.requestPermissionsAsync();
    return mapNativeNotificationPermission(permission.status);
  },
  async show(message) {
    await ensureNotificationChannel();
    await Notifications.scheduleNotificationAsync({
      content: { title: message.title, body: message.body },
      trigger: Platform.OS === 'android' ? { channelId: NATIVE_NOTIFICATION_CHANNEL_ID } : null,
    });
  },
};

export async function shareNativeChartPng(capture: NativeChartPngCapture): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error('File sharing is unavailable.');
  const file = new File(Paths.cache, capture.fileName);
  if (file.exists) file.delete();
  file.create({ intermediates: true });
  const handle = file.open();
  try {
    handle.writeBytes(new Uint8Array(Buffer.from(capture.base64, 'base64')));
  } finally {
    handle.close();
  }
  try {
    await Sharing.shareAsync(file.uri, {
      mimeType: capture.mimeType ?? 'image/png',
      dialogTitle: `Export ${capture.fileName}`,
    });
  } finally {
    if (file.exists) file.delete();
  }
}
