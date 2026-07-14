export function expandIpv4Target(
  target: string,
  options: { maxHosts?: number; includeEdges?: boolean } = {},
): string[] {
  const maxHosts = options.maxHosts ?? 65_536;
  let first: number;
  let last: number;
  if (target.includes('/')) {
    const [address, prefixText] = target.trim().split('/');
    const prefix = Number(prefixText);
    if (!address || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
      throw new Error(`Invalid IPv4 CIDR: ${target}`);
    }
    const value = ipv4ToNumber(address);
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    const network = (value & mask) >>> 0;
    const broadcast = (network | (~mask >>> 0)) >>> 0;
    const includeEdges = options.includeEdges ?? prefix >= 31;
    first = includeEdges ? network : network + 1;
    last = includeEdges ? broadcast : broadcast - 1;
  } else {
    const [start, end, extra] = target.trim().split('-');
    if (!start || !end || extra) throw new Error(`Invalid IPv4 range: ${target}`);
    first = ipv4ToNumber(start);
    last = ipv4ToNumber(end);
  }
  if (last < first) throw new Error(`Invalid or empty IPv4 target: ${target}`);
  const count = last - first + 1;
  if (count > maxHosts) throw new Error(`Discovery target has ${count} hosts and exceeds the ${maxHosts} host limit`);
  return Array.from({ length: count }, (_, index) => numberToIpv4(first + index));
}

function ipv4ToNumber(address: string): number {
  const parts = address.trim().split('.');
  if (parts.length !== 4) throw new Error(`Invalid IPv4 address: ${address}`);
  const octets = parts.map(Number);
  if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    throw new Error(`Invalid IPv4 address: ${address}`);
  }
  return (((octets[0]! << 24) | (octets[1]! << 16) | (octets[2]! << 8) | octets[3]!) >>> 0);
}

function numberToIpv4(value: number): string {
  return [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.');
}
