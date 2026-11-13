import { lookup as dnsLookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

/** Resolves a hostname to every address it has (A and AAAA). */
export type Lookup = (host: string) => Promise<string[]>;

export const systemLookup: Lookup = async (host) => (await dnsLookup(host, { all: true, verbatim: true })).map((a) => a.address);

/** IPv4 ranges a server must never call: loopback, private, CGNAT, link-local (cloud metadata), documentation, benchmarking, 6to4 relay, multicast, reserved. */
const BLOCKED_V4 = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 3],
] as const) BLOCKED_V4.addSubnet(net, bits, "ipv4");

/**
 * IPv6 outside global unicast (2000::/3) is never public. Inside it, these
 * are refused outright: documentation, ORCHID, benchmarking, and the
 * transition formats that carry an IPv4 address a relay or gateway would
 * reach for us: 6to4 (2002::/16), Teredo (2001::/32). NAT64 (64:ff9b::/96,
 * 64:ff9b:1::/48) is outside 2000::/3 and refused with everything else there.
 */
const BLOCKED_V6 = new BlockList();
for (const [net, bits] of [["2001::", 32], ["2001:2::", 48], ["2001:10::", 28], ["2001:20::", 28], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20]] as const) {
  BLOCKED_V6.addSubnet(net, bits, "ipv6");
}

/** An IPv6 literal as 8 hextets, embedded dotted-quad included; null when it does not parse. */
export function ipv6Hextets(ip: string): number[] | null {
  let x = ip.toLowerCase();
  if (x.includes("%")) return null; // a zone id names a local interface: never public
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(x);
  if (dotted) {
    if (isIP(dotted[1]!) !== 4) return null;
    const [a, b, c, d] = dotted[1]!.split(".").map(Number) as [number, number, number, number];
    x = `${x.slice(0, -dotted[1]!.length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = x.split("::");
  if (halves.length > 2) return null;
  const part = (s: string) => (s ? s.split(":").map((h) => (/^[0-9a-f]{1,4}$/.test(h) ? parseInt(h, 16) : NaN)) : []);
  const head = part(halves[0]!);
  const tail = halves.length === 2 ? part(halves[1]!) : [];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : fill < 1) return null;
  const out = [...head, ...Array<number>(halves.length === 2 ? fill : 0).fill(0), ...tail];
  return out.length === 8 && out.every((h) => Number.isInteger(h)) ? out : null;
}

const v4Of = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

/**
 * False for any address a server should never be made to call: loopback,
 * private (RFC 1918), carrier-grade NAT, link-local (cloud metadata),
 * unspecified, multicast, reserved, and every IPv6 form that leads back to
 * them: IPv4-mapped (::ffff:a.b.c.d, also written ::ffff:7f00:1),
 * IPv4-compatible (::a.b.c.d), NAT64, 6to4 and Teredo. Hex and dotted forms are
 * normalised to hextets first, so no spelling slips past.
 */
export function isPublicAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return !BLOCKED_V4.check(ip, "ipv4");
  if (kind !== 6) return false;
  const h = ipv6Hextets(ip);
  if (!h) return false;
  // ::ffff:0:0/96 (mapped) and ::/96 (compatible, and :: and ::1): judge the IPv4 address inside.
  if (h.slice(0, 5).every((x) => x === 0) && (h[5] === 0xffff || h[5] === 0)) {
    if (h[5] === 0 && h[6] === 0) return false; // ::, ::1 and ::0.0.x.x
    return isPublicAddress(v4Of(h[6]!, h[7]!));
  }
  if ((h[0]! & 0xe000) !== 0x2000) return false; // outside global unicast 2000::/3
  const canonical = h.map((x) => x.toString(16)).join(":");
  return !BLOCKED_V6.check(canonical, "ipv6");
}

/** A URL that passed the check, with the one public address delivery must connect to. */
export type SafeUrl = { ok: true; address: string; family: 4 | 6 } | { ok: false; reason: string };

/**
 * Checks that `raw` is an https URL whose host resolves only to public
 * addresses, and returns the first of them. Delivery connects to that exact
 * address (pinnedFetch), so a second DNS answer cannot redirect it inward
 * (DNS rebinding). Checked at registration and again before each delivery.
 */
export async function resolveSafeUrl(raw: string, lookup: Lookup = systemLookup): Promise<SafeUrl> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, reason: "not a URL" };
  }
  if (u.protocol !== "https:") return { ok: false, reason: "only https URLs are allowed" };
  if (u.username || u.password) return { ok: false, reason: "credentials in the URL are not allowed" };
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || /\.(localhost|local|internal|lan|home|corp)$/.test(host) || (!host.includes(".") && !isIP(host))) {
    return { ok: false, reason: "the host is not a public name" };
  }
  const literal = isIP(host);
  if (literal) return isPublicAddress(host) ? { ok: true, address: host, family: literal as 4 | 6 } : { ok: false, reason: "the address is not public" };
  let addrs: string[];
  try {
    addrs = await lookup(host);
  } catch {
    return { ok: false, reason: "the host does not resolve" };
  }
  if (addrs.length === 0) return { ok: false, reason: "the host does not resolve" };
  if (!addrs.every(isPublicAddress)) return { ok: false, reason: "the host resolves to an address that is not public" };
  return { ok: true, address: addrs[0]!, family: isIP(addrs[0]!) as 4 | 6 };
}

/** Null when `raw` is safe to call (resolveSafeUrl), otherwise the reason it is refused. */
export async function refuseUnsafeUrl(raw: string, lookup: Lookup = systemLookup): Promise<string | null> {
  const r = await resolveSafeUrl(raw, lookup);
  return r.ok ? null : r.reason;
}

/**
 * A fetch that connects only to `address`, whatever DNS says at connect time.
 * TLS still verifies the certificate against the URL's hostname (SNI is the
 * hostname), so pinning the address weakens nothing.
 */
export function pinnedFetch(address: string, family: 4 | 6): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const { Agent, fetch: undiciFetch } = await import("undici");
    const dispatcher = new Agent({
      connect: {
        lookup: (_host: string, opts: { all?: boolean }, cb: (err: Error | null, address: string | { address: string; family: number }[], family?: number) => void) =>
          opts?.all ? cb(null, [{ address, family }]) : cb(null, address, family),
      },
    });
    try {
      return (await undiciFetch(String(input instanceof Request ? input.url : input), { ...(init as object), dispatcher } as never)) as unknown as Response;
    } finally {
      void dispatcher.close();
    }
  }) as typeof fetch;
}
