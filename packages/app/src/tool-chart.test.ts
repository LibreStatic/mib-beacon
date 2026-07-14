import { describe, expect, it } from 'vitest';
import { chartPoints, polylinePoints } from './tool-chart';

describe('tool chart geometry', () => {
  it('scales time and values into a stable SVG polyline', () => {
    const points = chartPoints([
      { id: 1, seriesId: 's', sampledAt: 100, rawValue: '10', value: 10 },
      { id: 2, seriesId: 's', sampledAt: 200, rawValue: '20', value: 20 },
    ], 100, 50);
    expect(polylinePoints(points)).toBe('0.00,50.00 100.00,0.00');
  });
});
