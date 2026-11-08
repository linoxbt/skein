// Captures every page of the live apps at 2x for the motion video.
const { chromium } = require('playwright');
const OUT = 'public/shots';
const A = 'vrd_mw8dfz384v6a6v094n03', R = 'vrd_mw73h8md521r4f500l54', E = 'vrd_mw74rh4i0i4d1j5z5f22';
const pages = [
  ['web-home', 'https://skeinlabs.site/'],
  ['web-how', 'https://skeinlabs.site/how-it-works'],
  ['web-console', 'https://skeinlabs.site/console'],
  ['web-verdict-approve', `https://skeinlabs.site/v/${A}`],
  ['web-verdict-reject', `https://skeinlabs.site/v/${R}`],
  ['web-verdict-escalate', `https://skeinlabs.site/v/${E}`],
  ['web-ledger', 'https://skeinlabs.site/ledger'],
  ['web-status', 'https://skeinlabs.site/status'],
  ['web-policies', 'https://skeinlabs.site/policies'],
  ['web-docs', 'https://skeinlabs.site/docs'],
  ['web-tutorial', 'https://skeinlabs.site/tutorial'],
  ['desk-home', 'https://desk.skeinlabs.site/'],
  ['desk-apply', 'https://desk.skeinlabs.site/apply'],
  ['desk-app', 'https://desk.skeinlabs.site/a/app_mw8c7cwb1kn9u8b'],
  ['desk-log', 'https://desk.skeinlabs.site/log'],
  ['sniper', 'https://sniper-production-bea6.up.railway.app/'],
];
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  for (const [name, url] of pages) {
    await p.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
    await p.waitForTimeout(2500);
    await p.screenshot({ path: `${OUT}/${name}.png` });
    await p.screenshot({ path: `${OUT}/${name}-full.png`, fullPage: true });
    console.log('shot', name);
  }
  // Verdict tabs
  await p.goto(`https://skeinlabs.site/v/${A}`, { waitUntil: 'networkidle' });
  for (const tab of ['Evidence', 'Cost', 'JSON', 'Findings']) {
    const t = p.getByRole('tab', { name: new RegExp(`^${tab}$`, 'i') });
    if (await t.count()) {
      await t.first().click(); await p.waitForTimeout(1200);
      const box = await t.first().boundingBox();
      if (box) await p.evaluate((y) => window.scrollTo(0, y - 140), box.y + (await p.evaluate(() => window.scrollY)));
      await p.waitForTimeout(800);
      await p.screenshot({ path: `${OUT}/web-verdict-${tab.toLowerCase()}.png` });
      console.log('tab', tab);
    }
  }
  // Verify, after it runs
  await p.goto(`https://skeinlabs.site/verify?id=${A}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(9000);
  await p.screenshot({ path: `${OUT}/web-verify-done-full.png`, fullPage: true });
  await p.evaluate(() => window.scrollTo(0, 620)); await p.waitForTimeout(600);
  await p.screenshot({ path: `${OUT}/web-verify-done.png` });
  await b.close();
})();
