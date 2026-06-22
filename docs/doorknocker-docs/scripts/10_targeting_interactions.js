// Open a Draft setup page; capture Count Mode, address autocomplete, Find Addresses result. STOP at Verify (paid).
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
  log(`\n===== ${name} ===== ${page.url()}`); console.log(text);
  results.push({ name, url: page.url(), text });
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
    await page.waitForTimeout(2000);

    // Open first Draft row -> setup page
    await page.locator('tr', { hasText: 'Draft' }).first().click({ timeout: 8000 });
    await page.waitForURL('**/campaigns/create**', { timeout: 20000 }).catch(()=>{});
    await page.waitForTimeout(2500);
    await shot(page, 'cc_setup_01_radius_default');

    // Count Mode
    await page.getByText('Count Mode', { exact: true }).click({ timeout: 6000 }).catch(e=>log('count mode: '+e.message));
    await shot(page, 'cc_setup_02_count_mode');

    // Back to Radius Mode
    await page.getByText('Radius Mode', { exact: true }).click({ timeout: 6000 }).catch(()=>{});
    await page.waitForTimeout(500);

    // Address autocomplete
    const addr = page.locator('input[placeholder="Enter Address"]');
    await addr.click({ timeout: 5000 });
    await addr.type('2755 Sand Hill Rd', { delay: 90 });
    await page.waitForTimeout(2500);
    await shot(page, 'cc_setup_03_address_autocomplete');
    // pick first suggestion (li/option in a listbox)
    await page.locator('[role="option"], li').filter({ hasText: /Sand Hill|CA|Menlo|Road|Rd/i }).first().click({ timeout: 5000 }).catch(e=>log('suggestion: '+e.message));
    await page.waitForTimeout(2000);
    await shot(page, 'cc_setup_04_address_selected');

    // Find Addresses (generates list - should be free preview)
    await page.getByRole('button', { name: /Find Addresses/i }).click({ timeout: 6000 }).catch(e=>log('find: '+e.message));
    await page.waitForTimeout(4000);
    await shot(page, 'cc_setup_05_addresses_found');

    log('STOP: not clicking Verify Addresses (paid validation $0.025/addr).');
    fs.writeFileSync(`${OUT}/targeting_results.json`, JSON.stringify(results, null, 2));
  } catch (e) {
    log('ERROR: ' + e.message);
    try { await page.screenshot({ path: `${SHOTS}/_targeting_error.png`, fullPage: true }); } catch {}
    fs.writeFileSync(`${OUT}/targeting_results.json`, JSON.stringify(results, null, 2));
  } finally { await browser.close(); }
})();
