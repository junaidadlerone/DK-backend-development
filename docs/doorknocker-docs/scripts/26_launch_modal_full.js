// Open Launch modal, wait for it to fully load, capture all fields/requirements.
const { chromium } = require('playwright');
const BASE = 'https://door-knocker-plus-dev.vercel.app';
const EMAIL = 'aristotle@yopmail.com', PASS = 'Qwerty@1234';
const OUT = 'C:/Users/Shahzaib/Desktop/Claude/doorknocker-docs', SHOTS = `${OUT}/screenshots`;
const log = (m) => console.log(`[${new Date().toISOString().slice(11,19)}] ${m}`);
const snap = (page,n) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true });
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
    await page.locator('tr', { hasText: 'Doc LZ Setup' }).first().click({ timeout: 10000 });
    await page.waitForURL('**/campaigns/create**', { timeout: 20000 }).catch(()=>{});
    await page.getByRole('button', { name: /Launch Campaign/i }).first().waitFor({ timeout: 40000 });
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: /^Launch Campaign$/i }).first().click({ timeout: 8000 });

    // wait until modal stops showing "Loading campaign data"
    for (let i=0;i<15;i++){
      await page.waitForTimeout(2000);
      const loading = await page.evaluate(()=>{ const d=document.querySelector('[role="dialog"]'); return d? /Loading campaign data/i.test(d.innerText):true; });
      if (!loading) break;
    }
    await page.waitForTimeout(1500);
    await snap(page, 'launch_22_launch_modal_loaded');
    const dlg = await page.evaluate(() => { const d=document.querySelector('[role="dialog"]'); return d?d.innerText.slice(0,2200):'(no dialog)'; });
    log('LAUNCH MODAL:\n' + dlg);
    const els = await page.evaluate(() => {
      const d=document.querySelector('[role="dialog"]'); if(!d) return {};
      return {
        buttons: [...d.querySelectorAll('button')].map(b=>({t:b.textContent.trim().slice(0,30),d:b.disabled})),
        inputs: [...d.querySelectorAll('input')].map(i=>({t:i.type,ph:i.placeholder})),
        authLabels: [...d.querySelectorAll('label')].map(l=>l.textContent.trim().slice(0,50)),
      };
    });
    log('ELEMENTS: ' + JSON.stringify(els, null, 2));
  } catch (e) {
    log('ERROR: ' + e.message);
    try { await snap(page, '_launch_modal_err'); } catch {}
  } finally { await browser.close(); }
})();
