import { describe, expect, it, vi } from 'vitest';
import {
  canOpenResultTable,
  copyResultText,
  resolveResultNode,
} from './query-result-actions';

describe('query result actions', () => {
  it('resolves an instance OID to its loaded MIB definition before inspection', async () => {
    const mibs = {
      resolve: vi.fn().mockResolvedValue({
        name: 'sysObjectID.0',
        module: 'SNMPv2-MIB',
        definitionOid: '1.3.6.1.2.1.1.2',
      }),
      node: vi.fn().mockResolvedValue({
        oid: '1.3.6.1.2.1.1.2',
        name: 'sysObjectID',
        module: 'SNMPv2-MIB',
        kind: 'scalar',
      }),
    };

    await expect(resolveResultNode(mibs, '1.3.6.1.2.1.1.2.0')).resolves.toMatchObject({
      name: 'sysObjectID',
      kind: 'scalar',
    });
    expect(mibs.node).toHaveBeenCalledWith('1.3.6.1.2.1.1.2', 'SNMPv2-MIB');
  });

  it('only offers table view for table-shaped definitions', () => {
    expect(canOpenResultTable({ kind: 'column' })).toBe(true);
    expect(canOpenResultTable({ kind: 'entry' })).toBe(true);
    expect(canOpenResultTable({ kind: 'table' })).toBe(true);
    expect(canOpenResultTable({ kind: 'scalar' })).toBe(false);
    expect(canOpenResultTable(null)).toBe(false);
  });

  it('falls back to the legacy browser copy path when Clipboard API is unavailable', async () => {
    const legacyCopy = vi.fn().mockReturnValue(true);

    await expect(copyResultText('sysObjectID.0\tvalue\tOID', { legacyCopy })).resolves.toBeUndefined();
    expect(legacyCopy).toHaveBeenCalledWith('sysObjectID.0\tvalue\tOID');
  });

  it('reports a copy failure when no browser copy path succeeds', async () => {
    await expect(
      copyResultText('row', { legacyCopy: vi.fn().mockReturnValue(false) }),
    ).rejects.toThrow('Could not copy the result row');
  });
});
