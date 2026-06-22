// Campaign Creation flow walker. Captures each step screenshot. STOPS before payment.
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = 'https://door-knocker-plus-dev.vercel.app';
const EMAIL = 'aristotle@yopmail.com';
const PASS = 'Qwerty@1234';
const OUT = 'C:/Users/Shahzaib/Desktop/Claude/doorknocker-docs';
const SHOTS = `${OUT}/screenshots`;
const log = (m) => console.log(`[${new Date().toISOString().slice(11,19)}] ${m}`);

async function shot(page, name) {
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
  const text = await page.evaluate(() => document.body.innerText.replace(/\n{3,}/g,'\n\n').slice(0, 2000));
  const buttons = await page.$$eval('button, [role="button"]', els =>
    [...new Set(els.map(e => e.textContent.trim().replace(/\s+/g,' ')).filter(t => t && t.length<60))]);
  const fields = await page.$$eval('input, textarea, select', els => els.map(e => ({
    type: e.type, ph: e.placeholder, label: e.getAttribute('aria-label'), required: e.required })));
  log(`\n===== ${name} ===== ${page.url()}`);
  console.log(text);
  log('BUTTONS: ' + JSON.stringify(buttons));
  log('FIELDS: ' + JSON.stringify(fields));
  return { name, url: page.url(), text, buttons, fields };
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const results = [];
  try {
    // login + org
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.fill('input[type="email"], input[name="email"]', EMAIL);
    await page.fill('input[type="password"]', PASS);
    await page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Sign in")').first().click();
    await page.waitForURL('**/pick-organization', { timeout: 30000 }).catch(()=>{});
    await page.waitForTimeout(2000);
    await page.getByText('hundred', { exact: true }).first().click({ timeout: 20000 });
    await page.waitForURL('**/dashboard', { timeout: 30000 }).catch(()=>{});
    await page.waitForTimeout(2500);
    log('Logged in, on dashboard');

    // Go to campaigns
    await page.goto(`${BASE}/campaigns`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Click Create New Campaign
    await page.getByRole('button', { name: /Create New Campaign/i }).first().click({ timeout: 10000 });
    results.push(await shot(page, 'cc_01_create_slider'));

    // Inspect the slider: capture campaign type options
    const typeOptions = await page.$$eval('[role="dialog"] *, .slider *, aside *', els =>
      [...new Set(els.map(e=>e.textContent.trim()).filter(t=>/referral|location zone|address list/i.test(t) && t.length<40))]);
    log('TYPE OPTIONS DETECTED: ' + JSON.stringify(typeOptions));

    fs.writeFileSync(`${OUT}/campaign_creation_results.json`, JSON.stringify(results, null, 2));
    log('DONE (stage 1: slider captured). Saved results.');
  } catch (e) {
    log('ERROR: ' + e.message);
    try { await page.screenshot({ path: `${SHOTS}/_cc_error.png`, fullPage: true }); } catch {}
  } finally {
    await browser.close();
  }
})();
