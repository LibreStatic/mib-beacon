export function canUseBrowserEventTarget(value: unknown): value is {
  addEventListener: (type: string, listener: EventListener) => void;
  removeEventListener: (type: string, listener: EventListener) => void;
} {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { addEventListener?: unknown; removeEventListener?: unknown };
  return (
    typeof candidate.addEventListener === 'function' &&
    typeof candidate.removeEventListener === 'function'
  );
}

export function isSearchFocusShortcut(event: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
}): boolean {
  return event.key.toLowerCase() === 'f' && Boolean(event.ctrlKey || event.metaKey);
}

export function isCommandPaletteShortcut(
  event: {
    key: string;
    code?: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
  },
  allowWebFallback: boolean,
): boolean {
  if (!event.shiftKey || event.altKey || !(event.ctrlKey || event.metaKey)) return false;
  if (event.key.toLowerCase() === 'p') return true;
  return allowWebFallback && (event.code === 'Space' || event.key === ' ');
}

export function subscribeCommandPaletteShortcut(
  target: {
    addEventListener(
      type: 'keydown',
      listener: (event: KeyboardEvent) => void,
      capture?: boolean,
    ): void;
    removeEventListener(
      type: 'keydown',
      listener: (event: KeyboardEvent) => void,
      capture?: boolean,
    ): void;
  },
  allowWebFallback: boolean,
  onShortcut: () => void,
): () => void {
  const listener = (event: KeyboardEvent) => {
    if (!isCommandPaletteShortcut(event, allowWebFallback)) return;
    event.preventDefault();
    onShortcut();
  };
  target.addEventListener('keydown', listener, true);
  return () => target.removeEventListener('keydown', listener, true);
}

export type QueryShortcut = 'get' | 'getNext' | 'getBulk' | 'set' | 'walk' | 'stop' | 'repeat';

export const SHORTCUTS = [
  ['?', 'Open this shortcut overlay'],
  ['Ctrl/Cmd + Shift + P', 'Open the command palette (desktop and supported browsers)'],
  ['Ctrl/Cmd + Shift + Space', 'Open the command palette in Web LAN'],
  ['Ctrl/Cmd + F', 'Focus MIB search'],
  ['Ctrl/Cmd + G', 'Get'],
  ['Ctrl/Cmd + N', 'Get Next'],
  ['Ctrl/Cmd + B', 'Get Bulk'],
  ['Ctrl/Cmd + W', 'Walk'],
  ['Ctrl/Cmd + S', 'Stage Set'],
  ['Ctrl/Cmd + P', 'Stop the active operation'],
  ['Enter', 'Repeat the selected query operation outside text fields'],
  ['← / →', 'Resize a focused split-pane divider'],
] as const;

export function queryShortcut(event: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  editableTarget?: boolean;
}): QueryShortcut | null {
  const modifier = Boolean(event.ctrlKey || event.metaKey);
  const key = event.key.toLowerCase();
  if (!modifier) return key === 'enter' && !event.editableTarget ? 'repeat' : null;
  return (
    ({ g: 'get', n: 'getNext', b: 'getBulk', s: 'set', w: 'walk', p: 'stop' } as const)[
      key as 'g'
    ] ?? null
  );
}
