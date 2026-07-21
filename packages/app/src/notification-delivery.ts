export type NotificationPermissionState = 'unsupported' | 'default' | 'granted' | 'denied';

export interface HostNotificationMessage {
  title: string;
  body?: string;
}

export interface HostNotificationAdapter {
  label: string;
  getPermission(): Promise<NotificationPermissionState>;
  requestPermission(): Promise<NotificationPermissionState>;
  show(message: HostNotificationMessage): Promise<void>;
}

export interface NotificationPreferences {
  trapRules: boolean;
  watchAlerts: boolean;
}

type BrowserNotificationConstructor = {
  permission: 'default' | 'granted' | 'denied';
  requestPermission?: () => Promise<'default' | 'granted' | 'denied'>;
  new (title: string, options?: { body?: string }): unknown;
};

export function createBrowserNotificationAdapter(
  env: { Notification?: BrowserNotificationConstructor } = globalThis as unknown as {
    Notification?: BrowserNotificationConstructor;
  },
): HostNotificationAdapter | null {
  const NotificationApi = env.Notification;
  if (!NotificationApi) return null;
  return {
    label: 'browser notifications',
    async getPermission() {
      return NotificationApi.permission;
    },
    async requestPermission() {
      return NotificationApi.requestPermission ? NotificationApi.requestPermission() : 'denied';
    },
    async show(message) {
      if (NotificationApi.permission !== 'granted') return;
      new NotificationApi(message.title, message.body ? { body: message.body } : undefined);
    },
  };
}

export async function showIfPermitted(
  adapter: HostNotificationAdapter | null | undefined,
  message: HostNotificationMessage,
  owns: () => boolean,
): Promise<boolean> {
  if (!adapter || !owns()) return false;
  const permission = await adapter.getPermission();
  if (permission !== 'granted' || !owns()) return false;
  await adapter.show(message);
  return true;
}

export async function notifyTrapRule(
  adapter: HostNotificationAdapter | null | undefined,
  preferences: NotificationPreferences,
  payload: unknown,
  owns: () => boolean = () => true,
): Promise<boolean> {
  if (!preferences.trapRules) return false;
  const value = payload as {
    record?: { trapName?: string; trapOid?: string; sourceAddress?: string };
    rules?: { name: string }[];
  };
  if (!value.record) return false;
  return showIfPermitted(
    adapter,
    {
      title: value.record.trapName ?? value.record.trapOid ?? 'SNMP notification',
      body: `${value.record.sourceAddress ?? 'unknown source'} · ${value.rules?.map(({ name }) => name).join(', ') ?? 'matched rule'}`,
    },
    owns,
  );
}

export async function notifyWatchAlert(
  adapter: HostNotificationAdapter | null | undefined,
  preferences: NotificationPreferences,
  payload: unknown,
  owns: () => boolean = () => true,
): Promise<boolean> {
  if (!preferences.watchAlerts) return false;
  const value = payload as { name?: string; value?: number; operator?: string; threshold?: number };
  return showIfPermitted(
    adapter,
    {
      title: `Watch threshold: ${value.name ?? 'MIB Beacon'}`,
      body: `${value.value ?? 'value'} ${value.operator ?? ''} ${value.threshold ?? ''}`.trim(),
    },
    owns,
  );
}
