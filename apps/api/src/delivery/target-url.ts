import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

export type TargetCheck = { ok: true } | { ok: false; reason: string };

/**
 * Returns the IPv4 address an IPv4 mapped IPv6 address carries, or null.
 *
 * Both spellings are handled, since the URL parser rewrites `::ffff:127.0.0.1`
 * as `::ffff:7f00:1`.
 */
function mappedIpv4(address: string): string | null {
  const rest = address.toLowerCase().match(/^::ffff:(.+)$/)?.[1];
  if (!rest) return null;
  if (rest.includes('.')) return rest;

  const groups = rest.split(':');
  if (groups.length !== 2) return null;

  const high = Number.parseInt(groups[0]!, 16);
  const low = Number.parseInt(groups[1]!, 16);
  if (Number.isNaN(high) || Number.isNaN(low)) return null;

  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
}

/** Ranges that only ever address the machine itself, the local network, or cloud metadata. */
function isBlockedAddress(address: string): boolean {
  const value = mappedIpv4(address) ?? address;

  if (isIP(value) === 4) {
    const [a, b] = value.split('.').map(Number) as [number, number];
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link local, and cloud metadata at 169.254.169.254
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier grade NAT
    if (a >= 224) return true; // multicast and reserved
    return false;
  }

  const ipv6 = value.toLowerCase();
  if (ipv6 === '::' || ipv6 === '::1') return true;
  if (/^f[cd]/.test(ipv6)) return true; // unique local
  if (/^fe[89ab]/.test(ipv6)) return true; // link local
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
