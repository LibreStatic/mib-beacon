import type { PatternTraceEvent, PollSample } from '@mibbeacon/core/client';

export interface ChartPoint {
  x: number;
  y: number;
  sample: PollSample;
}

export interface PatternLatencyPoint {
  x: number;
  y: number;
  event: PatternTraceEvent;
}

export function chartPoints(
  samples: readonly PollSample[],
  width: number,
  height: number,
  bounds?: { minTime: number; maxTime: number; minValue: number; maxValue: number },
): ChartPoint[] {
  const usable = samples.filter((sample): sample is PollSample & { value: number } => sample.value !== null && Number.isFinite(sample.value));
  if (usable.length === 0) return [];
  const minTime = bounds?.minTime ?? Math.min(...usable.map((sample) => sample.sampledAt));
  const maxTime = bounds?.maxTime ?? Math.max(...usable.map((sample) => sample.sampledAt));
  const minValue = bounds?.minValue ?? Math.min(...usable.map((sample) => sample.value));
  const maxValue = bounds?.maxValue ?? Math.max(...usable.map((sample) => sample.value));
  const timeSpan = Math.max(1, maxTime - minTime);
  const valueSpan = Math.max(1e-12, maxValue - minValue);
  return usable.map((sample) => ({
    x: ((sample.sampledAt - minTime) / timeSpan) * width,
    y: height - ((sample.value - minValue) / valueSpan) * height,
    sample,
  }));
}

export function polylinePoints(points: readonly { x: number; y: number }[]): string {
  return points.map(({ x, y }) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
}

export function patternMarkerX(
  event: Pick<PatternTraceEvent, 'hitAt'>,
  width: number,
  bounds: { minTime: number; maxTime: number },
): number {
  const timeSpan = Math.max(1, bounds.maxTime - bounds.minTime);
  return ((event.hitAt - bounds.minTime) / timeSpan) * width;
}

export function patternLatencyPoints(
  events: readonly PatternTraceEvent[],
  width: number,
  height: number,
  bounds: { minTime: number; maxTime: number; maxLatency: number },
): PatternLatencyPoint[] {
  const maxLatency = Math.max(1, bounds.maxLatency);
  return events.flatMap((event) => {
    if (event.latencyMs === undefined || !Number.isFinite(event.latencyMs)) return [];
    return [{
      x: patternMarkerX(event, width, bounds),
      y: height - (Math.max(0, event.latencyMs) / maxLatency) * height,
      event,
    }];
  });
}
