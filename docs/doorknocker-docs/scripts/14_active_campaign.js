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
  const text = await page.evaluate(() => document.body.innerText.replace(/\n{3,}/g,'\n').slice(0, 2600));
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
    await page.goto(`${BASE}/campaigns`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2500);

    // Walk pages until a row with 'Active' is found, then click it
    let clicked = false;
    for (let p = 1; p <= 4 && !clicked; p++) {
      const rows = page.locator('table tbody tr, tr');
      const n = await rows.count();
      for (let i = 0; i < n; i++) {
        const t = (await rows.nth(i).innerText().catch(()=>'')) || '';
        if (/\bActive\b/.test(t) && !/Active Campaigns/.test(t)) {
          log('Clicking active row: ' + t.replace(/\s+/g,' ').slice(0,60));
          await rows.nth(i).click({ timeout: 6000 }).catch(e=>log('click err: '+e.message));
          await page.waitForTimeout(3500);
          clicked = page.url().includes('/campaigns/');
          break;
        }
      }
      if (!clicked) { // next page
        await page.getByRole('button', { name: String(p+1), exact: true }).click({ timeout: 4000 }).catch(()=>{});
        await page.waitForTimeout(2000);
      }
    }
    log('URL after active attempt: ' + page.url());
    await shot(page, 'camp_active_detail_final');
    fs.writeFileSync(`${OUT}/active_campaign.json`, JSON.stringify(results, null, 2));
  } catch (e) {
    log('ERROR: ' + e.message);
    try { await page.screenshot({ path: `${SHOTS}/_active2_error.png`, fullPage: true }); } catch {}
    fs.writeFileSync(`${OUT}/active_campaign.json`, JSON.stringify(results, null, 2));
  } finally { await browser.close(); }
})();
