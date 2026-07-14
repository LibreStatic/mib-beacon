import type { DecodedVarbind, SnmpVarbindInput } from '../snmp/types';

export interface RowStatusCreateResult {
  mode: 'createAndGo' | 'createAndWait';
  varbinds: DecodedVarbind[];
}

export async function createRowWithFallback(
  send: (varbinds: SnmpVarbindInput[]) => Promise<DecodedVarbind[]>,
  rowStatusOid: string,
  requiredColumns: SnmpVarbindInput[],
): Promise<RowStatusCreateResult> {
  try {
    return {
      mode: 'createAndGo',
      varbinds: await send([
        { oid: rowStatusOid, type: 'Integer', value: '4' },
        ...requiredColumns,
      ]),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/inconsistent(?:Value)?|wrong value/i.test(message)) throw error;
  }
  const created = await send([{ oid: rowStatusOid, type: 'Integer', value: '5' }]);
  const configured = requiredColumns.length > 0 ? await send(requiredColumns) : [];
  const activated = await send([{ oid: rowStatusOid, type: 'Integer', value: '1' }]);
  return { mode: 'createAndWait', varbinds: [...created, ...configured, ...activated] };
}
