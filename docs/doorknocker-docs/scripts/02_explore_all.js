// Single-session explorer: login -> pick org -> walk every module, capture screenshots + structure.
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = 'https://door-knocker-plus-dev.vercel.app';
const EMAIL = 'aristotle@yopmail.com';
const PASS = 'Qwerty@1234';
const OUT = 'C:/Users/Shahzaib/Desktop/Claude/doorknocker-docs';
const SHOTS = `${OUT}/screenshots`;

const log = (m) => console.log(`[${new Date().toISOString().slice(11,19)}] ${m}`);

async function snapshot(page, name) {
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
  const text = await page.evaluate(() => document.body.innerText.replace(/\n{3,}/g,'\n\n').slice(0, 2500));
  const buttons = await page.$$eval('button, a[role="button"], [role="button"]', els =>
    [...new Set(els.map(e => e.textContent.trim().replace(/\s+/g,' ')).filter(t => t && t.length<60))]);
  const fields = await page.$$eval('input, textarea, select', els => els.map(e => ({
    tag: e.tagName, type: e.type, name: e.name, ph: e.placeholder, label: e.getAttribute('aria-label'), required: e.required })));
  log(`== ${name} == URL: ${page.url()}`);
  log('TEXT:\n' + text);
  log('BUTTONS: ' + JSON.stringify(buttons));
  log('FIELDS: ' + JSON.stringify(fields));
  log('-----------------------------------');
  return { name, url: page.url(), text, buttons, fields };
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const results = [];
  try {
    // 1. Login
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.fill('input[type="email"], input[name="email"], input[placeholder*="mail" i]', EMAIL);
    await page.fill('input[type="password"]', PASS);
    await page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Sign in")').first().click();
    await page.waitForURL('**/pick-organization', { timeout: 30000 }).catch(()=>{});
    await page.waitForTimeout(2500);
    log('After login: ' + page.url());

    // 2. Pick org "hundred" (Last Accessed) - click the card
    await page.getByText('hundred', { exact: true }).first().click({ timeout: 20000 });
    await page.waitForTimeout(4000);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(()=>{});
    log('After org pick: ' + page.url());
    results.push(await snapshot(page, 'dashboard'));

    // 3. Capture nav links
    const nav = await page.$$eval('nav a, aside a, [role="navigation"] a', els => {
      const seen=new Set();
      return els.map(e=>({text:e.textContent.trim().replace(/\s+/g,' '),href:e.getAttribute('href')}))
        .filter(x=>x.text&&x.href&&!seen.has(x.href)&&(seen.add(x.href),true));
    });
    log('NAV: ' + JSON.stringify(nav, null, 2));
    fs.writeFileSync(`${OUT}/nav.json`, JSON.stringify(nav, null, 2));

    // 4. Visit each module by clicking sidebar label (more robust than guessing routes)
    const modules = ['Dashboard','Campaigns','Referrals','Templates','Settings'];
    for (const m of modules) {
      try {
        await page.getByRole('link', { name: new RegExp('^'+m, 'i') }).first().click({ timeout: 10000 });
        await page.waitForTimeout(2500);
        await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(()=>{});
        results.push(await snapshot(page, 'module_' + m.toLowerCase()));
      } catch (e) {
        log(`Could not open module ${m}: ${e.message}`);
      }
    }

    fs.writeFileSync(`${OUT}/explore_results.json`, JSON.stringify(results, null, 2));
    log('Saved explore_results.json');
  } catch (e) {
    log('FATAL: ' + e.message);
    try { await page.screenshot({ path: `${SHOTS}/_explore_error.png`, fullPage: true }); } catch {}
  } finally {
    await browser.close();
  }
})();
