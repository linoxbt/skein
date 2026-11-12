// pnpm --filter @skein/e2e e2e
//
// Starts the simulated API on :8787 and drives the web app (already built
// with NEXT_PUBLIC_SKEIN_API=http://localhost:8787 and started on :3000):
// the console's quote and flow end to end, verify (recomputed in the browser,
// by id and from pasted JSON), the ledger's registration block, every page at
// 375 px, the network label on a phone, and axe (WCAG 2 A/AA, moderate and
// worse) on every page. Exits non-zero on any failure. Everything is
// simulated: no money. (The ledger reads the Telegraph node's public miner
// registry; offline, it says the node did not answer.)
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { serve } from "@hono/node-server";
import { simulatedApi } from "@skein/api/simulated";
import { chromium, type Page } from "playwright";

const WEB = process.env.WEB_URL ?? "http://localhost:3000";
const PAGES = ["/", "/how-it-works", "/tutorial", "/console", "/verify", "/policies", "/ledger", "/status", "/docs", "/docs/api"];
// A well-known test key (Foundry's first dev account), so simulated verdicts are signed and the signature step runs.
const ATTESTATION_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const ATTESTER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

const failures: string[] = [];
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};

const { app, key } = await simulatedApi({ fast: false, env: { WEB_ORIGINS: WEB, SKEIN_ATTESTATION_KEY: ATTESTATION_KEY } });
const server = serve({ fetch: app.fetch, port: 8787 });

