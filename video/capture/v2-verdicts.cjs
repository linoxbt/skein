// Film v2: the live events' verdict pages, their tabs, the verify run and the Desk application page.
const { chromium } = require('playwright');
const OUT = 'public/v2/shots';
const A = 'vrd_mwcfyu0y04360z153f1b', R = 'vrd_mwcfy2nj685b1z0e264a', APP = 'https://desk.skeinlabs.site/a/app_mwcfytcf1igpve5';
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2, colorScheme: 'dark' });
  const p = await ctx.newPage();
  const shot = async (name, full = true) => {
    await p.screenshot({ path: `${OUT}/${name}.png` });
    if (full) await p.screenshot({ path: `${OUT}/${name}-full.png`, fullPage: true });
    console.log('shot', name);
  };
  for (const [k, id] of [['approve', A], ['reject', R]]) {
    await p.goto(`https://skeinlabs.site/v/${id}`, { waitUntil: 'load', timeout: 60000 });
    await p.waitForTimeout(2500);
    await shot(`verdict-${k}`);
    for (const tab of ['Evidence', 'Findings', 'Cost', 'JSON']) {
      const t = p.getByRole('tab', { name: new RegExp(`^${tab}$`, 'i') });
      if (!(await t.count())) continue;
      await t.first().click(); await p.waitForTimeout(1200);
      const box = await t.first().boundingBox();
      if (box) await p.evaluate((y) => window.scrollTo(0, y - 140), box.y + (await p.evaluate(() => window.scrollY)));
      await p.waitForTimeout(800);
      await shot(`verdict-${k}-${tab.toLowerCase()}`, false);
    }
  }
  await p.goto(`https://skeinlabs.site/verify?id=${A}`, { waitUntil: 'load', timeout: 60000 });
  await p.waitForTimeout(10000);
  await shot('verify-done');
  await p.evaluate(() => window.scrollTo(0, 620)); await p.waitForTimeout(600);
  await shot('verify-done-scrolled', false);
  await p.goto(APP, { waitUntil: 'load', timeout: 60000 }); await p.waitForTimeout(2500);
  await shot('desk-app');
  await b.close();
})();
