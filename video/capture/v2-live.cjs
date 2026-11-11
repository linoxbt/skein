// Film v2 live events, recorded as screencast frames with timing markers.
//   node capture/v2-live.cjs console   (KEY in env: a partner key, typed into a masked field)
//   node capture/v2-live.cjs desk
const { chromium } = require('playwright');
const fs = require('fs');
const which = process.argv[2];
const DIR = `capture/v2/frames-${which}`;
fs.mkdirSync(DIR, { recursive: true });
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, colorScheme: 'dark' });
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  const frames = [];
  cdp.on('Page.screencastFrame', async (f) => {
    const file = `${DIR}/f${String(frames.length).padStart(5, '0')}.jpg`;
    fs.writeFileSync(file, Buffer.from(f.data, 'base64'));
    frames.push({ file, t: f.metadata.timestamp });
    await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  const marks = [];
  const mark = (label) => { marks.push({ label, t: Date.now() / 1000 }); console.log('mark', label); };
  const start = async (url) => {
    await p.goto(url, { waitUntil: 'networkidle' });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
    await p.waitForTimeout(1500);
  };
  let result = {};
  if (which === 'console') {
    await start('https://skeinlabs.site/console');
    mark('type-token');
    const token = p.locator('input[pattern="^0x[0-9a-fA-F]{40}$"]');
    await token.click(); await token.pressSequentially('0x08723392ed15743cc38513c4925f5e6be5c17243', { delay: 26 });
    const chain = p.locator('form select').first();
    await chain.selectOption({ value: '1' }).catch(() => chain.selectOption({ label: /ethereum/i }));
    await p.waitForTimeout(500);
    mark('type-key');
    const key = p.locator('input[type="password"]');
    await key.click(); await key.pressSequentially(process.env.KEY, { delay: 8 });
    await p.waitForTimeout(600);
    mark('submit');
    await p.locator('form button[type="submit"]').first().click();
    const t0 = Date.now();
    while (Date.now() - t0 < 120000) {
      const txt = await p.locator('main').innerText().catch(() => '');
      if (/\bREJECT\b/.test(txt) && /(Open|View) (the )?verdict|vrd_/i.test(txt)) break;
      await p.waitForTimeout(300);
    }
    mark('decided');
    await p.waitForTimeout(3000);
    for (let i = 0; i < 10; i++) { await p.mouse.wheel(0, 80); await p.waitForTimeout(90); }
    await p.waitForTimeout(2500);
    mark('end');
    const html = await p.content();
    result.verdict = (html.match(/vrd_[a-z0-9]{20}/) || [])[0] || null;
  } else {
    await start('https://desk.skeinlabs.site/apply');
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
    result.verdict = await p.getByRole('link', { name: /Open the verdict on Skein/ }).getAttribute('href').catch(() => null);
    result.app = p.url();
  }
  await cdp.send('Page.stopScreencast');
  fs.writeFileSync(`capture/v2/live-${which}.json`, JSON.stringify({ ...result, marks, frames }, null, 1));
  console.log('frames', frames.length, JSON.stringify(result));
  await b.close();
})();
