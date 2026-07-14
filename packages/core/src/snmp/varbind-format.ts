import {
  formatIntegerDisplayHint,
  formatOctetStringDisplayHint,
  type MibNodeDetail,
} from '@mibbeacon/smi';
import type { DecodedVarbind } from './types';

/** Adds MIB-aware presentation fields without replacing the lossless raw value. */
export function formatVarbindWithMib(
  varbind: DecodedVarbind,
  node: MibNodeDetail | null,
): DecodedVarbind {
  if (varbind.isError || !node) return varbind;
  let formatted = String(varbind.value);
  let label: string | undefined;

  if (node.displayHint && varbind.rawHex) {
    formatted = formatOctetStringDisplayHint(
      Uint8Array.from(varbind.rawHex.split(/\s+/).filter(Boolean).map((byte) => Number.parseInt(byte, 16))),
      node.displayHint,
    );
  } else if (node.displayHint && /^-?\d+$/.test(String(varbind.rawValue ?? varbind.value))) {
    formatted = formatIntegerDisplayHint(
      BigInt(String(varbind.rawValue ?? varbind.value)),
      node.displayHint,
    );
  }

  const numeric = Number(varbind.rawValue ?? varbind.value);
  if (Number.isSafeInteger(numeric) && node.enumValues) {
    label = Object.entries(node.enumValues).find(([, value]) => value === numeric)?.[0];
    if (label) formatted = `${label}(${numeric})`;
  }
  if (node.units) formatted = `${formatted} ${node.units}`;
  return {
    ...varbind,
    formattedValue: formatted,
    ...(label ? { enumLabel: label } : {}),
  };
}
