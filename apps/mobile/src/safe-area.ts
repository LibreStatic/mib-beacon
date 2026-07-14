export function getMobileSafeAreaPaddingTop(
  platform: string,
  statusBarHeight: number | undefined,
): number {
  return platform === 'android' ? (statusBarHeight ?? 0) : 0;
}
