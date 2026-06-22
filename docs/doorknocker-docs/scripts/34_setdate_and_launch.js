// Set start date (react-datepicker), save, then Launch -> Pay & Launch with success detection.
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
    await page.getByRole('button', { name: /Edit Campaign/i }).waitFor({ timeout: 40000 });
    await page.waitForTimeout(1500);

    // ---- set date ----
    await page.getByRole('button', { name: /Edit Campaign/i }).click({ timeout: 8000 });
    await page.waitForTimeout(2000);
    await page.locator('input[placeholder="Select a date"]').click({ timeout: 6000 });
    await page.waitForTimeout(1000);
    const day = page.locator('.react-datepicker__day--030:not(.react-datepicker__day--outside-month)');
    if (await day.count()) { await day.first().click({ timeout: 4000 }); log('clicked day 30'); }
    else { await page.locator('.react-datepicker__day--025:not(.react-datepicker__day--outside-month)').first().click({ timeout: 4000 }); log('clicked day 25'); }
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: /^Save Changes$/i }).first().click({ timeout: 6000 });
    await page.waitForTimeout(3500);
    const dateNow = await page.evaluate(()=>{ const m=document.body.innerText.match(/Estimated Start Date\s*\n?\s*([^\n*][^\n]*)/i); return m?m[1].trim():'(unset)'; });
    log('Start date after save: ' + dateNow);
    await snap(page, 'launch_35_date_saved');

    // ---- launch ----
    await page.getByRole('button', { name: /^Launch Campaign$/i }).first().click({ timeout: 8000 });
    for (let i=0;i<15;i++){ await page.waitForTimeout(2000);
      const loading = await page.evaluate(()=>{ const d=document.querySelector('[role="dialog"]'); return d? /Loading campaign data/i.test(d.innerText):true; });
      if (!loading) break; }
    await page.waitForTimeout(1500);
    const dialog = page.locator('[role="dialog"]');
    await dialog.getByText(/Standard Postcard/i).click({ timeout: 5000 }).catch(()=>{});
    for (const re of [/I confirm all campaign details/i, /I authorize the campaign cost/i, /I confirm referral has given proper consent/i]) {
      await dialog.getByText(re).click({ timeout: 5000 }).catch(e=>log('auth: '+e.message)); await page.waitForTimeout(400);
    }
    await snap(page, 'launch_36_ready_to_pay');
    await dialog.getByRole('button', { name: /Pay & Launch/i }).click({ timeout: 8000 });
    log('Pay & Launch clicked; waiting for success...');

    // success detection: redirect to /campaigns/{id} (not /create) OR Active badge OR toast
    let success = false, info = '';
    for (let i=0;i<12 && !success;i++){
      await page.waitForTimeout(8000);
      const url = page.url();
      const txt = await page.evaluate(()=>document.body.innerText);
      const toast = await page.evaluate(()=>{ const x=document.querySelector('[data-sonner-toast]'); return x?x.innerText:''; });
      const onActive = /\/campaigns\/[0-9a-f-]{36}$/.test(url);
      const activeBadge = /Targeting Map\s*\n?\s*Activity/i.test(txt) || /\bActive\b/.test(txt) && /View Analytics/i.test(txt);
      info = `url=${url} toast=${toast.slice(0,80)}`;
      log(`poll ${i+1}: ${info} onActive=${onActive} activeBadge=${activeBadge}`);
      if (onActive || activeBadge || /launched|success/i.test(toast)) success = true;
    }
    await snap(page, 'launch_37_result');
    log('LAUNCH SUCCESS: ' + success);

    // confirm via list
    await page.goto(`${BASE}/campaigns`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);
    const row = await page.evaluate(()=>{ const r=[...document.querySelectorAll('tr')].find(x=>/Doc LZ Setup/.test(x.innerText)); return r?r.innerText.replace(/\s+/g,' '):'(not on pg1)'; });
    log('FINAL LIST ROW: ' + row);
    await snap(page, 'launch_38_final_list');
  } catch (e) {
    log('ERROR: ' + e.message);
    try { await snap(page, '_setdate_launch_error'); } catch {}
  } finally { await browser.close(); }
})();
