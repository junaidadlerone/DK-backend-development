// Patient read-only status check: fully load the campaign + check for launched/active state. No Pay clicks.
const { chromium } = require('playwright');
const BASE = 'https://door-knocker-plus-dev.vercel.app';
const EMAIL = 'aristotle@yopmail.com', PASS = 'Qwerty@1234';
const OUT = 'C:/Users/Shahzaib/Desktop/Claude/doorknocker-docs', SHOTS = `${OUT}/screenshots`;
const log = (m) => console.log(`[${new Date().toISOString().slice(11,19)}] ${m}`);
(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  try {
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.fill('input[type="email"]', EMAIL); await page.fill('input[type="password"]', PASS);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL('**/pick-organization', { timeout: 30000 }).catch(()=>{});
    await page.waitForTimeout(2000);
    await page.getByText('hundred', { exact: true }).first().click({ timeout: 20000 });
    await page.waitForURL('**/dashboard', { timeout: 30000 }).catch(()=>{});

    // direct to the known campaign id detail (active route) vs setup route
    const ID = 'e94e0856-d186-442f-91bb-b4230a11afa9';
    await page.goto(`${BASE}/campaigns/${ID}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(6000);
    log('After /campaigns/{id} -> ' + page.url());
    await page.screenshot({ path: `${SHOTS}/launch_28_id_route.png`, fullPage: true });
    const t1 = await page.evaluate(()=>document.body.innerText.replace(/\n{3,}/g,'\n').slice(0,1400));
    log('ID ROUTE TEXT:\n' + t1);

    // list row status
    await page.goto(`${BASE}/campaigns`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);
    const row = await page.evaluate(()=>{ const r=[...document.querySelectorAll('tr')].find(x=>/Doc LZ Setup/.test(x.innerText)); return r?r.innerText.replace(/\s+/g,' '):'(not found)'; });
    log('LIST ROW NOW: ' + row);
  } catch (e) { log('ERROR: ' + e.message); }
  finally { await browser.close(); }
})();
