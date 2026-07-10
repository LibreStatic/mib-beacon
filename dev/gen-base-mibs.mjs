// Regenerates packages/smi/src/base-mibs.generated.ts by embedding net-snmp's
// bundled base MIB modules as strings, so MibStore can load them via
// ParseModule on every platform (React Native has no fs).
//   node dev/gen-base-mibs.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const dir = 'node_modules/net-snmp/lib/mibs/';
// Order matters — base modules must parse in dependency order (matches
// net-snmp's ModuleStore.BASE_MODULES).
const order = [
  'RFC1155-SMI',
  'RFC1158-MIB',
  'RFC-1212',
  'RFC1213-MIB',
  'RFC-1215',
  'SNMPv2-SMI',
  'SNMPv2-CONF',
  'SNMPv2-TC',
  'SNMPv2-MIB',
];

const entries = order.map((name) => ({ name, content: readFileSync(dir + name + '.mib', 'utf8') }));
const out = `/* eslint-disable */
// GENERATED — base SMI/MIB modules bundled so MibStore loads them via ParseModule
// on every platform (React Native has no fs). Regenerate with dev/gen-base-mibs.mjs.
// Source: net-snmp/lib/mibs (IETF/public-domain RFC MIB modules).
export interface BaseMib { name: string; content: string }
export const BASE_MIBS: BaseMib[] = ${JSON.stringify(entries)};
`;
writeFileSync('packages/smi/src/base-mibs.generated.ts', out);
console.log(`wrote ${entries.length} base modules`);
