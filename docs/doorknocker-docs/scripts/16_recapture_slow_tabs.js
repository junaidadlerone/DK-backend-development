const { chromium } = require('playwright');
const BASE = 'https://door-knocker-plus-dev.vercel.app';
const EMAIL = 'aristotle@yopmail.com', PASS = 'Qwerty@1234';
const OUT = 'C:/Users/Shahzaib/Desktop/Claude/doorknocker-docs', SHOTS = `${OUT}/screenshots`;
const log = (m) => console.log(m);
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

    await page.goto(`${BASE}/settings?tab=subscription`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(7000);
    await page.screenshot({ path: `${SHOTS}/settings_payments_billing.png`, fullPage: true });
    log('payments: ' + (await page.evaluate(()=>document.body.innerText.replace(/\n{3,}/g,'\n').slice(0,900))));

    await page.goto(`${BASE}/settings?tab=users`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(7000);
    await page.screenshot({ path: `${SHOTS}/settings_user_management.png`, fullPage: true });
    log('users: ' + (await page.evaluate(()=>document.body.innerText.replace(/\n{3,}/g,'\n').slice(0,900))));
  } catch (e) { log('ERR: '+e.message); }
  finally { await browser.close(); }
})();
