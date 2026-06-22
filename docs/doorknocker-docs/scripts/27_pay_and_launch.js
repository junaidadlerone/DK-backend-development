// FINAL: select Standard postcard, check all 3 authorizations, Pay & Launch, capture success.
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
    for (let i=0;i<15;i++){ await page.waitForTimeout(2000);
      const loading = await page.evaluate(()=>{ const d=document.querySelector('[role="dialog"]'); return d? /Loading campaign data/i.test(d.innerText):true; });
      if (!loading) break; }
    await page.waitForTimeout(1500);

    const dialog = page.locator('[role="dialog"]');
    // select Standard postcard
    await dialog.getByText(/Standard Postcard/i).click({ timeout: 5000 }).catch(e=>log('std select: '+e.message));
    await page.waitForTimeout(500);
    // check 3 authorizations via label text
    for (const re of [/I confirm all campaign details/i, /I authorize the campaign cost/i, /I confirm referral has given proper consent/i]) {
      await dialog.getByText(re).click({ timeout: 5000 }).catch(e=>log('auth click ('+re+'): '+e.message));
      await page.waitForTimeout(400);
    }
    await snap(page, 'launch_23_authorized');
    const enabled = await page.evaluate(()=>{ const d=document.querySelector('[role="dialog"]'); const b=[...d.querySelectorAll('button')].find(x=>/Pay & Launch/i.test(x.textContent)); return b? !b.disabled : false; });
    log('Pay & Launch enabled: ' + enabled);

    await dialog.getByRole('button', { name: /Pay & Launch/i }).click({ timeout: 8000 });
    log('Clicked Pay & Launch. Waiting for result...');
    await page.waitForTimeout(8000);
    await snap(page, 'launch_24_after_pay');
    const t = await page.evaluate(()=>document.body.innerText.replace(/\n{3,}/g,'\n').slice(0,1800));
    log('AFTER PAY:\n' + t);
    const toast = await page.evaluate(()=>{ const x=document.querySelector('[data-sonner-toast]'); return x?x.innerText:''; });
    if (toast) log('TOAST: ' + toast);

    // verify in campaigns list
    await page.goto(`${BASE}/campaigns`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);
    await snap(page, 'launch_25_campaigns_list_after');
    const row = await page.evaluate(()=>{ const r=[...document.querySelectorAll('tr')].find(x=>/Doc LZ Setup/.test(x.innerText)); return r?r.innerText.replace(/\s+/g,' '):'(not on page 1)'; });
    log('Doc LZ Setup row: ' + row);
  } catch (e) {
    log('ERROR: ' + e.message);
    try { await snap(page, '_pay_launch_error'); } catch {}
  } finally { await browser.close(); }
})();
