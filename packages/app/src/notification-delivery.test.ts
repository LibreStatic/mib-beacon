import { describe, expect, it, vi } from 'vitest';
import {
  createBrowserNotificationAdapter,
  notifyTrapRule,
  notifyWatchAlert,
  type HostNotificationAdapter,
} from './notification-delivery';

describe('notification delivery preferences', () => {
  it('does not auto-request browser permission from trap events', async () => {
    const requestPermission = vi.fn(async () => 'granted' as const);
    const constructed: Array<{ title: string; options?: { body?: string } }> = [];
    class FakeNotification {
      static permission = 'default' as const;
      static requestPermission = requestPermission;
      constructor(title: string, options?: { body?: string }) {
        constructed.push({ title, options });
      }
    }

    const adapter = createBrowserNotificationAdapter({ Notification: FakeNotification });

    await notifyTrapRule(
      adapter,
      { trapRules: true, watchAlerts: true },
      {
        record: { trapName: 'Link down', trapOid: '1.3.6', sourceAddress: '192.0.2.10' },
        rules: [{ name: 'Critical links' }],
      },
      () => true,
    );

    expect(requestPermission).not.toHaveBeenCalled();
    expect(constructed).toEqual([]);
  });

  it('delivers only enabled notification classes after permission is granted', async () => {
    const sent: Array<{ title: string; body?: string }> = [];
    const adapter: HostNotificationAdapter = {
      label: 'test adapter',
      getPermission: vi.fn(async () => 'granted'),
      requestPermission: vi.fn(async () => 'granted'),
      show: vi.fn(async (message) => sent.push(message)),
    };

    await notifyTrapRule(
      adapter,
      { trapRules: false, watchAlerts: true },
      { record: { trapName: 'Ignored trap', sourceAddress: '192.0.2.11' } },
      () => true,
    );
    await notifyWatchAlert(
      adapter,
      { trapRules: false, watchAlerts: true },
      { name: 'ifInOctets', value: 12, operator: '>', threshold: 10 },
      () => true,
    );

    expect(adapter.getPermission).toHaveBeenCalledTimes(1);
    expect(adapter.requestPermission).not.toHaveBeenCalled();
    expect(sent).toEqual([{ title: 'Watch threshold: ifInOctets', body: '12 > 10' }]);
  });
});
