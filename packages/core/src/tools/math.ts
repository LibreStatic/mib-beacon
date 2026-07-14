export type PollMode = 'raw' | 'delta' | 'rate-per-sec';

export function counterDelta(previous: string | number, current: string | number, bits: 32 | 64): bigint {
  const before = BigInt(previous);
  const after = BigInt(current);
  if (after >= before) return after - before;
  return (1n << BigInt(bits)) - before + after;
}

export function derivePollValue(
  mode: PollMode,
  raw: string | number,
  previous: { raw: string | number; at: number } | undefined,
  at: number,
  bits: 32 | 64,
): number | null {
  if (mode === 'raw') {
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  }
  if (!previous || at <= previous.at) return null;
  const delta = Number(counterDelta(previous.raw, raw, bits));
  return mode === 'delta' ? delta : delta / ((at - previous.at) / 1_000);
}

export function interfaceUtilization(octetsPerSecond: number, speedBitsPerSecond: number): number | null {
  if (!Number.isFinite(speedBitsPerSecond) || speedBitsPerSecond <= 0) return null;
  return (octetsPerSecond * 8 * 100) / speedBitsPerSecond;
}

export function summarizeSamples(values: number[]): { min: number; max: number; avg: number } | null {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return null;
  return {
    min: Math.min(...finite),
    max: Math.max(...finite),
    avg: finite.reduce((sum, value) => sum + value, 0) / finite.length,
  };
}
