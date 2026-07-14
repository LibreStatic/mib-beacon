import { describe, expect, it } from 'vitest';
import { buildPingArgs, parsePingSummary } from './reachability';

describe('reachability helpers', () => {
  it('builds bounded Linux, macOS, and Windows ping arguments', () => {
    expect(buildPingArgs('linux', 'example.test', 3, 500)).toEqual([
      '-n',
      '-c',
      '3',
      '-i',
      '0.5',
      'example.test',
    ]);
    expect(buildPingArgs('darwin', 'example.test', 2, 1_250)).toEqual([
      '-n',
      '-c',
      '2',
      '-i',
      '1.25',
      'example.test',
    ]);
    expect(buildPingArgs('win32', 'example.test', 4, 250)).toEqual(['-n', '4', 'example.test']);
  });

  it('parses Unix and Windows packet-loss and latency summaries', () => {
    expect(
      parsePingSummary([
        '4 packets transmitted, 3 received, 25% packet loss, time 3004ms',
        'rtt min/avg/max/mdev = 1.100/2.200/3.300/0.500 ms',
      ]),
    ).toEqual({ transmitted: 4, received: 3, lossPercent: 25, minMs: 1.1, avgMs: 2.2, maxMs: 3.3 });
    expect(
      parsePingSummary([
        'Packets: Sent = 4, Received = 4, Lost = 0 (0% loss),',
        'Minimum = 7ms, Maximum = 11ms, Average = 9ms',
      ]),
    ).toEqual({ transmitted: 4, received: 4, lossPercent: 0, minMs: 7, avgMs: 9, maxMs: 11 });
  });
});
