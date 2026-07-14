import { describe, expect, it, vi } from 'vitest';
import {
  canUseBrowserEventTarget,
  isCommandPaletteShortcut,
  isSearchFocusShortcut,
  queryShortcut,
  SHORTCUTS,
  subscribeCommandPaletteShortcut,
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

describe('command palette shortcuts', () => {
  it.each([
    [{ key: 'p', shiftKey: true, ctrlKey: true }, true, true],
    [{ key: 'P', shiftKey: true, metaKey: true }, true, true],
    [{ key: ' ', code: 'Space', shiftKey: true, ctrlKey: true }, true, true],
    [{ key: ' ', code: 'Space', shiftKey: true, ctrlKey: true }, false, false],
    [{ key: 'p', ctrlKey: true }, true, false],
  ])('classifies %o with web fallback %s', (event, allowWebFallback, expected) => {
    expect(isCommandPaletteShortcut(event, allowWebFallback)).toBe(expected);
  });

  it('subscribes in capture phase and keeps handling the shortcut after the palette opens', () => {
    let listener: ((event: KeyboardEvent) => void) | null = null;
    const target = {
      addEventListener: vi.fn(
        (_type: string, next: (event: KeyboardEvent) => void, _capture?: boolean) => {
          listener = next;
        },
      ),
      removeEventListener: vi.fn(),
    };
    const onShortcut = vi.fn();
    const unsubscribe = subscribeCommandPaletteShortcut(target, true, onShortcut);
    const preventDefault = vi.fn();
    const event = {
      key: ' ',
      code: 'Space',
      ctrlKey: true,
      shiftKey: true,
      preventDefault,
    } as unknown as KeyboardEvent;

    expect(target.addEventListener).toHaveBeenCalledWith('keydown', expect.any(Function), true);
    listener?.(event);
    listener?.(event);
    expect(onShortcut).toHaveBeenCalledTimes(2);
    expect(preventDefault).toHaveBeenCalledTimes(2);

    unsubscribe();
    expect(target.removeEventListener).toHaveBeenCalledWith('keydown', listener, true);
  });
});

describe('shortcut overlay inventory', () => {
  it('documents every executable query shortcut and the overlay key', () => {
    expect(SHORTCUTS.map(([key]) => key)).toEqual(
      expect.arrayContaining([
        '?',
        'Ctrl/Cmd + Shift + P',
        'Ctrl/Cmd + Shift + Space',
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
