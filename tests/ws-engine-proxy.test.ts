import { describe, expect, it } from 'vitest';
import { omitTrailingUndefined } from '../apps/server/src/web/ws-engine-proxy';

describe('websocket engine proxy arguments', () => {
  it('omits trailing optional arguments before JSON serializes them as null', () => {
    expect(omitTrailingUndefined(['series-1', undefined])).toEqual(['series-1']);
    expect(omitTrailingUndefined(['agent-1', '7', true, undefined])).toEqual([
      'agent-1',
      '7',
      true,
    ]);
    expect(omitTrailingUndefined([undefined])).toEqual([]);
  });

  it('preserves intentional null values and defined falsy arguments', () => {
    expect(omitTrailingUndefined(['series-1', null])).toEqual(['series-1', null]);
    expect(omitTrailingUndefined(['series-1', 0, false])).toEqual(['series-1', 0, false]);
  });
});
