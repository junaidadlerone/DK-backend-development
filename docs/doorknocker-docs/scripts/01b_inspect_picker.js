const { chromium } = require('playwright');
const BASE = 'https://door-knocker-plus-dev.vercel.app';
const OUT = 'C:/Users/Shahzaib/Desktop/Claude/doorknocker-docs';
(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: `${OUT}/auth-state.json` });
  const page = await ctx.newPage();
  const log = (m) => console.log(m);
  await page.goto(`${BASE}/pick-organization`, { waitUntil: 'networkidle', timeout: 45000 });
  log('URL: ' + page.url());
  // Find clickable containers holding "Owner"
  const clickables = await page.$$eval('button, [role="button"], div[class*="cursor"], a', els =>
    els.map(e => ({ tag: e.tagName, role: e.getAttribute('role'), cls: (e.className||'').toString().slice(0,60), txt: e.textContent.trim().replace(/\s+/g,' ').slice(0,50) }))
       .filter(x => x.txt));
  log(JSON.stringify(clickables.slice(0,40), null, 2));
  await browser.close();
})();
