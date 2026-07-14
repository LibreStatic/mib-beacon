export type ResponsiveMode = 'compact' | 'medium' | 'expanded';
export type WorkspaceKey =
  'browse' | 'mibModules' | 'operationConsole' | 'query' | 'traps' | 'mibs' | 'settings';

export const COMPACT_MAX_WIDTH = 639;
export const EXPANDED_MIN_WIDTH = 1024;

export function getResponsiveMode(width: number): ResponsiveMode {
  if (width <= COMPACT_MAX_WIDTH) return 'compact';
  if (width < EXPANDED_MIN_WIDTH) return 'medium';
  return 'expanded';
}

export function getWindowScopedStorageKey(windowId: string, preference: string): string {
  return `mibbeacon:${windowId}:${preference}`;
}

export interface SplitRatioInput {
  containerSize: number;
  ratio: number;
  minPrimary: number;
  minSecondary: number;
}

export function clampSplitRatio({
  containerSize,
  ratio,
  minPrimary,
  minSecondary,
}: SplitRatioInput): number {
  if (containerSize <= 0 || minPrimary + minSecondary > containerSize) return 0.5;
  const minimum = minPrimary / containerSize;
  const maximum = 1 - minSecondary / containerSize;
  return Math.max(minimum, Math.min(maximum, ratio));
}

export function adjustSplitRatio({
  containerSize,
  ratio,
  delta,
  minPrimary,
  minSecondary,
}: SplitRatioInput & { delta: number }): number {
  const next = containerSize <= 0 ? ratio : ratio + delta / containerSize;
  return clampSplitRatio({ containerSize, ratio: next, minPrimary, minSecondary });
}

const DEFAULT_RATIOS: Record<WorkspaceKey, number> = {
  browse: 0.38,
  mibModules: 0.24,
  operationConsole: 0.42,
  query: 0.36,
  traps: 0.42,
  mibs: 0.36,
  settings: 0.28,
};

export function getWorkspaceDefaultRatio(workspace: WorkspaceKey): number {
  return DEFAULT_RATIOS[workspace];
}
