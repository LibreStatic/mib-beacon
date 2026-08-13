import { act, createElement, useMemo, useState } from 'react';
import fs from 'node:fs';
import { createRoot } from 'test-renderer';
import { describe, expect, it } from 'vitest';
import { ActionRegistry } from './action-registry';
import {
  ActionRegistryProvider,
  useActionRegistrySnapshot,
  useRegisteredActions,
} from './action-registry-react';
import { KEYBOARD_ACTION_IDS } from './keyboard-action-catalog';

const source = (path: string) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function RegisteredActionHarness() {
  const [, setRevision] = useState(0);
  const actions = useMemo(
    () => [
      {
        id: 'test:action',
        label: 'Test action',
        group: 'Test',
        glyph: 'T',
        keywords: [],
        keyboard: { suitable: true },
        palette: { exposed: true },
        enabled: { value: true } as const,
        confirmation: { kind: 'none' } as const,
        platforms: ['web'] as const,
        execute: () => undefined,
      },
    ],
    [],
  );
  useRegisteredActions(actions);
  const snapshot = useActionRegistrySnapshot();
  return createElement(
    'button',
    { onClick: () => setRevision((value) => value + 1) },
    snapshot.length,
  );
}

describe('catalog action integrations', () => {
  it('registers before layout assertions without looping on a subscribed sibling render', () => {
    const registry = new ActionRegistry();
    const renderer = createRoot();
    act(() => {
      renderer.render(
        createElement(
          ActionRegistryProvider,
          { registry, platform: 'web' },
          createElement(RegisteredActionHarness),
        ),
      );
    });

    expect(registry.snapshot().map(({ id }) => id)).toEqual(['test:action']);
    const button = renderer.container.queryAll((node) => node.type === 'button')[0]!;
    act(() => button.props.onClick());
    expect(registry.snapshot()).toHaveLength(1);
    act(() => renderer.unmount());
    expect(registry.snapshot()).toHaveLength(0);
  });

  it.each([
    ['browse', './screens/BrowseScreen.tsx'],
    ['tools', './screens/ToolsScreen.tsx'],
    ['traps', './screens/TrapsScreen.tsx'],
    ['packets', './components/PacketConsole.tsx'],
    ['agents', './screens/AgentsScreen.tsx'],
    ['liveMibs', './screens/LiveMibsScreen.tsx'],
    ['settings', './screens/SettingsScreen.tsx'],
  ] as const)('%s declares its complete catalog slice and shared dispatch path', (owner, path) => {
    const text = source(path);
    expect(text).toContain(`useRegisteredCatalogActions('${owner}'`);
    expect(text).toContain('useRegisteredActionDispatcher');
    if (owner === 'tools') {
      expect(text).toContain('`tools:show-${key}`');
      for (const id of KEYBOARD_ACTION_IDS.tools.filter(
        (value) => !value.startsWith('tools:show-'),
      ))
        expect(text).toContain(`'${id}'`);
    } else if (owner === 'settings') {
      expect(text).toContain(
        "`settings:show-${section.id === 'liveMibs' ? 'live-mibs' : section.id}`",
      );
      for (const id of KEYBOARD_ACTION_IDS.settings.filter(
        (value) => !value.startsWith('settings:show-'),
      ))
        expect(text).toContain(`'${id}'`);
    } else {
      for (const id of KEYBOARD_ACTION_IDS[owner]) expect(text).toContain(`'${id}'`);
    }
  });

  it('keeps confirmations available to contextual pointer and palette dispatch', () => {
    const provider = source('./action-registry-react.tsx');
    const root = source('./AppRoot.tsx');
    expect(provider).toContain('ActionConfirmationContext');
    expect(provider).toContain('authorizeConfirmation');
    expect(root).toContain('authorizeConfirmation={authorizeActionConfirmation}');
  });

  it('keeps the complete catalog mounted through low-priority route fallbacks', () => {
    const root = source('./AppRoot.tsx');
    expect(root).toContain('catalogFallbackActions(selectTab)');
    expect(root).toContain('useRegisteredActions(catalogFallbacks, -100)');
  });

  it('routes destructive pointer controls through the confirmed registry gateway', () => {
    const packets = source('./components/PacketConsole.tsx');
    const settings = source('./screens/SettingsScreen.tsx');
    const traps = source('./screens/TrapsScreen.tsx');
    expect(packets).toContain("dispatchAction('packets:clear')");
    expect(packets).toContain("kind: 'destructive'");
    expect(settings).toContain("dispatchRegistered('settings:reset-split-layout')");
    expect(settings).toContain("dispatchRegistered('settings:reset-packet-dock')");
    for (const scope of ['live-mibs', 'update-preference', 'resolver', 'packet-retention']) {
      expect(settings).toContain(`dispatchRegistered('settings:save-${scope}')`);
      expect(settings).toContain(`dispatchRegistered('settings:retry-${scope}')`);
    }
    expect(traps).toContain("executeAction('traps:toggle-receiver')");
    expect(traps).toContain("kind: 'remote'");
  });

  it('does not replace confirmed traffic actions for every incoming record', () => {
    const packets = source('./components/PacketConsole.tsx');
    const traps = source('./screens/TrapsScreen.tsx');
    expect(packets).toContain('const hasPackets = packets.length > 0;');
    expect(packets).toContain('exporting, hasPackets, open');
    expect(traps).toContain('const hasRecords = records.length > 0;');
    expect(traps).toContain('[hasRecords, mode, receiver.running, requestAction]');
  });

  it('does not replace confirmed Tools cancel actions for unrelated collection refreshes', () => {
    const tools = source('./screens/ToolsScreen.tsx');
    expect(tools).toContain(
      'const activeChartName = charts.find((chart) => chart.id === activeChartId)?.name;',
    );
    expect(tools).toContain('activeChartName,');
  });

  it('consumes trap workspace action events so remounting cannot replay stale commands', () => {
    const traps = source('./screens/TrapsScreen.tsx');
    expect(traps).toContain('onActionRequestConsumed(actionRequest.sequence);');
    expect(traps).toContain('current?.sequence === sequence ? null : current');
  });
});
