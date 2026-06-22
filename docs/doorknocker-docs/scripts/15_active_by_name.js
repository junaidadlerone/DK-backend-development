const { chromium } = require('playwright');
const fs = require('fs');
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
    await page.waitForTimeout(2500);

    // Click the last pagination page to reach older Active campaigns
    await page.getByText('4', { exact: true }).first().click({ timeout: 5000 }).catch(e=>log('pg4: '+e.message));
    await page.waitForTimeout(2500);
    const txt = await page.evaluate(()=>document.body.innerText.slice(0,1500));
    log('PAGE 4 TEXT:\n'+txt);
    // click first row that is NOT a draft -> contains Active
    const rows = page.locator('tbody tr');
    const n = await rows.count(); log('rows on pg4: '+n);
    for (let i=0;i<n;i++){
      const t = await rows.nth(i).innerText().catch(()=>'');
      if (/Active/.test(t)) { log('clicking: '+t.replace(/\s+/g,' ').slice(0,50)); await rows.nth(i).click({timeout:6000}); break; }
    }
    await page.waitForTimeout(3500);
    log('URL: '+page.url());
    await page.screenshot({ path: `${SHOTS}/camp_active_detail_v3.png`, fullPage: true });
    const t2 = await page.evaluate(()=>document.body.innerText.replace(/\n{3,}/g,'\n').slice(0,2600));
    log('DETAIL:\n'+t2);
  } catch (e) {
    log('ERROR: ' + e.message);
    try { await page.screenshot({ path: `${SHOTS}/_active3_error.png`, fullPage: true }); } catch {}
  } finally { await browser.close(); }
})();
