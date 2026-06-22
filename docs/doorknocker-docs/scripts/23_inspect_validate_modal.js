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
    await page.goto(`${BASE}/campaigns`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2500);
    await page.locator('tr', { hasText: 'Doc LZ Setup' }).first().click({ timeout: 10000 });
    await page.waitForURL('**/campaigns/create**', { timeout: 20000 }).catch(()=>{});
    await page.getByRole('button', { name: /Validate Addresses/i }).first().waitFor({ timeout: 40000 });
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: /^Validate Addresses$/i }).first().click({ timeout: 8000 });
    await page.waitForTimeout(4000);

    const info = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]'); if (!d) return 'no dialog';
      const out = { checkboxes: [], clickables: [], buttons: [] };
      d.querySelectorAll('input').forEach(e => out.checkboxes.push({type:e.type,checked:e.checked,name:e.name,cls:(e.className||'').slice(0,40)}));
      d.querySelectorAll('button').forEach(e => out.buttons.push({txt:e.textContent.trim().slice(0,30),disabled:e.disabled}));
      // elements that look like the card row / checkbox label
      d.querySelectorAll('[class*="cursor"],label,[role="checkbox"],[role="radio"]').forEach(e=>{
        const t=e.textContent.trim().slice(0,40); if(t) out.clickables.push({tag:e.tagName,role:e.getAttribute('role'),txt:t});
      });
      return out;
    });
    log(JSON.stringify(info, null, 2));

    // Try: click card row, then click the authorize label, then re-check button
    await page.locator('[role="dialog"]').getByText(/4242/).click({ timeout: 4000 }).catch(e=>log('card click: '+e.message));
    await page.waitForTimeout(500);
    await page.locator('[role="dialog"]').getByText(/I authorize/i).click({ timeout: 4000 }).catch(e=>log('auth click: '+e.message));
    await page.waitForTimeout(800);
    const btnState = await page.evaluate(() => {
      const d=document.querySelector('[role="dialog"]');
      const b=[...d.querySelectorAll('button')].find(x=>/Validate Addresses/i.test(x.textContent));
      const cbs=[...d.querySelectorAll('input[type=checkbox]')].map(c=>c.checked);
      return { submitDisabled: b?b.disabled:'?', checkboxes: cbs };
    });
    log('AFTER CLICKS: ' + JSON.stringify(btnState));
    await page.screenshot({ path: `${SHOTS}/launch_12b_modal_state.png`, fullPage: true });
  } catch (e) { log('ERR: '+e.message); }
  finally { await browser.close(); }
})();
