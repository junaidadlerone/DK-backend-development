// Read-only: check current status of Doc LZ Setup after launch (no clicking Pay).
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
    await page.goto(`${BASE}/campaigns`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);
    const row = await page.evaluate(()=>{ const r=[...document.querySelectorAll('tr')].find(x=>/Doc LZ Setup/.test(x.innerText)); return r?r.innerText.replace(/\s+/g,' '):'(not on page 1)'; });
    log('LIST ROW: ' + row);
    await page.screenshot({ path: `${SHOTS}/launch_26_list_status.png`, fullPage: true });

    // open it to see detail (Draft setup vs Active tracking)
    await page.locator('tr', { hasText: 'Doc LZ Setup' }).first().click({ timeout: 10000 }).catch(e=>log('open: '+e.message));
    await page.waitForTimeout(4000);
    log('DETAIL URL: ' + page.url());
    await page.screenshot({ path: `${SHOTS}/launch_27_detail_status.png`, fullPage: true });
    const t = await page.evaluate(()=>document.body.innerText.replace(/\n{3,}/g,'\n').slice(0,1600));
    log('DETAIL:\n' + t);
  } catch (e) { log('ERROR: ' + e.message); }
  finally { await browser.close(); }
})();
