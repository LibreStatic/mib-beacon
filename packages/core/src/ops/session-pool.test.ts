import { describe, expect, it } from 'vitest';
import { SerializedSessionPool } from './session-pool';

describe('SerializedSessionPool', () => {
  it('reuses one session per key while serializing same-agent work', async () => {
    const events: string[] = [];
    let created = 0;
    const pool = new SerializedSessionPool<{ id: number; close(): void }>();
    const create = () => ({ id: ++created, close: () => undefined });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = pool.run('agent-a', create, async (session) => {
      events.push(`first:${session.id}`);
      await gate;
    });
    const second = pool.run('agent-a', create, async (session) => {
      events.push(`second:${session.id}`);
    });
    const other = pool.run('agent-b', create, async (session) => {
      events.push(`other:${session.id}`);
    });
    await other;
    expect(events).toEqual(['first:1', 'other:2']);
    release();
    await Promise.all([first, second]);
    expect(events).toEqual(['first:1', 'other:2', 'second:1']);
  });

  it('drops and closes an invalidated session after queued work settles', async () => {
    const closed: number[] = [];
    let created = 0;
    const pool = new SerializedSessionPool<{ id: number; close(): void }>();
    const create = () => ({
      id: ++created,
      close: () => closed.push(created),
    });

    await pool.run('agent-a', create, async (session) => session.id);
    pool.invalidate('agent-a');
    await Promise.resolve();
    expect(closed).toEqual([1]);
    await expect(pool.run('agent-a', create, async (session) => session.id)).resolves.toBe(2);
  });
});
