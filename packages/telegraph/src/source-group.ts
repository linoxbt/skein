/**
 * Hosting suffixes under which each subdomain is a different tenant, so the
 * tenant label (not the platform) identifies the operator.
 */
const TENANT_SUFFIXES = ["onrender.com", "vercel.app", "up.railway.app", "pages.dev", "netlify.app", "fly.dev", "github.io"];

/** Shared hosts where the operator is the account label one level below the platform. */
const ACCOUNT_SUFFIXES = ["workers.dev"];

const SECOND_LEVEL = new Set(["co.uk", "com.au", "co.jp", "com.br"]);

/**
 * The upstream provider family of a miner, from its base_url, for the
 * engine's independence groups. Miners that wrap the same API or are run by
 * the same operator collapse to one group:
 *   https://api.dexscreener.com             -> dexscreener.com
 *   https://telegraph-verify.margyn.workers.dev -> margyn.workers.dev
 *   https://omni-chat.13.237.89.59.sslip.io -> 13.237.89.59
 */
export function sourceGroup(baseUrl: string): string {
  let host: string;
  try {
    host = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return `invalid:${baseUrl.slice(0, 64)}`;
  }
  const ip = host.match(/(\d{1,3}(?:\.\d{1,3}){3})(?:\.(?:sslip|nip)\.io)?$/);
  if (ip) return ip[1]!;
  for (const s of ACCOUNT_SUFFIXES) {
    if (host.endsWith(`.${s}`)) {
      const labels = host.slice(0, -(s.length + 1)).split(".");
      return `${labels[labels.length - 1]}.${s}`;
    }
  }
  for (const s of TENANT_SUFFIXES) {
    if (host.endsWith(`.${s}`)) return host;
  }
  const labels = host.split(".");
  const last2 = labels.slice(-2).join(".");
  return SECOND_LEVEL.has(last2) ? labels.slice(-3).join(".") : last2;
}
