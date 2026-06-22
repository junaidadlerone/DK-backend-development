// Open Edit Campaign, set Estimated Start Date, save, verify it persisted.
const { chromium } = require('playwright');
const BASE = 'https://door-knocker-plus-dev.vercel.app';
const EMAIL = 'aristotle@yopmail.com', PASS = 'Qwerty@1234';
const OUT = 'C:/Users/Shahzaib/Desktop/Claude/doorknocker-docs', SHOTS = `${OUT}/screenshots`;
const log = (m) => console.log(`[${new Date().toISOString().slice(11,19)}] ${m}`);
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
    await page.locator('tr', { hasText: 'Doc LZ Setup' }).first().click({ timeout: 10000 });
    await page.waitForURL('**/campaigns/create**', { timeout: 20000 }).catch(()=>{});
    await page.getByRole('button', { name: /Edit Campaign/i }).waitFor({ timeout: 40000 });
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: /Edit Campaign/i }).click({ timeout: 8000 });
    await page.waitForTimeout(2500);

    // list buttons in the edit slider
    const btns0 = await page.evaluate(()=>[...document.querySelectorAll('button')].map(b=>b.textContent.trim()).filter(t=>/save|update|create|cancel/i.test(t)));
    log('SLIDER BUTTONS: ' + JSON.stringify(btns0));

    // Click the Estimated Start Date field (placeholder Select a date) and pick day 30
    await page.locator('input[placeholder="Select a date"]').click({ timeout: 6000 });
    await page.waitForTimeout(1000);
    let picked = false;
    for (const d of ['30','29','28','27','26','25']) {
      const cell = page.getByRole('gridcell', { name: d, exact: true });
      if (await cell.count()) { await cell.first().click({ timeout: 3000 }).then(()=>{picked=true;}).catch(()=>{}); if (picked) break; }
      const btn = page.getByRole('button', { name: d, exact: true });
      if (!picked && await btn.count()) { await btn.first().click({ timeout: 3000 }).then(()=>{picked=true;}).catch(()=>{}); if (picked) break; }
    }
    log('date picked: ' + picked);
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SHOTS}/launch_33_date_set.png`, fullPage: true });

    // Save
    await page.getByRole('button', { name: /^(Save|Update|Save Changes|Update Campaign|Save Campaign)$/i }).first().click({ timeout: 6000 }).catch(e=>log('save: '+e.message));
    await page.waitForTimeout(3500);

    // verify date in Campaign Overview
    const overview = await page.evaluate(()=>{ const m=document.body.innerText.match(/Estimated Start Date\s*\n?\s*([^\n]+)/i); return m?m[1]:'(not found)'; });
    log('Estimated Start Date now: ' + overview);
    await page.screenshot({ path: `${SHOTS}/launch_34_after_date_save.png`, fullPage: true });
  } catch (e) { log('ERROR: ' + e.message); }
  finally { await browser.close(); }
})();
