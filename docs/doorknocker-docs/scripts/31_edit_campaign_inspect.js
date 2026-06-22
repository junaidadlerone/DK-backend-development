// Open Edit Campaign on the draft to find the Estimated Start Date field. Read-only inspect.
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
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${SHOTS}/launch_32_edit_campaign.png`, fullPage: true });
    const dlg = await page.evaluate(() => { const d=document.querySelector('[role="dialog"]'); return d?d.innerText.slice(0,1800):'(no dialog) '+document.body.innerText.slice(0,800); });
    log('EDIT FORM:\n' + dlg);
    const fields = await page.evaluate(()=>[...document.querySelectorAll('[role="dialog"] input, [role="dialog"] textarea')].map(e=>({type:e.type,ph:e.placeholder,val:e.value})));
    log('FIELDS: ' + JSON.stringify(fields));
  } catch (e) { log('ERROR: ' + e.message); }
  finally { await browser.close(); }
})();
