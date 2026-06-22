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
  const text = await page.evaluate(() => document.body.innerText.replace(/\n{3,}/g,'\n').slice(0, 2200));
  const buttons = await page.$$eval('button,[role="button"]', els=>[...new Set(els.map(e=>e.textContent.trim().replace(/\s+/g,' ')).filter(t=>t&&t.length<45))]);
  const fields = await page.$$eval('input,textarea,select', els=>els.map(e=>({type:e.type,ph:e.placeholder,req:e.required})));
  log(`\n===== ${name} ===== ${page.url()}`); console.log(text);
  log('BTN: '+JSON.stringify(buttons)); log('FLD: '+JSON.stringify(fields));
  results.push({name,url:page.url(),text,buttons,fields});
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

    // ---- SETTINGS TABS ----
    await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);
    await shot(page, 'settings_01_organization');
    for (const tab of ['Payments & Billing','Branding & Design','User Management']) {
      await page.getByText(tab, { exact: true }).first().click({ timeout: 8000 }).catch(e=>log(tab+': '+e.message));
      await shot(page, 'settings_' + tab.toLowerCase().replace(/[^a-z]+/g,'_'));
    }

    // ---- TEMPLATES ----
    await page.goto(`${BASE}/templates`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2500);
    await shot(page, 'templates_01_list');
    // Create New Template -> observe (modal or editor)
    await page.getByRole('button', { name: /Create New Template/i }).first().click({ timeout: 8000 }).catch(e=>log('create tmpl: '+e.message));
    await page.waitForTimeout(3000);
    await shot(page, 'templates_02_create');

    // ---- REFERRALS ----
    await page.goto(`${BASE}/referrals`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2500);
    await shot(page, 'referrals_01_list');
    await page.getByRole('button', { name: /Add New Referral/i }).first().click({ timeout: 8000 }).catch(e=>log('add ref: '+e.message));
    await page.waitForTimeout(2500);
    await shot(page, 'referrals_02_add_form');

    fs.writeFileSync(`${OUT}/settings_templates_referrals.json`, JSON.stringify(results, null, 2));
    log('DONE');
  } catch (e) {
    log('ERROR: ' + e.message);
    try { await page.screenshot({ path: `${SHOTS}/_str_error.png`, fullPage: true }); } catch {}
    fs.writeFileSync(`${OUT}/settings_templates_referrals.json`, JSON.stringify(results, null, 2));
  } finally { await browser.close(); }
})();
