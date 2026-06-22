// LZ flow continued: template -> continue w/o editing -> confirm -> Campaign Setup (targeting). STOP before Validate (paid).
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
  const text = await page.evaluate(() => document.body.innerText.replace(/\n{3,}/g,'\n').slice(0, 1600));
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

    await page.getByRole('button', { name: /Create New Campaign/i }).first().click({ timeout: 10000 });
    await page.waitForTimeout(1200);
    await page.locator('[role="dialog"] input[placeholder="Summer Sale Campaign"]').fill('Doc Test LZ2');
    await page.getByText('Location Zone', { exact: true }).first().click({ timeout: 8000 });
    await page.waitForTimeout(600);
    // date
    await page.locator('[role="dialog"] input[placeholder="Select a date"]').click({ timeout: 5000 }).catch(()=>{});
    await page.waitForTimeout(600);
    await page.getByRole('gridcell', { name: '20', exact: true }).click({ timeout: 4000 }).catch(()=>log('gridcell fallback'));
    await page.waitForTimeout(400);
    await page.locator('[role="dialog"]').getByRole('button', { name: /^Create Campaign$/i }).click({ timeout: 8000 });
    await page.waitForTimeout(3500);

    // Pick a Template: wait for cards, click first selectable card
    await page.waitForTimeout(2500); // allow templates to load
    await shot(page, 'cc_lz_03_pick_template');
    // Try selecting a template card (image/card inside dialog) then Continue without Editing
    const card = page.locator('[role="dialog"] img, [role="dialog"] [class*="card"], [role="dialog"] [class*="template"]').first();
    await card.click({ timeout: 6000 }).catch(e=>log('card click: '+e.message));
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: /Continue without Editing/i }).click({ timeout: 6000 }).catch(e=>log('continue: '+e.message));
    await page.waitForTimeout(1500);
    // possible confirm prompt
    await shot(page, 'cc_lz_04_confirm_or_setup');
    await page.getByRole('button', { name: /^(Confirm|Continue|Proceed|Yes)/i }).first().click({ timeout: 4000 }).catch(()=>log('no confirm btn'));
    await page.waitForTimeout(3000);
    await shot(page, 'cc_lz_05_campaign_setup');

    log('STOP: reached campaign setup. NOT clicking Validate (paid).');
    fs.writeFileSync(`${OUT}/lz_setup_results.json`, JSON.stringify(results, null, 2));
  } catch (e) {
    log('ERROR: ' + e.message);
    try { await page.screenshot({ path: `${SHOTS}/_lz2_error.png`, fullPage: true }); } catch {}
    fs.writeFileSync(`${OUT}/lz_setup_results.json`, JSON.stringify(results, null, 2));
  } finally { await browser.close(); }
})();
