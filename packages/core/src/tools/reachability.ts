export interface PingSummary {
  transmitted: number;
  received: number;
  lossPercent: number;
  minMs?: number;
  avgMs?: number;
  maxMs?: number;
}

export function buildPingArgs(
  hostOs: string | undefined,
  target: string,
  count = 4,
  intervalMs = 1_000,
): string[] {
  const boundedCount = Math.max(1, Math.min(20, Math.trunc(Number.isFinite(count) ? count : 4)));
  if (hostOs === 'win32') return ['-n', String(boundedCount), target];
  const safeInterval = Number.isFinite(intervalMs) ? intervalMs : 1_000;
  const seconds = Math.max(200, Math.min(60_000, Math.trunc(safeInterval))) / 1_000;
  return ['-n', '-c', String(boundedCount), '-i', String(seconds), target];
}

export function parsePingSummary(lines: readonly string[]): PingSummary | null {
  const text = lines.join('\n');
  const unixPackets =
    /(\d+) packets transmitted,\s*(\d+)(?: packets)? received,\s*([\d.]+)% packet loss/i.exec(text);
  const windowsPackets =
    /Packets:\s*Sent = (\d+),\s*Received = (\d+),\s*Lost = \d+ \(([\d.]+)% loss\)/i.exec(text);
  const packets = unixPackets ?? windowsPackets;
  if (!packets?.[1] || !packets[2] || !packets[3]) return null;
  const unixTimes = /(?:rtt|round-trip)[^=]*=\s*([\d.]+)\/([\d.]+)\/([\d.]+)\/[\d.]+\s*ms/i.exec(
    text,
  );
  const windowsTimes = /Minimum = (\d+)ms,\s*Maximum = (\d+)ms,\s*Average = (\d+)ms/i.exec(text);
  return {
    transmitted: Number(packets[1]),
    received: Number(packets[2]),
    lossPercent: Number(packets[3]),
    ...(unixTimes?.[1] && unixTimes[2] && unixTimes[3]
      ? { minMs: Number(unixTimes[1]), avgMs: Number(unixTimes[2]), maxMs: Number(unixTimes[3]) }
      : windowsTimes?.[1] && windowsTimes[2] && windowsTimes[3]
        ? {
            minMs: Number(windowsTimes[1]),
            avgMs: Number(windowsTimes[3]),
            maxMs: Number(windowsTimes[2]),
          }
        : {}),
  };
}
