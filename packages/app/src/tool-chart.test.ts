import { describe, expect, it } from 'vitest';
import { chartPoints, patternMarkerX, patternLatencyPoints, polylinePoints } from './tool-chart';

describe('tool chart geometry', () => {
  it('scales time and values into a stable SVG polyline', () => {
    const points = chartPoints([
      { id: 1, seriesId: 's', sampledAt: 100, rawValue: '10', value: 10 },
      { id: 2, seriesId: 's', sampledAt: 200, rawValue: '20', value: 20 },
    ], 100, 50);
    expect(polylinePoints(points)).toBe('0.00,50.00 100.00,0.00');
  });

  it('maps pattern markers and latency onto the chart timeline', () => {
    const event = {
      id: 1,
      sessionId: 'trace-1',
      seriesId: 's',
      hitIndex: 0,
      hitAt: 1_500,
      elapsedMs: 500,
      latencyMs: 25,
      status: 'success' as const,
    };
    expect(patternMarkerX(event, 100, { minTime: 1_000, maxTime: 2_000 })).toBe(50);
    expect(
      polylinePoints(
        patternLatencyPoints([event], 100, 50, {
          minTime: 1_000,
          maxTime: 2_000,
          maxLatency: 50,
        }),
      ),
    ).toBe('50.00,25.00');
  });
});
