import { describe, expect, it } from 'vitest';
import toolsScreenSource from './screens/ToolsScreen.tsx?raw';
import chartSource from './components/ToolLineChart.tsx?raw';
import appRootSource from './AppRoot.tsx?raw';

describe('pattern tracer UI wiring', () => {
  it('exposes active and historical tracer controls and persistence actions', () => {
    expect(toolsScreenSource).toContain('Active test');
    expect(toolsScreenSource).toContain('Annotate history');
    expect(toolsScreenSource).toContain('patterns.start(');
    expect(toolsScreenSource).toContain('patterns.annotate(');
    expect(toolsScreenSource).toContain('patterns.cancel(');
    expect(toolsScreenSource).toContain('patterns.remove(');
    expect(toolsScreenSource).not.toContain('engine.tools.patterns.start');
    expect(toolsScreenSource).not.toContain('engine.tools.patterns.annotate');
    expect(toolsScreenSource).not.toContain('engine.tools.patterns.remove');
    expect(appRootSource).toContain('disposePatternPersistentCollectionsController(engine)');
    expect(toolsScreenSource).toContain('hiddenPatternSessionIds');
    expect(toolsScreenSource).toContain("['done', 'error', 'pattern-finished']");
    expect(toolsScreenSource).toContain("patternStopping ? 'STOPPING' : 'RUNNING'");
  });

  it('renders marker lines and a latency polyline in the exported SVG', () => {
    expect(chartSource).toContain('patternMarkerX');
    expect(chartSource).toContain('patternLatencyPoints');
    expect(chartSource).toContain('strokeDasharray="5 3"');
    expect(chartSource).toContain('strokeDasharray="2 4"');
  });
});
