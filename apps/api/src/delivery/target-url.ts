import { lookup as lookupCallback, type LookupAddress, type LookupOptions } from 'node:dns';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export type TargetCheck = { ok: true } | { ok: false; reason: string };

/**
 * Returns the eight groups of an IPv6 address with `::` expanded, or null.
 *
 * A trailing dotted quad, as in `::ffff:127.0.0.1`, becomes the last two groups,
 * so every form of the same address compares the same way.
 */
function ipv6Groups(address: string): string[] | null {
  if (isIP(address) !== 6) return null;

  let value = address.toLowerCase();
  const dotted = value.match(/(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (dotted) {
    const [a, b, c, d] = dotted.split('.').map(Number) as [number, number, number, number];
    const high = ((a << 8) | b).toString(16);
    const low = ((c << 8) | d).toString(16);
    value = `${value.slice(0, -dotted.length)}${high}:${low}`;
  }

  const [head, tail] = value.split('::') as [string, string | undefined];
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  if (tail === undefined) return left.length === 8 ? left : null;

  const middle = Array(8 - left.length - right.length).fill('0') as string[];
  return [...left, ...middle, ...right];
}

/**
 * Returns the IPv4 address an IPv6 address carries, or null.
 *
 * Covers the forms that address an IPv4 host through IPv6: mapped and
 * compatible addresses, NAT64 and 6to4. Each is checked as the IPv4 address it
 * reaches, so `[::ffff:7f00:1]` and `[64:ff9b::7f00:1]` are both loopback.
 */
function embeddedIpv4(address: string): string | null {
  const groups = ipv6Groups(address);
  if (!groups) return null;

  const toDotted = (high: string, low: string): string => {
    const first = Number.parseInt(high, 16);
    const second = Number.parseInt(low, 16);
    if (Number.isNaN(first) || Number.isNaN(second)) return '';
    return [first >> 8, first & 0xff, second >> 8, second & 0xff].join('.');
  };

  const leading = groups.slice(0, 4).every((group) => Number.parseInt(group, 16) === 0);
  if (leading && ['0', 'ffff'].includes(groups[5]!)) return toDotted(groups[6]!, groups[7]!) || null;
  if (groups[0] === '64' && groups[1] === 'ff9b') return toDotted(groups[6]!, groups[7]!) || null;
  if (groups[0] === '2002') return toDotted(groups[1]!, groups[2]!) || null;

  return null;
}

/** Ranges that only ever address the machine itself, the local network, or cloud metadata. */
export function isBlockedAddress(address: string): boolean {
  const value = embeddedIpv4(address) ?? address;

  if (isIP(value) === 4) {
    const [a, b] = value.split('.').map(Number) as [number, number];
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link local, and cloud metadata at 169.254.169.254
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 192 && b === 0) return true; // IETF protocol assignments
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier grade NAT
    if (a >= 224) return true; // multicast and reserved
    return false;
  }

  const ipv6 = value.toLowerCase();
  if (ipv6 === '::' || ipv6 === '::1') return true;
  if (/^f[cd]/.test(ipv6)) return true; // unique local
  if (/^fe[89ab]/.test(ipv6)) return true; // link local
  if (/^fe[c-f]/.test(ipv6)) return true; // site local
  return false;
}

/**
 * Decides whether a forward target may be called.
 *
 * Resolves the host and rejects any address inside a private, loopback, link
 * local or multicast range, so a bin cannot be pointed at services that are
 * only reachable from inside the deployment. Every resolved address is checked,
 * so a name that answers with one public and one private address is rejected.
 *
 * Set `FORWARD_ALLOW_PRIVATE=true` to permit them, which local development
 * needs because forwarding to `localhost` is the normal case there.
 */
export async function checkTargetUrl(raw: string): Promise<TargetCheck> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'not a valid URL' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'only http and https targets are supported' };
  }

  if (process.env.FORWARD_ALLOW_PRIVATE === 'true') return { ok: true };

  const host = url.hostname.replace(/^\[|\]$/g, '');
  let addresses: string[];

  if (isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = (await lookup(host, { all: true })).map((entry) => entry.address);
    } catch {
      return { ok: false, reason: 'host does not resolve' };
    }
  }

  if (addresses.length === 0) return { ok: false, reason: 'host does not resolve' };
  if (addresses.some(isBlockedAddress)) {
    return { ok: false, reason: 'target resolves to an address that is not publicly routable' };
  }

  return { ok: true };
}

/**
 * Resolves a hostname for a connection, failing when any address it answers
 * with is not publicly routable.
 *
 * Pass this as the `lookup` a connection uses, so the addresses that are
 * checked are the ones it connects to. Checking separately before connecting
 * leaves a name free to answer with a public address for the check and a
 * private one for the connection.
 *
 * Honours `FORWARD_ALLOW_PRIVATE` the same way `checkTargetUrl` does.
 */
export function guardedLookup(
  hostname: string,
  options: LookupOptions,
  callback: (error: Error | null, address: string | LookupAddress[], family?: number) => void,
): void {
  lookupCallback(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, []);

    if (process.env.FORWARD_ALLOW_PRIVATE !== 'true' && addresses.some((entry) => isBlockedAddress(entry.address))) {
      return callback(new Error('target resolves to an address that is not publicly routable'), []);
    }

    if (options.all) return callback(null, addresses);
    callback(null, addresses[0]!.address, addresses[0]!.family);
  });
}
