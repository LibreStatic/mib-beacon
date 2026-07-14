export interface WalkValue {
  oid: string;
  value: string;
  type?: string;
  name?: string;
}

export interface WalkDiffRow {
  oid: string;
  name?: string;
  valueA?: string;
  valueB?: string;
  status: 'equal' | 'different' | 'only-a' | 'only-b';
}

export function parseNumericSnmpwalk(text: string): WalkValue[] {
  const rows: WalkValue[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = /^\.?([0-9]+(?:\.[0-9]+)*)\s*=\s*([^:]+):\s*(.*)$/.exec(line);
    if (!match?.[1] || match[2] === undefined || match[3] === undefined) continue;
    const value = match[3].replace(/^"([\s\S]*)"$/, '$1');
    rows.push({ oid: match[1], type: match[2].trim(), value });
  }
  return rows;
}

export function diffWalks(a: readonly WalkValue[], b: readonly WalkValue[]): WalkDiffRow[] {
  const left = new Map(a.map((row) => [row.oid, row]));
  const right = new Map(b.map((row) => [row.oid, row]));
  const oids = [...new Set([...left.keys(), ...right.keys()])].sort(compareOid);
  return oids.map((oid) => {
    const valueA = left.get(oid);
    const valueB = right.get(oid);
    const status = !valueA
      ? 'only-b'
      : !valueB
        ? 'only-a'
        : valueA.value === valueB.value
          ? 'equal'
          : 'different';
    return {
      oid,
      ...(valueA?.name || valueB?.name ? { name: valueA?.name ?? valueB?.name } : {}),
      ...(valueA ? { valueA: valueA.value } : {}),
      ...(valueB ? { valueB: valueB.value } : {}),
      status,
    };
  });
}

function compareOid(a: string, b: string): number {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? -1) - (right[index] ?? -1);
    if (difference !== 0) return difference;
  }
  return 0;
}
