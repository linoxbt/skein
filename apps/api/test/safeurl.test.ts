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
    for (const ip of ["8.8.8.8", "172.32.0.1", "100.128.0.1", "1.1.1.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) expect(isPublicAddress(ip), ip).toBe(true);
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
