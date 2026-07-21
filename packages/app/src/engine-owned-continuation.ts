export async function runEngineOwnedContinuation<T>(
  load: () => Promise<T>,
  owns: () => boolean,
  apply: (value: T) => void,
  reject?: (cause: unknown) => void,
): Promise<void> {
  try {
    const value = await load();
    if (owns()) apply(value);
  } catch (cause) {
    if (owns()) reject?.(cause);
  }
}
