// Capture the Create Campaign slider for each of the 3 types.
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = 'https://door-knocker-plus-dev.vercel.app';
const EMAIL = 'aristotle@yopmail.com', PASS = 'Qwerty@1234';
const OUT = 'C:/Users/Shahzaib/Desktop/Claude/doorknocker-docs', SHOTS = `${OUT}/screenshots`;
const log = (m) => console.log(`[${new Date().toISOString().slice(11,19)}] ${m}`);

async function detail(page, name) {
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
  const dialog = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]') || document.body;
    return d.innerText.replace(/\n{3,}/g,'\n').slice(0,1800);
  });
  const fields = await page.$$eval('[role="dialog"] input, [role="dialog"] textarea, [role="dialog"] select', els => els.map(e => ({
    type: e.type, ph: e.placeholder, label: e.getAttribute('aria-label'), required: e.required })));
  log(`--- ${name} ---`); console.log(dialog); log('FIELDS: ' + JSON.stringify(fields));
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
    await page.waitForTimeout(1500);

    // Type 1: For Referrals (default)
    await detail(page, 'cc_type1_referrals');
    // Type 2: Location Zone
    await page.getByText('Location Zone', { exact: true }).first().click({ timeout: 8000 }).catch(e=>log('LZ click: '+e.message));
    await detail(page, 'cc_type2_location_zone');
    // Type 3: Address List
    await page.getByText('Address List', { exact: true }).first().click({ timeout: 8000 }).catch(e=>log('AL click: '+e.message));
    await detail(page, 'cc_type3_address_list');

    log('DONE slider types');
  } catch (e) {
    log('ERROR: ' + e.message);
    try { await page.screenshot({ path: `${SHOTS}/_slidertypes_error.png`, fullPage: true }); } catch {}
  } finally { await browser.close(); }
})();
