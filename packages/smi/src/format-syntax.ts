/// <reference path="./net-snmp.d.ts" />
import type { MibModuleEntry } from 'net-snmp';

/**
 * Render a parsed SYNTAX clause as a compact human string.
 * net-snmp stores it either as a plain string ("Integer32") or as an object
 * keyed by the type name whose value carries constraints:
 *   { DisplayString: { sizes: [{min, max}] } }
 *   { INTEGER: { up: 1, down: 2 } }            (enums)
 *   { "SEQUENCE OF": "IfEntry" }               (tables)
 */
export function formatSyntax(syntax: MibModuleEntry['SYNTAX']): string | undefined {
  if (syntax == null) return undefined;
  if (typeof syntax === 'string') return syntax;
  const typeName = Object.keys(syntax)[0];
  if (!typeName) return undefined;
  const detail = (syntax as Record<string, unknown>)[typeName];

  if (typeName === 'SEQUENCE OF') return `SEQUENCE OF ${String(detail)}`;

  if (detail && typeof detail === 'object') {
    const d = detail as Record<string, unknown>;
    if (Array.isArray(d.sizes) && d.sizes.length > 0) {
      const s = d.sizes[0] as { min?: number; max?: number };
      return `${typeName} (SIZE ${s.min ?? '?'}..${s.max ?? '?'})`;
    }
    if (Array.isArray(d.ranges) && d.ranges.length > 0) {
      const r = d.ranges[0] as { min?: number; max?: number };
      return `${typeName} (${r.min ?? '?'}..${r.max ?? '?'})`;
    }
    // enum map: label -> number
    const enums = Object.entries(d).filter(([, v]) => typeof v === 'number');
    if (enums.length > 0) {
      const shown = enums
        .slice(0, 4)
        .map(([label, num]) => `${label}(${num as number})`)
        .join(', ');
      return `${typeName} { ${shown}${enums.length > 4 ? ', …' : ''} }`;
    }
  }
  return typeName;
}

/** Look up an enum label for a numeric value, if the SYNTAX defines one. */
export function enumLabel(syntax: MibModuleEntry['SYNTAX'], value: number): string | undefined {
  if (!syntax || typeof syntax === 'string') return undefined;
  const typeName = Object.keys(syntax)[0];
  if (!typeName) return undefined;
  const detail = (syntax as Record<string, unknown>)[typeName];
  if (!detail || typeof detail !== 'object') return undefined;
  for (const [label, num] of Object.entries(detail as Record<string, unknown>)) {
    if (num === value) return label;
  }
  return undefined;
}
