// Select template -> bottom Continue -> modal "Continue without Editing" -> observe destination (targeting setup?). STOP before paid steps.
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = 'https://door-knocker-plus-dev.vercel.app';
const EMAIL = 'aristotle@yopmail.com', PASS = 'Qwerty@1234';
const OUT = 'C:/Users/Shahzaib/Desktop/Claude/doorknocker-docs', SHOTS = `${OUT}/screenshots`;
const log = (m) => console.log(`[${new Date().toISOString().slice(11,19)}] ${m}`);
const results = [];
async function shot(page, name) {
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
  const text = await page.evaluate(() => document.body.innerText.replace(/\n{3,}/g,'\n').slice(0, 2000));
  const buttons = await page.$$eval('button, [role="button"]', els => [...new Set(els.map(e=>e.textContent.trim().replace(/\s+/g,' ')).filter(t=>t&&t.length<50))]);
  const fields = await page.$$eval('input, textarea, select', els => els.map(e => ({ type: e.type, ph: e.placeholder, required: e.required })));
  log(`\n===== ${name} ===== ${page.url()}`); console.log(text);
  log('BTN: ' + JSON.stringify(buttons)); log('FLD: ' + JSON.stringify(fields));
  results.push({ name, url: page.url(), text, buttons, fields });
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
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: /Create New Campaign/i }).first().click({ timeout: 10000 });
    await page.waitForTimeout(1000);
    await page.locator('[role="dialog"] input[placeholder="Summer Sale Campaign"]').fill('Doc LZ Setup');
    await page.getByText('Location Zone', { exact: true }).first().click({ timeout: 8000 });
    await page.waitForTimeout(500);
    await page.locator('[role="dialog"] input[placeholder="Select a date"]').click({ timeout: 5000 }).catch(()=>{});
    await page.waitForTimeout(500);
    await page.getByRole('gridcell', { name: '25', exact: true }).click({ timeout: 4000 }).catch(()=>{});
    await page.locator('[role="dialog"]').getByRole('button', { name: /^Create Campaign$/i }).click({ timeout: 8000 });
    await page.waitForTimeout(4000);

    // select template
    await page.getByText('Modern Detached Home', { exact: true }).first().click({ timeout: 6000 });
    await page.waitForTimeout(1000);
    // bottom Continue without Editing
    await page.getByRole('button', { name: /^Continue without Editing$/i }).last().click({ timeout: 6000 });
    await page.waitForTimeout(1200);
    // modal confirm: click the "Continue without Editing" that's inside the Edit Template dialog
    const modal = page.locator('[role="dialog"]').filter({ hasText: 'Edit Template' });
    await modal.getByRole('button', { name: /Continue without Editing/i }).click({ timeout: 6000 }).catch(async e=>{
      log('modal btn fallback: '+e.message);
      await page.getByRole('button', { name: /Continue without Editing/i }).last().click({ timeout: 5000 }).catch(()=>{});
    });
    await page.waitForTimeout(4000);
    log('URL after confirm: ' + page.url());
    await shot(page, 'cc_lz_06_after_confirm');

    // If a QR modal appears, fill + save to advance
    const qr = page.locator('input[placeholder*="landing page" i]');
    if (await qr.count()) {
      log('QR modal present - filling');
      await qr.fill('https://example.com/promo');
      await page.getByRole('button', { name: /Save QR Code/i }).click({ timeout: 6000 }).catch(e=>log('save qr: '+e.message));
      await page.waitForTimeout(3500);
      await shot(page, 'cc_lz_07_after_qr');
    }

    log('STOP before any Validate/Payment action.');
    fs.writeFileSync(`${OUT}/lz_complete_results.json`, JSON.stringify(results, null, 2));
  } catch (e) {
    log('ERROR: ' + e.message);
    try { await page.screenshot({ path: `${SHOTS}/_lz3_error.png`, fullPage: true }); } catch {}
    fs.writeFileSync(`${OUT}/lz_complete_results.json`, JSON.stringify(results, null, 2));
  } finally { await browser.close(); }
})();
