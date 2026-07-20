export {
  COMPACT_MAX_WIDTH,
  EXPANDED_MIN_WIDTH,
  getResponsiveMode,
  type ResponsiveMode,
} from '@mibbeacon/ui/breakpoints';

export type WorkspaceKey =
  'browse' | 'mibModules' | 'operationConsole' | 'query' | 'traps' | 'mibs' | 'settings';

export const BROWSE_CATALOG_SPLIT_MINIMUMS = {
  minPrimary: 160,
  minSecondary: 600,
} as const;

export function shouldUseEmbeddedQuerySplit(
  embedded: boolean,
  supportsSplitView: boolean,
): boolean {
  return embedded && supportsSplitView;
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
  browse: 0.5,
  mibModules: 0.2,
  operationConsole: 0.42,
  query: 0.36,
  traps: 0.42,
  mibs: 0.36,
  settings: 0.28,
};

export function getWorkspaceDefaultRatio(workspace: WorkspaceKey): number {
  return DEFAULT_RATIOS[workspace];
}
