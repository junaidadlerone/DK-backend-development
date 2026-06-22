// Full Location Zone campaign flow: create -> template -> setup/targeting -> validate -> payment screen. STOP before paying.
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
  const text = await page.evaluate(() => document.body.innerText.replace(/\n{3,}/g,'\n').slice(0, 1800));
  const buttons = await page.$$eval('button, [role="button"]', els =>
    [...new Set(els.map(e => e.textContent.trim().replace(/\s+/g,' ')).filter(t => t && t.length<50))]);
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

    // Open slider, fill Location Zone campaign
    await page.getByRole('button', { name: /Create New Campaign/i }).first().click({ timeout: 10000 });
    await page.waitForTimeout(1500);
    await page.locator('[role="dialog"] input[placeholder="Summer Sale Campaign"]').fill('Doc Test LZ');
    await page.getByText('Location Zone', { exact: true }).first().click({ timeout: 8000 });
    await page.waitForTimeout(800);
    // Date picker
    try {
      await page.locator('[role="dialog"] input[placeholder="Select a date"]').click({ timeout: 5000 });
      await page.waitForTimeout(800);
      // pick any available day in the calendar that is not disabled
      await page.locator('[role="dialog"] button:not([disabled])').filter({ hasText: /^\d{1,2}$/ }).last().click({ timeout: 5000 }).catch(e=>log('day pick: '+e.message));
      await page.waitForTimeout(500);
    } catch(e) { log('date: ' + e.message); }
    await shot(page, 'cc_lz_slider_filled');

    // Click Create Campaign (inside dialog)
    await page.locator('[role="dialog"]').getByRole('button', { name: /^Create Campaign$/i }).click({ timeout: 8000 });
    await page.waitForTimeout(3500);
    await shot(page, 'cc_lz_02_after_create'); // expect Pick a Template

    log('STAGE A complete. Saving partial.');
    fs.writeFileSync(`${OUT}/lz_flow_results.json`, JSON.stringify(results, null, 2));
  } catch (e) {
    log('ERROR: ' + e.message);
    try { await page.screenshot({ path: `${SHOTS}/_lz_error.png`, fullPage: true }); } catch {}
    fs.writeFileSync(`${OUT}/lz_flow_results.json`, JSON.stringify(results, null, 2));
  } finally { await browser.close(); }
})();
