// LAUNCH stage 1: open the Doc LZ Setup draft (has a template), small radius, Find Addresses,
// click Validate Addresses, then CAPTURE the payment UI (Stripe). Do not blindly submit yet.
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = 'https://door-knocker-plus-dev.vercel.app';
const EMAIL = 'aristotle@yopmail.com', PASS = 'Qwerty@1234';
const OUT = 'C:/Users/Shahzaib/Desktop/Claude/doorknocker-docs', SHOTS = `${OUT}/screenshots`;
const log = (m) => console.log(`[${new Date().toISOString().slice(11,19)}] ${m}`);
async function shot(page, name) {
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
  const text = await page.evaluate(() => document.body.innerText.replace(/\n{3,}/g,'\n').slice(0, 2200));
  log(`\n===== ${name} ===== ${page.url()}`); console.log(text);
  // report iframes (stripe)
  const frames = page.frames().map(f => f.url()).filter(u => /stripe|js\.stripe|elements/i.test(u));
  log('STRIPE FRAMES: ' + JSON.stringify(frames));
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

    // Open the "Doc LZ Setup" draft (has a template assigned)
    await page.locator('tr', { hasText: 'Doc LZ Setup' }).first().click({ timeout: 10000 });
    await page.waitForURL('**/campaigns/create**', { timeout: 20000 }).catch(()=>{});
    // wait for the targeting UI to finish loading
    await page.getByText('Choose Your Target Audience', { exact: false }).waitFor({ timeout: 40000 }).catch(()=>log('target heading not seen'));
    await page.locator('input[placeholder="Enter Address"]').waitFor({ timeout: 20000 }).catch(()=>log('addr input not seen'));
    await page.waitForTimeout(2000);
    await shot(page, 'launch_01_setup');

    // Set address + smallest radius, Find Addresses
    const addr = page.locator('input[placeholder="Enter Address"]');
    await addr.click({ timeout: 8000 }); await addr.fill('');
    await addr.type('2755 Sand Hill Rd', { delay: 110 });
    await page.waitForTimeout(2800);
    await page.getByText(/Menlo Park, San Mateo County, California/i).first().click({ timeout: 6000 });
    await page.waitForTimeout(2000);
    await page.getByText('Radius Mode', { exact: true }).click({ timeout: 4000 }).catch(()=>{});
    // leave radius at default minimum (0.1 mi) for fewest addresses
    await page.getByRole('button', { name: /Find Addresses/i }).click({ timeout: 6000 });
    await page.waitForTimeout(6000);
    await shot(page, 'launch_02_addresses_found');

    // Click Validate Addresses and observe the payment UI
    await page.getByRole('button', { name: /Validate Addresses|Verify Addresses/i }).first().click({ timeout: 8000 }).catch(e=>log('validate click: '+e.message));
    await page.waitForTimeout(5000);
    await shot(page, 'launch_03_validate_payment_ui');

    // dump any dialog/modal text + inputs to understand payment form
    const dlg = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]');
      return d ? d.innerText.slice(0,1500) : '(no dialog)';
    });
    log('DIALOG: ' + dlg);
    log('DONE stage 1');
  } catch (e) {
    log('ERROR: ' + e.message);
    try { await page.screenshot({ path: `${SHOTS}/_launch1_error.png`, fullPage: true }); } catch {}
  } finally { await browser.close(); }
})();
