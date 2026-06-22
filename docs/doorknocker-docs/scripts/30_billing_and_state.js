// Authoritative check: Billing History (real charges) + fully-loaded setup page state. Read-only.
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

    // Billing history (real charges)
    await page.goto(`${BASE}/settings?tab=subscription`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(9000);
    await page.screenshot({ path: `${SHOTS}/launch_30_billing_history.png`, fullPage: true });
    const billing = await page.evaluate(()=>document.body.innerText.replace(/\n{3,}/g,'\n').slice(0,2200));
    log('BILLING:\n' + billing);

    // Fully load setup page
    await page.goto(`${BASE}/campaigns`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2500);
    await page.locator('tr', { hasText: 'Doc LZ Setup' }).first().click({ timeout: 10000 });
    await page.waitForURL('**/campaigns/create**', { timeout: 20000 }).catch(()=>{});
    // wait for content beyond "Loading campaign data"
    for (let i=0;i<20;i++){ await page.waitForTimeout(2000);
      const loaded = await page.evaluate(()=>!/Loading campaign data/i.test(document.body.innerText) && /Choose Your Target Audience|Launch Campaign|Addresses Validated/i.test(document.body.innerText));
      if (loaded) break; }
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${SHOTS}/launch_31_setup_loaded.png`, fullPage: true });
    const t = await page.evaluate(()=>document.body.innerText.replace(/\n{3,}/g,'\n').slice(0,1600));
    log('SETUP STATE:\n' + t);
    const topBtn = await page.evaluate(()=>{ const b=[...document.querySelectorAll('button')].map(x=>x.textContent.trim()).filter(x=>/Launch Campaign|Verify Addresses|Active/i.test(x)); return b; });
    log('TOP ACTION BUTTONS: ' + JSON.stringify(topBtn));
  } catch (e) { log('ERROR: ' + e.message); }
  finally { await browser.close(); }
})();
