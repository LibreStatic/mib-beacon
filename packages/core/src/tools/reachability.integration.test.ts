import { describe, expect, it } from 'vitest';
import { createNodeTransport } from '@mibbeacon/transport/node';
import { createEngine } from '../engine';

const enabled = process.env['MIBBEACON_SYSTEM_COMMAND_FIXTURE'] === '1';

describe.runIf(enabled)('system reachability commands', () => {
  it.each(['ping', 'traceroute'] as const)('streams %s output on the Linux desktop host', async (kind) => {
    const engine = createEngine(createNodeTransport(), { dbPath: ':memory:' });
    const lines: string[] = [];
    let handleId = '';
    let finish!: (kind: string) => void;
    const terminal = new Promise<string>((resolve) => { finish = resolve; });
    const off = engine.events.subscribe('tools', (event) => {
      if (event.handleId !== handleId) return;
      if (event.kind === 'reachability-line') lines.push((event.payload as { line: string }).line);
      if (['done', 'error', 'cancelled'].includes(event.kind)) finish(event.kind);
    });
    handleId = (await engine.tools.reachability.start({ kind, target: '127.0.0.1', count: 1 })).handleId;
    await expect(terminal).resolves.toBe('done');
    off();
    expect(lines.length).toBeGreaterThan(0);
  });
});
