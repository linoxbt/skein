// Film v2: every page of the live apps at 2x, viewport and full page.
const { chromium } = require('playwright');
const OUT = 'public/v2/shots';
const ids = JSON.parse(process.env.IDS || '{}');
const pages = [
  ['web-home', 'https://skeinlabs.site/'],
  ['web-how', 'https://skeinlabs.site/how-it-works'],
  ['web-console', 'https://skeinlabs.site/console'],
  ['web-ledger', 'https://skeinlabs.site/ledger'],
  ['web-status', 'https://skeinlabs.site/status'],
  ['web-policies', 'https://skeinlabs.site/policies'],
  ['web-docs', 'https://skeinlabs.site/docs'],
  ['web-tutorial', 'https://skeinlabs.site/tutorial'],
  ['web-verify', 'https://skeinlabs.site/verify'],
  ['desk-home', 'https://desk.skeinlabs.site/'],
  ['desk-apply', 'https://desk.skeinlabs.site/apply'],
  ['desk-log', 'https://desk.skeinlabs.site/log'],
  ['sniper', 'https://sniper-production-bea6.up.railway.app/'],
  ...Object.entries(ids).map(([k, v]) => [`web-verdict-${k}`, `https://skeinlabs.site/v/${v}`]),
];
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2, colorScheme: 'dark' });
  const p = await ctx.newPage();
  for (const [name, url] of pages) {
    await p.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
    await p.waitForTimeout(2500);
    await p.screenshot({ path: `${OUT}/${name}.png` });
    await p.screenshot({ path: `${OUT}/${name}-full.png`, fullPage: true });
    console.log('shot', name);
  }
  await b.close();
})();
