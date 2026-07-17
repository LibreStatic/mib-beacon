import { describe, expect, it } from 'vitest';
import toolsScreenSource from './screens/ToolsScreen.tsx?raw';

function section(start: string, end: string): string {
  const from = toolsScreenSource.indexOf(start);
  const to = toolsScreenSource.indexOf(end, from);
  return toolsScreenSource.slice(from, to);
}

describe('Tools target onboarding', () => {
  it('offers target setup before graph configuration', () => {
    const graphs = section("section === 'graphs'", "section === 'watches'");

    expect(graphs).toContain('Start a graph');
    expect(graphs).toContain('1. Choose where to poll');
    expect(graphs).toContain("openTargetSetup('graphs')");
    expect(graphs).toContain('2. Configure the series');
  });

  it('reuses the target setup path for agent-dependent tools', () => {
    const compare = section("section === 'compare'", "section === 'ports'");
    const ports = section("section === 'ports'", "section === 'reachability'");

    expect(compare).toContain("openTargetSetup('compare')");
    expect(ports).toContain("openTargetSetup('ports')");
  });

  it('presents the target form as an overlay dialog instead of an inline card', () => {
    expect(toolsScreenSource).not.toContain('InlineAgentProfileSetup');
    const dialogs = toolsScreenSource.match(/<AgentProfileDialog/g) ?? [];
    expect(dialogs).toHaveLength(1);
    expect(toolsScreenSource).toContain('visible={targetSetupSection !== null}');
  });

  it('clears an unfinished credential draft when setup moves to another tool', () => {
    const start = toolsScreenSource.indexOf('const openTargetSetup');
    const end = toolsScreenSource.indexOf('const cancelTargetSetup', start);
    const handler = toolsScreenSource.slice(start, end);

    expect(handler).toContain('targetSetupSection !== next');
    expect(handler).toContain('setTargetEditor(EMPTY_AGENT_EDITOR)');
  });
});
