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

export type QueryShortcut = 'get' | 'getNext' | 'getBulk' | 'set' | 'walk' | 'stop' | 'repeat';

export const SHORTCUTS = [
  ['?', 'Open this shortcut overlay'],
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
