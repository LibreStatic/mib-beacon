import { describe, expect, it } from 'vitest';
import chartSource from './components/ToolLineChart.tsx?raw';

describe('ToolLineChart plot bounds', () => {
  it('positions and clips data polylines inside the plot area', () => {
    expect(chartSource).toContain('<ClipPath id={plotClipId}>');
    expect(chartSource).toContain('transform="translate(36 8)"');
    expect(chartSource).toContain('clipPath={`url(#${plotClipId})`}');

    const clippedPlot = chartSource.slice(
      chartSource.indexOf('<G transform="translate(36 8)"'),
      chartSource.indexOf('</G>') + '</G>'.length,
    );
    expect(clippedPlot).toContain('points={polylinePoints(item.points)}');
    expect(clippedPlot).toContain('points={polylinePoints(latencyPoints)}');
  });
});
