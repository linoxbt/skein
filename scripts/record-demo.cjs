// Records docs/demo/skein-demo.mp4's source video against the live services (buys one real verdict).
// Usage: OUT=/tmp/demo node scripts/record-demo.cjs, then ffmpeg -i <webm> -c:v libx264 -crf 28 -pix_fmt yuv420p docs/demo/skein-demo.mp4
const { chromium } = require('playwright');
const OUT = process.env.OUT || 'demo-video';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function caption(page, text) {
  await page.evaluate((t) => {
    let el = document.getElementById('__cap');
    if (!el) {
      el = document.createElement('div');
      el.id = '__cap';
      el.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483647;max-width:1100px;padding:14px 22px;background:rgba(10,10,10,.88);color:#fff;font:500 22px/1.35 system-ui,sans-serif;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.35);text-align:center;pointer-events:none';
      document.body.appendChild(el);
    }
    el.textContent = t;
  }, text);
}
async function scene(page, url, text, ms = 6000) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  await caption(page, text);
  await wait(ms);
}
async function slowScroll(page, px, steps = 10, ms = 400) {
  for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, px / steps); await wait(ms); }
}
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: OUT, size: { width: 1280, height: 720 } } });
  const page = await ctx.newPage();

  await scene(page, 'https://skeinlabs.site/', 'Skein sells one decision: is this token fit to list? It buys ranked checks from Telegraph miners and fuses them into a verdict.', 7000);
  await slowScroll(page, 1400); await caption(page, 'APPROVE, REJECT, ESCALATE or ABSTAIN, with reasons, cost and a receipt for every purchase.'); await wait(4000);

  await scene(page, 'https://desk.skeinlabs.site/', 'Skein Desk: an exchange listing queue run by an agent. It buys a Skein verdict for every application, with no human in the loop.', 7000);
  await page.goto('https://desk.skeinlabs.site/apply', { waitUntil: 'networkidle' });
  await caption(page, 'A project applies to list its token. Real input: Aerodrome (AERO) on Base.');
  const fields = page.locator('form input.field');
  await fields.nth(0).click(); await fields.nth(0).pressSequentially('Aerodrome', { delay: 60 });
  const chain = page.locator('form select');
  if (await chain.count()) await chain.first().selectOption({ value: '8453' }).catch(() => {});
  await fields.nth(1).click(); await fields.nth(1).pressSequentially('0x940181a94A35A4569E4529A3CDfB74e38FD98631', { delay: 25 });
  await wait(1500);
  await page.getByRole('button', { name: /Submit application/ }).click();
  await caption(page, 'Submitted. The Desk agent now pays Skein, and Skein pays Telegraph miners through the escrow for each check.');
  await page.waitForURL(/\/a\//, { timeout: 60000 });
  const start = Date.now();
  let shown = false;
  while (Date.now() - start < 150000) {
    const done = await page.getByRole('link', { name: /Open the verdict on Skein/ }).count();
    if (done) break;
    if (!shown) { await caption(page, 'Buying checks live on Telegraph testnet: contract audit, sanctions, holders, liquidity, wash trading…'); shown = true; }
    await wait(2000);
  }
  await caption(page, 'The agent decided on its own: the verdict, its reasons, and what it cost.');
  await wait(3000); await slowScroll(page, 700, 8, 450); await wait(3000);
  const href = await page.getByRole('link', { name: /Open the verdict on Skein/ }).getAttribute('href').catch(() => null);
  const id = href ? href.split('/v/')[1] : null;
  console.log('verdict', id);

  if (id) {
    await scene(page, `https://skeinlabs.site/v/${id}`, 'The verdict page: decision, reasons, open risks, risk and confidence, coverage and cost. Signed by Skein.', 7000);
    const ev = page.getByRole('tab', { name: /Evidence/i });
    if (await ev.count()) { await ev.first().click(); } else { await page.getByText(/Evidence/).first().click().catch(() => {}); }
    await caption(page, 'Evidence: every Telegraph purchase, with its miner, price, receipt hash and signal hash.');
    await wait(3000); await slowScroll(page, 900, 10, 450); await wait(3000);
    await scene(page, `https://skeinlabs.site/verify?id=${id}`, 'Anyone can verify it: Skein recomputes the verdict from the raw answers it paid for and checks every receipt.', 4000);
    await page.waitForTimeout(8000); await slowScroll(page, 800, 8, 450); await wait(3000);
  }
  await scene(page, 'https://skeinlabs.site/ledger', 'The ledger: every verdict and every upstream receipt, from 9 miners so far. Skein is also miner 5137, selling verdicts to other agents.', 8000);
  await scene(page, 'https://sniper-production-bea6.up.railway.app/', 'Skein Sniper (Mission 14) buys a verdict before every trade on new Base launches. Every launch it checked, it dodged.', 8000);
  await slowScroll(page, 900, 8, 450); await wait(2500);
  await scene(page, 'https://api.skeinlabs.site/v1/status', 'Open APIs: live miner health, latency and spend caps. Use the SDK, the MCP server, x402 payments, or Telegraph itself.', 7000);
  await scene(page, 'https://skeinlabs.site/tutorial', 'Try it: skeinlabs.site/tutorial · npm i @skeinlabs/sdk · github.com/linoxbt/skein', 7000);

  await page.close(); await ctx.close(); await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
