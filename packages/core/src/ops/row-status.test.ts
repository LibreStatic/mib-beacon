import { describe, expect, it, vi } from 'vitest';
import { createRowWithFallback } from './row-status';

describe('RowStatus create state machine', () => {
  it('uses createAndGo in one PDU when the agent accepts it', async () => {
    const send = vi.fn().mockResolvedValue([]);
    await expect(
      createRowWithFallback(send, '1.3.6.1.9.7', [
        { oid: '1.3.6.1.8.7', type: 'OctetString', value: 'row' },
      ]),
    ).resolves.toMatchObject({ mode: 'createAndGo' });
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[0]).toMatchObject([
      { oid: '1.3.6.1.9.7', value: '4' },
      { oid: '1.3.6.1.8.7', value: 'row' },
    ]);
  });

  it('falls back through createAndWait, column Set, then active', async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error('inconsistentValue'))
      .mockResolvedValue([]);
    await expect(
      createRowWithFallback(send, '1.3.6.1.9.7', [
        { oid: '1.3.6.1.8.7', type: 'Integer', value: '2' },
      ]),
    ).resolves.toMatchObject({ mode: 'createAndWait' });
    expect(send.mock.calls.map(([varbinds]) => varbinds)).toEqual([
      [
        { oid: '1.3.6.1.9.7', type: 'Integer', value: '4' },
        { oid: '1.3.6.1.8.7', type: 'Integer', value: '2' },
      ],
      [{ oid: '1.3.6.1.9.7', type: 'Integer', value: '5' }],
      [{ oid: '1.3.6.1.8.7', type: 'Integer', value: '2' }],
      [{ oid: '1.3.6.1.9.7', type: 'Integer', value: '1' }],
    ]);
  });
});
