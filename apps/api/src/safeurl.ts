import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

/** Resolves a hostname to every address it has (A and AAAA). */
export type Lookup = (host: string) => Promise<string[]>;

export const systemLookup: Lookup = async (host) => (await dnsLookup(host, { all: true, verbatim: true })).map((a) => a.address);

const v4 = (ip: string) => ip.split(".").map(Number) as [number, number, number, number];

/**
 * False for any address a server should never be made to call: loopback,
 * private (RFC 1918), carrier-grade NAT, link-local (cloud metadata),
 * unspecified, multicast, reserved, and the IPv6 equivalents, including
 * IPv4-mapped IPv6.
 */
export function isPublicAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) {
    const [a, b] = v4(ip);
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // 100.64/10, carrier-grade NAT
    if (a === 169 && b === 254) return false; // link-local, cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 192 && b === 0) return false; // 192.0.0/24 and 192.0.2/24
    if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
    if (a >= 224) return false; // multicast and reserved
    return true;
  }
  if (kind === 6) {
    const x = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x);
    if (mapped) return isPublicAddress(mapped[1]!);
    if (x === "::" || x === "::1") return false;
    if (/^f[cd]/.test(x)) return false; // unique local fc00::/7
    if (/^fe[89ab]/.test(x)) return false; // link-local fe80::/10
    if (x.startsWith("ff")) return false; // multicast
    if (x.startsWith("64:ff9b:") || x.startsWith("2001:db8:") || x.startsWith("100::")) return false;
    return true;
  }
  return false;
}

/**
 * Null when `raw` is an https URL whose host resolves only to public
 * addresses; otherwise the reason it is refused. Checked when a webhook is
 * registered and again before each delivery (DNS can change in between).
 */
export async function refuseUnsafeUrl(raw: string, lookup: Lookup = systemLookup): Promise<string | null> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "not a URL";
  }
  if (u.protocol !== "https:") return "only https URLs are allowed";
  if (u.username || u.password) return "credentials in the URL are not allowed";
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || /\.(localhost|local|internal|lan|home|corp)$/.test(host) || !host.includes(".") && !isIP(host)) {
    return "the host is not a public name";
  }
  if (isIP(host)) return isPublicAddress(host) ? null : "the address is not public";
  let addrs: string[];
  try {
    addrs = await lookup(host);
  } catch {
    return "the host does not resolve";
  }
  if (addrs.length === 0) return "the host does not resolve";
  return addrs.every(isPublicAddress) ? null : "the host resolves to an address that is not public";
}
