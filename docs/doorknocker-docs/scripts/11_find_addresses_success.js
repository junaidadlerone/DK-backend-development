// Refined: select a valid autocomplete address, Find Addresses, capture the generated list + Verify (paid) button. STOP at Verify.
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
    await page.locator('tr', { hasText: 'Draft' }).first().click({ timeout: 8000 });
    await page.waitForURL('**/campaigns/create**', { timeout: 20000 }).catch(()=>{});
    await page.waitForTimeout(3000);

    const addr = page.locator('input[placeholder="Enter Address"]');
    await addr.click({ timeout: 5000 });
    await addr.fill('');
    await addr.type('2755 Sand Hill Rd', { delay: 110 });
    await page.waitForTimeout(2800);
    // Click the Menlo Park, California option by exact-ish text
    await page.getByText(/Menlo Park, San Mateo County, California/i).first().click({ timeout: 6000 });
    await page.waitForTimeout(2500);
    await shot(page, 'cc_setup_06_addr_chosen');

    // ensure Radius mode, set radius a bit higher via slider keyboard
    await page.getByText('Radius Mode', { exact: true }).click({ timeout: 4000 }).catch(()=>{});
    const slider = page.locator('input[type="range"]');
    if (await slider.count()) { await slider.focus(); for (let i=0;i<5;i++){ await page.keyboard.press('ArrowRight'); } }
    await page.waitForTimeout(500);

    await page.getByRole('button', { name: /Find Addresses/i }).click({ timeout: 6000 });
    await page.waitForTimeout(5000);
    await shot(page, 'cc_setup_07_addresses_generated');

    log('STOP: Verify Addresses (paid) NOT clicked.');
    fs.writeFileSync(`${OUT}/find_addr_results.json`, JSON.stringify(results, null, 2));
  } catch (e) {
    log('ERROR: ' + e.message);
    try { await page.screenshot({ path: `${SHOTS}/_findaddr_error.png`, fullPage: true }); } catch {}
    fs.writeFileSync(`${OUT}/find_addr_results.json`, JSON.stringify(results, null, 2));
  } finally { await browser.close(); }
})();
