import { describe, expect, it } from 'vitest';
import {
  canUseBrowserEventTarget,
  isSearchFocusShortcut,
  queryShortcut,
  SHORTCUTS,
} from './browser-shortcuts';

describe('MIB search shortcuts', () => {
  it('rejects React Native window shims without DOM event methods', () => {
    expect(canUseBrowserEventTarget({})).toBe(false);
    expect(
      canUseBrowserEventTarget({
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }),
    ).toBe(true);
  });

  it.each([
    [{ key: 'f', ctrlKey: true }, true],
    [{ key: 'F', metaKey: true }, true],
    [{ key: 'f' }, false],
    [{ key: 'g', ctrlKey: true }, false],
  ])('classifies %o', (event, expected) => {
    expect(isSearchFocusShortcut(event)).toBe(expected);
  });
});

describe('query shortcuts', () => {
  it.each([
    [{ key: 'g', ctrlKey: true }, 'get'],
    [{ key: 'N', metaKey: true }, 'getNext'],
    [{ key: 'b', ctrlKey: true }, 'getBulk'],
    [{ key: 's', ctrlKey: true }, 'set'],
    [{ key: 'w', ctrlKey: true }, 'walk'],
    [{ key: 'p', ctrlKey: true }, 'stop'],
    [{ key: 'Enter' }, 'repeat'],
    [{ key: 'Enter', editableTarget: true }, null],
  ])('maps %o', (event, expected) => expect(queryShortcut(event)).toBe(expected));
});

describe('shortcut overlay inventory', () => {
  it('documents every executable query shortcut and the overlay key', () => {
    expect(SHORTCUTS.map(([key]) => key)).toEqual(
      expect.arrayContaining([
        '?',
        'Ctrl/Cmd + G',
        'Ctrl/Cmd + N',
        'Ctrl/Cmd + B',
        'Ctrl/Cmd + W',
        'Ctrl/Cmd + S',
        'Ctrl/Cmd + P',
        'Enter',
      ]),
    );
  });
});
