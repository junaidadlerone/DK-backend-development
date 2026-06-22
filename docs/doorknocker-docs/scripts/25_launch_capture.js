// Click Launch Campaign on the validated draft; capture the launch/payment modal + requirements.
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
    await snap(page, 'launch_20_validated_ready');

    await page.getByRole('button', { name: /^Launch Campaign$/i }).first().click({ timeout: 8000 });
    await page.waitForTimeout(5000);
    await snap(page, 'launch_21_launch_modal');

    const dlg = await page.evaluate(() => { const d=document.querySelector('[role="dialog"]'); return d?d.innerText.slice(0,2000):'(no dialog)'; });
    log('LAUNCH DIALOG:\n' + dlg);
    // dump buttons + any toast/error
    const btns = await page.evaluate(() => {
      const d=document.querySelector('[role="dialog"]')||document.body;
      return [...d.querySelectorAll('button')].map(b=>({txt:b.textContent.trim().slice(0,30),disabled:b.disabled}));
    });
    log('BUTTONS: ' + JSON.stringify(btns));
    const toast = await page.evaluate(()=>{ const t=document.querySelector('[data-sonner-toast],[role="status"]'); return t?t.innerText:''; });
    if (toast) log('TOAST: ' + toast);
  } catch (e) {
    log('ERROR: ' + e.message);
    try { await snap(page, '_launch_capture_error'); } catch {}
  } finally { await browser.close(); }
})();
