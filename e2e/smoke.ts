// pnpm --filter @skein/e2e e2e
//
// Starts the simulated API on :8787 and drives the web app (already built
// with NEXT_PUBLIC_SKEIN_API=http://localhost:8787 and started on :3000):
// the console flow end to end, verify, every page at 375 px, the network
// label on a phone, and axe (WCAG 2 A/AA) on every page. Exits non-zero on
// any failure. Everything is simulated: no network, no money.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { serve } from "@hono/node-server";
import { simulatedApi } from "@skein/api/simulated";
import { chromium, type Page } from "playwright";

const WEB = process.env.WEB_URL ?? "http://localhost:3000";
const PAGES = ["/", "/how-it-works", "/tutorial", "/console", "/verify", "/policies", "/ledger", "/status", "/docs"];
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

const failures: string[] = [];
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};

const { app, key } = await simulatedApi({ fast: false, env: { WEB_ORIGINS: WEB } });
const server = serve({ fetch: app.fetch, port: 8787 });

async function axe(page: Page, path: string) {
  await page.addScriptTag({ content: axeSource });
  const result = (await page.evaluate(async () => {
    // @ts-expect-error injected
    return window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } });
  })) as { violations: { id: string; impact: string | null; nodes: unknown[] }[] };
  const serious = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  check(serious.length === 0, `axe ${path}${serious.length ? `: ${serious.map((v) => `${v.id} (${v.nodes.length})`).join(", ")}` : ""}`);
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1360, height: 1000 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  // The console flow: a conflict token (ending in "c"), streamed live, then verified.
  await page.goto(`${WEB}/console`);
  await page.locator('input[placeholder="0x…"]').fill(`0x${"7".repeat(39)}c`);
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
  check(true, "verify recomputes the verdict");
  await page.goto(`${WEB}/console?id=${vid}`);
  await page.getByText(/following vrd_/).waitFor();
  check(true, "console attaches to an existing verdict by id");
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join("; ")}` : ""}`);

  for (const path of PAGES) {
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
