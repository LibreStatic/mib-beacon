import { describe, expect, it } from 'vitest';
import { formatIntegerDisplayHint, formatOctetStringDisplayHint } from './display-hint';

describe('DISPLAY-HINT formatting', () => {
  it.each([
    ['MAC address', [0, 17, 34, 51, 68, 255], '1x:', '00:11:22:33:44:ff'],
    ['IPv4 address', [192, 168, 1, 10], '1d.', '192.168.1.10'],
    ['ASCII text', [...Buffer.from('switch-01')], '255a', 'switch-01'],
    [
      'DateAndTime',
      [0x07, 0xea, 7, 13, 3, 30, 45, 0, ...Buffer.from('-'), 3, 0],
      '2d-1d-1d,1d:1d:1d.1d,1a1d:1d',
      '2026-7-13,3:30:45.0,-3:0',
    ],
  ])('formats %s', (_name, bytes, hint, expected) => {
    expect(formatOctetStringDisplayHint(Uint8Array.from(bytes as number[]), hint)).toBe(expected);
  });

  it.each([
    [1234, 'd-2', '12.34'],
    [-5, 'd-2', '-0.05'],
    [255, 'x', 'ff'],
    [8, 'o', '10'],
  ])('formats integer %s with %s', (value, hint, expected) => {
    expect(formatIntegerDisplayHint(value, hint)).toBe(expected);
  });
});
