/**
 * Pure derivation of a Button's interactive state. Kept in its own
 * React-Native-free module so the busy/disabled/label logic is unit-testable
 * from Node (mirrors the `theme-values` split).
 */
export function resolveButtonState({
  title,
  loading,
  loadingTitle,
  disabled,
}: {
  title: string;
  loading?: boolean;
  loadingTitle?: string;
  disabled?: boolean;
}): { isBusy: boolean; isDisabled: boolean; label: string } {
  const isBusy = Boolean(loading);
  return {
    isBusy,
    isDisabled: Boolean(disabled) || isBusy,
    label: isBusy ? (loadingTitle ?? title) : title,
  };
}
