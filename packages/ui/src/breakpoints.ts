export type ResponsiveMode = 'compact' | 'medium' | 'expanded';

export const COMPACT_MAX_WIDTH = 639;
export const EXPANDED_MIN_WIDTH = 1024;

export function getResponsiveMode(width: number): ResponsiveMode {
  if (width <= COMPACT_MAX_WIDTH) return 'compact';
  if (width < EXPANDED_MIN_WIDTH) return 'medium';
  return 'expanded';
}
