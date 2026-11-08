// Records a fresh Desk application end to end (it buys a real verdict) as screencast frames.
const { chromium } = require('playwright');
const fs = require('fs');
const DIR = 'capture/frames';
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  const frames = [];
  cdp.on('Page.screencastFrame', async (f) => {
    const n = frames.length; const file = `${DIR}/f${String(n).padStart(5, '0')}.jpg`;
    fs.writeFileSync(file, Buffer.from(f.data, 'base64'));
    frames.push({ file, t: f.metadata.timestamp });
    await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await p.goto('https://desk.skeinlabs.site/apply', { waitUntil: 'networkidle' });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
  const mark = (label) => { frames.push({ marker: label, t: Date.now() / 1000 }); console.log('mark', label); };
  await p.waitForTimeout(1200);
  const fields = p.locator('form input.field');
  mark('type-project');
  await fields.nth(0).click(); await fields.nth(0).pressSequentially('Aerodrome Finance', { delay: 70 });
  const sel = p.locator('form select'); if (await sel.count()) await sel.first().selectOption({ value: '8453' }).catch(() => {});
  mark('type-token');
  await fields.nth(1).click(); await fields.nth(1).pressSequentially('0x940181a94A35A4569E4529A3CDfB74e38FD98631', { delay: 28 });
  await p.waitForTimeout(700);
  mark('submit');
  await p.getByRole('button', { name: /Submit application/ }).click();
  await p.waitForURL(/\/a\//, { timeout: 60000 });
  mark('app-page');
  const t0 = Date.now();
  while (Date.now() - t0 < 150000) {
    if (await p.getByRole('link', { name: /Open the verdict on Skein/ }).count()) break;
    await p.waitForTimeout(300);
  }
  mark('decided');
  await p.waitForTimeout(2500);
  for (let i = 0; i < 12; i++) { await p.mouse.wheel(0, 70); await p.waitForTimeout(90); }
  await p.waitForTimeout(2500);
  mark('end');
  await cdp.send('Page.stopScreencast');
  const href = await p.getByRole('link', { name: /Open the verdict on Skein/ }).getAttribute('href').catch(() => null);
  fs.writeFileSync('capture/live.json', JSON.stringify({ url: p.url(), verdict: href, frames }, null, 1));
  console.log('frames', frames.filter((f) => f.file).length, 'verdict', href, 'app', p.url());
  await b.close();
})();
