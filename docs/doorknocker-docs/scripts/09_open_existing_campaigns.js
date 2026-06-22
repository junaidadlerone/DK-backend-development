// Open an existing Draft and an Active campaign to reveal setup/targeting + detail views.
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = 'https://door-knocker-plus-dev.vercel.app';
const EMAIL = 'aristotle@yopmail.com', PASS = 'Qwerty@1234';
const OUT = 'C:/Users/Shahzaib/Desktop/Claude/doorknocker-docs', SHOTS = `${OUT}/screenshots`;
const log = (m) => console.log(`[${new Date().toISOString().slice(11,19)}] ${m}`);
const results = [];
async function shot(page, name) {
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
  const text = await page.evaluate(() => document.body.innerText.replace(/\n{3,}/g,'\n').slice(0, 2200));
  const buttons = await page.$$eval('button, [role="button"], a[role="button"]', els => [...new Set(els.map(e=>e.textContent.trim().replace(/\s+/g,' ')).filter(t=>t&&t.length<50))]);
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
    await page.waitForTimeout(2000);

    // 1) Open an ACTIVE campaign (find a row containing 'Active' and click its name cell)
    const activeRow = page.locator('tr', { hasText: 'Active' }).first();
    await activeRow.click({ timeout: 8000 }).catch(e=>log('active row click: '+e.message));
    await page.waitForTimeout(3000);
    log('URL after active row: ' + page.url());
    await shot(page, 'camp_active_detail');

    // back to campaigns
    await page.goto(`${BASE}/campaigns`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    // 2) Open a DRAFT campaign (Location Test draft)
    const draftRow = page.locator('tr', { hasText: 'Draft' }).first();
    await draftRow.click({ timeout: 8000 }).catch(e=>log('draft row click: '+e.message));
    await page.waitForTimeout(3000);
    log('URL after draft row: ' + page.url());
    await shot(page, 'camp_draft_detail');

    fs.writeFileSync(`${OUT}/existing_campaign_results.json`, JSON.stringify(results, null, 2));
    log('DONE existing campaigns');
  } catch (e) {
    log('ERROR: ' + e.message);
    try { await page.screenshot({ path: `${SHOTS}/_existing_error.png`, fullPage: true }); } catch {}
    fs.writeFileSync(`${OUT}/existing_campaign_results.json`, JSON.stringify(results, null, 2));
  } finally { await browser.close(); }
})();
