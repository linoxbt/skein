import { describe, expect, it } from "vitest";
import { isPublicAddress, refuseUnsafeUrl, type Lookup } from "../src/safeurl";

const dns = (map: Record<string, string[]>): Lookup => async (h) => {
  if (!(h in map)) throw new Error("ENOTFOUND");
  return map[h]!;
};

describe("public addresses", () => {
  it("refuses every private, local and reserved range", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "100.64.0.1", "100.127.1.1", "169.254.169.254", "0.0.0.0", "224.0.0.1", "192.0.2.1", "::1", "::", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1"]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
  });
  it("allows public ones", () => {
    for (const ip of ["8.8.8.8", "172.32.0.1", "100.128.0.1", "1.1.1.1", "2606:4700:4700::1111", "::ffff:8.8.8.8", "::ffff:808:808", "2a00:1450:4001:80b::200e"]) expect(isPublicAddress(ip), ip).toBe(true);
  });
  // Each of these reached loopback or cloud metadata before 2026-11-12 (audit M5).
  it("refuses IPv6 spellings of inward IPv4 addresses", () => {
    for (const [ip, what] of [
      ["::ffff:7f00:1", "IPv4-mapped loopback in hex"],
      ["::ffff:a9fe:a9fe", "IPv4-mapped 169.254.169.254 in hex"],
      ["0:0:0:0:0:ffff:7f00:1", "IPv4-mapped, uncompressed"],
      ["::ffff:0:a9fe:a9fe", "IPv4-translated (::ffff:0:0:0/96)"],
      ["::127.0.0.1", "IPv4-compatible"],
      ["::7f00:1", "IPv4-compatible in hex"],
      ["::a9fe:a9fe", "IPv4-compatible metadata"],
      ["64:ff9b::a9fe:a9fe", "NAT64"],
      ["64:ff9b::169.254.169.254", "NAT64 dotted"],
      ["64:ff9b:1::a00:1", "local-use NAT64"],
      ["2002:7f00:1::", "6to4 of loopback"],
      ["2002:a9fe:a9fe::1", "6to4 of metadata"],
      ["2002:808:808::1", "6to4 of a public address: refused all the same"],
      ["2001:0:4136:e378:8000:63bf:80ff:fffe", "Teredo (client 127.0.0.1)"],
      ["2001:db8::1", "documentation"],
      ["fec0::1", "site-local"],
      ["100::1", "discard"],
      ["fe80::1%eth0", "zone id"],
      ["::ffff:7f00:1:2", "malformed"],
    ] as const) {
      expect(isPublicAddress(ip), `${ip} (${what})`).toBe(false);
    }
  });
  it("refuses them in a URL too, as the URL parser rewrites them", async () => {
    const lookup = dns({});
    for (const url of ["https://[::ffff:169.254.169.254]/", "https://[::ffff:127.0.0.1]:8443/", "https://[::127.0.0.1]/", "https://[2002:7f00:1::]/", "https://[64:ff9b::7f00:1]/"]) {
      expect(await refuseUnsafeUrl(url, lookup), url).toMatch(/not public/);
    }
  });
  it("refuses a name that resolves to a mapped address", async () => {
    expect(await refuseUnsafeUrl("https://sneaky.example.com/", dns({ "sneaky.example.com": ["::ffff:a9fe:a9fe"] }))).toMatch(/not public/);
  });
});

describe("webhook URLs", () => {
  const lookup = dns({ "hooks.example.com": ["93.184.216.34"], "evil.example.com": ["10.0.0.5"], "mixed.example.com": ["93.184.216.34", "127.0.0.1"] });
  it("accepts an https URL that resolves to public addresses only", async () => {
    expect(await refuseUnsafeUrl("https://hooks.example.com/skein", lookup)).toBeNull();
  });
  it("refuses http, credentials, internal names, private IPs and names that resolve inward", async () => {
    expect(await refuseUnsafeUrl("http://hooks.example.com/", lookup)).toMatch(/https/);
    expect(await refuseUnsafeUrl("https://u:p@hooks.example.com/", lookup)).toMatch(/credentials/);
    expect(await refuseUnsafeUrl("https://postgres.railway.internal/", lookup)).toMatch(/public name/);
    expect(await refuseUnsafeUrl("https://localhost/", lookup)).toMatch(/public name/);
    expect(await refuseUnsafeUrl("https://169.254.169.254/latest", lookup)).toMatch(/not public/);
    expect(await refuseUnsafeUrl("https://[::1]/", lookup)).toMatch(/not public/);
    expect(await refuseUnsafeUrl("https://evil.example.com/", lookup)).toMatch(/not public/);
    expect(await refuseUnsafeUrl("https://mixed.example.com/", lookup)).toMatch(/not public/);
    expect(await refuseUnsafeUrl("https://nowhere.example.com/", lookup)).toMatch(/resolve/);
    expect(await refuseUnsafeUrl("not a url", lookup)).toMatch(/URL/);
  });
});

describe("pinned delivery", () => {
  it("connects to the address that was checked, whatever the hostname resolves to", async () => {
    const { createServer } = await import("node:http");
    const { pinnedFetch } = await import("../src/safeurl");
    const server = createServer((req, res) => res.end(`reached ${req.headers.host}`));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as { port: number }).port;
    try {
      // This name does not exist in DNS: only the pinned address can answer.
      const res = await pinnedFetch("127.0.0.1", 4)(`http://hooks.nonexistent.invalid:${port}/x`, { method: "POST", body: "{}" });
      expect(await res.text()).toBe(`reached hooks.nonexistent.invalid:${port}`);
    } finally {
      server.close();
    }
  });
});
