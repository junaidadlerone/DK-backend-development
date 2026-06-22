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
  const text = await page.evaluate(() => document.body.innerText.replace(/\n{3,}/g,'\n').slice(0, 2400));
  const buttons = await page.$$eval('button,[role="button"]', els=>[...new Set(els.map(e=>e.textContent.trim().replace(/\s+/g,' ')).filter(t=>t&&t.length<45))]);
  log(`\n===== ${name} ===== ${page.url()}`); console.log(text); log('BTN: '+JSON.stringify(buttons));
  results.push({name,url:page.url(),text,buttons});
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
    await page.waitForTimeout(1500);

    // ---- ACTIVE CAMPAIGN DETAIL ----
    await page.goto(`${BASE}/campaigns`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);
    await page.locator('input[placeholder="Search campaigns..."]').fill('Location Test 23');
    await page.waitForTimeout(2500);
    await page.locator('tr', { hasText: 'Location Test 23' }).first().click({ timeout: 8000 }).catch(e=>log('active click: '+e.message));
    await page.waitForTimeout(3500);
    log('URL active: ' + page.url());
    await shot(page, 'camp_active_detail2');

    // ---- TEMPLATE EDITOR (create then open) ----
    await page.goto(`${BASE}/templates`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);
    await page.getByRole('button', { name: /Create New Template/i }).first().click({ timeout: 8000 });
    await page.waitForTimeout(1500);
    await page.locator('input[placeholder="Enter template name"]').fill('Doc Editor Test');
    await page.locator('[role="dialog"]').getByRole('button', { name: /^Create Template$/i }).click({ timeout: 6000 }).catch(async e=>{
      log('create modal btn fallback: '+e.message);
      await page.getByRole('button', { name: /^Create Template$/i }).last().click({ timeout: 5000 }).catch(()=>{});
    });
    await page.waitForTimeout(5000);
    log('URL editor: ' + page.url());
    await shot(page, 'templates_03_editor');

    fs.writeFileSync(`${OUT}/active_editor.json`, JSON.stringify(results, null, 2));
    log('DONE');
  } catch (e) {
    log('ERROR: ' + e.message);
    try { await page.screenshot({ path: `${SHOTS}/_ae_error.png`, fullPage: true }); } catch {}
    fs.writeFileSync(`${OUT}/active_editor.json`, JSON.stringify(results, null, 2));
  } finally { await browser.close(); }
})();
