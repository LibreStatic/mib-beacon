import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

describe('native chart PNG sharing adapter', () => {
  it('keeps native chart export off React Native data URL share intents', () => {
    const chartSource = fs.readFileSync('packages/app/src/components/ToolLineChart.tsx', 'utf8');
    const appRootSource = fs.readFileSync('packages/app/src/AppRoot.tsx', 'utf8');
    const toolsSource = fs.readFileSync('packages/app/src/screens/ToolsScreen.tsx', 'utf8');

    expect(chartSource).toContain('sharePng?: (capture: ChartPngExport) => Promise<void>');
    expect(chartSource).toContain('sharePng?.({');
    expect(chartSource).not.toContain('import {\n  Platform,\n  Pressable,\n  Share,');
    expect(chartSource).not.toContain('Share.share({ url');
    expect(chartSource).not.toContain('data:image/png;base64');
    expect(appRootSource).toContain('shareChartPng?: (capture: ChartPngExport) => Promise<void>');
    expect(toolsSource).toContain('sharePng={shareChartPng}');
  });

  it('writes Android chart PNGs to cache with image/png metadata before sharing', () => {
    const mobileSource = fs.readFileSync('apps/mobile/App.tsx', 'utf8');

    expect(mobileSource).toContain('async shareChartPng(capture)');
    expect(mobileSource).toContain("Buffer.from(capture.base64, 'base64')");
    expect(mobileSource).toContain("mimeType: 'image/png'");
    expect(mobileSource).toContain('capture.fileName');
    expect(mobileSource).toContain('file.delete()');
  });
});