async function axe(page: Page, path: string) {
  await page.addScriptTag({ content: axeSource });
  const result = (await page.evaluate(async () => {
    // @ts-expect-error injected
    return window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } });
  })) as { violations: { id: string; impact: string | null; nodes: unknown[] }[] };
  // Moderate and worse: the site claims WCAG AA, so a moderate issue fails the build too.
  const serious = result.violations.filter((v) => v.impact === "moderate" || v.impact === "serious" || v.impact === "critical");
  check(serious.length === 0, `axe ${path}${serious.length ? `: ${serious.map((v) => `${v.id} [${v.impact}] (${v.nodes.length})`).join(", ")}` : ""}`);
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1360, height: 1000 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  // The console flow: a conflict token (ending in "c"), streamed live, then verified.
  await page.goto(`${WEB}/console`);
  await page.locator('input[placeholder="0x…"]').fill(`0x${"7".repeat(39)}c`);
  // The quote lands before Run: an estimated cost and each check's availability.
  await page.getByTestId("quote").getByText(/Estimated upstream/).waitFor({ timeout: 15_000 });
  check((await page.getByTestId("quote").locator("li").count()) > 0, "console quotes the run, check by check, before Run");
  // A budget below the required checks' quote is refused here, before any request.
  await page.locator('input[placeholder="0.20"]').fill("0.0001");
  await page.getByText(/BUDGET_TOO_LOW/).first().waitFor({ timeout: 5_000 });
  check(await page.getByRole("button", { name: "Run verdict" }).isDisabled(), "console refuses a budget below the quote locally");
  await page.locator('input[placeholder="0.20"]').fill("");
  await page.locator("input[type=password]").fill(key);
  await page.getByRole("button", { name: "Run verdict" }).click();
  await page.getByText(/Open verdict vrd_/).waitFor({ timeout: 60_000 });
  check(true, "console streams a verdict to the end");
  await page.getByText(/Open verdict vrd_/).click();
  await page.waitForURL(/\/v\/vrd_/);
  await page.getByText("ESCALATE", { exact: false }).first().waitFor();
  check(true, "verdict page shows the conflict as ESCALATE");
  const vid = page.url().split("/v/")[1]!;
  await page.goto(`${WEB}/verify?id=${vid}`);
  await page.getByText("Every step matches.").waitFor({ timeout: 30_000 });
  const steps = page.getByTestId("client-steps").locator("li");
  const states = await steps.evaluateAll((els) => els.map((e) => e.getAttribute("data-state")));
  check(states.length === 7 && states.every((s) => s === "pass"), `verify recomputes every step in the browser (${states.join(",")})`);
  check((await page.getByTestId("server-checks").locator('li[data-state="fail"]').count()) === 0, "verify shows the API's own report, all passing");
  check((await page.getByTestId("published-attester").textContent())?.includes(ATTESTER) ?? false, "verify shows the published attester");

  // Paste mode: the same verdict and its BOM, checked from JSON alone.
  const [vjson, bjson] = await Promise.all([
    fetch(`http://localhost:8787/v1/verdicts/${vid}`).then((r) => r.json()),
    fetch(`http://localhost:8787/v1/verdicts/${vid}/bom`).then((r) => r.json()),
  ]);
  await page.goto(`${WEB}/verify`);
  await page.getByRole("tab", { name: "paste json" }).click();
  await page.getByLabel("Verdict JSON").fill(JSON.stringify({ verdict: vjson, bom: bjson }));
  await page.getByRole("button", { name: "Verify pasted JSON" }).click();
  await page.getByText("Every step matches.").waitFor({ timeout: 30_000 });
  check(true, "verify checks pasted verdict JSON in the browser");
  // An edited verdict is caught, and no step it breaks is shown green.
  await page.getByLabel("Verdict JSON").fill(JSON.stringify({ verdict: { ...vjson, riskBps: vjson.riskBps + 1 }, bom: bjson }));
  await page.getByRole("button", { name: "Verify pasted JSON" }).click();
  await page.getByText("Something changed.").waitFor({ timeout: 30_000 });
  check((await page.getByTestId("client-steps").locator('li[data-state="fail"]').count()) > 0, "verify fails an edited verdict");

  await page.goto(`${WEB}/ledger`);
  await page.getByTestId("registration").getByText("Registration 5137.").waitFor({ timeout: 10_000 });
  await page.getByTestId("registration").getByText(/active|unknown/).first().waitFor({ timeout: 15_000 });
  check(true, "ledger shows the miner registration and its status");
  await page.goto(`${WEB}/console?id=${vid}`);
  await page.getByText(/following vrd_/).waitFor();
  check(true, "console attaches to an existing verdict by id");

  // A refused live stream (here a 429) must not leave the console on "Buying…": it reads the verdict instead.
  await page.route("**/v1/verdicts/*/events", (r) => r.fulfill({ status: 429, contentType: "application/json", body: '{"error":{"code":"RATE_LIMITED","message":"too many requests"}}' }));
  await page.goto(`${WEB}/console`);
  await page.locator('input[placeholder="0x…"]').fill(`0x${"8".repeat(40)}`);
  await page.locator("input[type=password]").fill(key);
  await page.getByRole("button", { name: "Run verdict" }).click();
  await page.getByText(/Open verdict vrd_/).waitFor({ timeout: 60_000 });
  check(await page.getByText(/live stream was refused/).isVisible(), "console falls back to polling when the live stream is refused");
  await page.unroute("**/v1/verdicts/*/events");
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join("; ")}` : ""}`);

  for (const path of [...PAGES, `/v/${vid}`]) {
    await page.goto(`${WEB}${path}`);
    await page.waitForTimeout(800);
    await axe(page, path);
  }

  const phone = await browser.newPage({ viewport: { width: 375, height: 800 } });
  for (const path of [...PAGES, `/v/${vid}`]) {
    await phone.goto(`${WEB}${path}`);
    await phone.waitForTimeout(800);
    const sw = await phone.evaluate(() => document.documentElement.scrollWidth);
    check(sw <= 375, `375 px, no horizontal scroll: ${path} (${sw})`);
  }
  // Real 404 statuses, not 200 pages that say "not found".
  for (const path of ["/v/vrd_doesnotexist", "/v/not-an-id", "/no-such-page"]) {
    const res = await fetch(`${WEB}${path}`);
    check(res.status === 404, `404 status: ${path} (${res.status})`);
  }
  await phone.goto(`${WEB}/`);
  await phone.getByText("Simulated").first().waitFor({ timeout: 10_000 });
  check(true, "network label visible on a phone");
} catch (e) {
  failures.push(String(e));
  console.error(e);
} finally {
  await browser.close();
  server.close();
}
console.log(failures.length ? `\n${failures.length} failure(s)` : "\nall e2e checks passed");
process.exit(failures.length ? 1 : 0);
