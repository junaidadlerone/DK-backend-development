// Open ready draft (zone already set) -> click Validate Addresses -> CAPTURE payment UI (don't submit).
const { chromium } = require('playwright');
const BASE = 'https://door-knocker-plus-dev.vercel.app';
const EMAIL = 'aristotle@yopmail.com', PASS = 'Qwerty@1234';
const OUT = 'C:/Users/Shahzaib/Desktop/Claude/doorknocker-docs', SHOTS = `${OUT}/screenshots`;
const log = (m) => console.log(`[${new Date().toISOString().slice(11,19)}] ${m}`);
async function shot(page, name) {
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
  const text = await page.evaluate(() => document.body.innerText.replace(/\n{3,}/g,'\n').slice(0, 2000));
  log(`\n===== ${name} ===== ${page.url()}`); console.log(text);
  const frames = page.frames().map(f => f.url());
  log('FRAMES: ' + JSON.stringify(frames.filter(u=>/stripe/i.test(u))));
}
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
    await page.getByRole('button', { name: /Validate Addresses/i }).waitFor({ timeout: 40000 });
    await page.waitForTimeout(1500);
    await shot(page, 'launch_10_before_validate');

    await page.getByRole('button', { name: /^Validate Addresses$/i }).first().click({ timeout: 8000 });
    await page.waitForTimeout(6000);
    await shot(page, 'launch_11_after_validate_click');

    // dump dialog + all inputs (incl. across frames) to understand the payment form
    const dlg = await page.evaluate(() => { const d=document.querySelector('[role="dialog"]'); return d?d.innerText.slice(0,1800):'(no dialog)'; });
    log('DIALOG TEXT: ' + dlg);
    for (const f of page.frames()) {
      const inputs = await f.$$eval('input', els => els.map(e=>({name:e.name,ph:e.placeholder,type:e.type,al:e.getAttribute('aria-label')}))).catch(()=>[]);
      if (inputs.length) log('FRAME ' + (f.url().slice(0,60)) + ' INPUTS: ' + JSON.stringify(inputs));
    }
    log('DONE');
  } catch (e) {
    log('ERROR: ' + e.message);
    try { await page.screenshot({ path: `${SHOTS}/_validate_cap_error.png`, fullPage: true }); } catch {}
  } finally { await browser.close(); }
})();
