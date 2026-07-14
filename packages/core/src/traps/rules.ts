import type { TrapRule, TrapRuleActions, TrapRuleCondition } from '../api/engine-api';
import type { TrapRecord } from '../snmp/receiver';

export interface TrapRuleEvaluation {
  matchedRuleIds: string[];
  actions: TrapRuleActions;
  notifyRules: TrapRule[];
}

export function matchesTrapRule(condition: TrapRuleCondition, trap: TrapRecord): boolean {
  if (condition.trapOidGlob && !globMatches(condition.trapOidGlob, trap.trapOid ?? '')) return false;
  if (
    condition.sourcePrefixes?.length &&
    !condition.sourcePrefixes.some((prefix) => addressMatchesPrefix(trap.sourceAddress, prefix))
  ) {
    return false;
  }
  if (condition.varbindSubstrings?.length) {
    const haystack = trap.varbinds
      .map((varbind) => `${varbind.name ?? ''} ${varbind.oid} ${String(varbind.value)}`)
      .join('\n')
      .toLocaleLowerCase();
    if (!condition.varbindSubstrings.every((needle) => haystack.includes(needle.toLocaleLowerCase()))) {
      return false;
    }
  }
  return true;
}

export function evaluateTrapRules(rules: readonly TrapRule[], trap: TrapRecord): TrapRuleEvaluation {
  const matched = rules
    .filter((rule) => rule.enabled && matchesTrapRule(rule.condition, trap))
    .sort((left, right) => left.priority - right.priority || left.name.localeCompare(right.name));
  const actions: TrapRuleActions = {};
  for (const rule of matched) {
    if (rule.actions.severity !== undefined) actions.severity = rule.actions.severity;
    if (rule.actions.color !== undefined) actions.color = rule.actions.color;
    if (rule.actions.notify) actions.notify = true;
  }
  return {
    matchedRuleIds: matched.map(({ id }) => id),
    actions,
    notifyRules: matched.filter((rule) => rule.actions.notify),
  };
}

function globMatches(pattern: string, value: string): boolean {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i').test(value);
}

function addressMatchesPrefix(address: string, prefix: string): boolean {
  const [network, bitsText] = prefix.split('/');
  if (bitsText === undefined) return address.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase());
  const bits = Number(bitsText);
  const addressV4 = ipv4(address);
  const networkV4 = ipv4(network ?? '');
  if (addressV4 === null || networkV4 === null || !Number.isInteger(bits) || bits < 0 || bits > 32) {
    return address.toLocaleLowerCase().startsWith((network ?? '').toLocaleLowerCase());
  }
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (addressV4 & mask) === (networkV4 & mask);
}

function ipv4(value: string): number | null {
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map(Number);
  if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return (((octets[0]! << 24) | (octets[1]! << 16) | (octets[2]! << 8) | octets[3]!) >>> 0);
}
