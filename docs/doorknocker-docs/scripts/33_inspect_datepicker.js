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
    await page.getByRole('button', { name: /Edit Campaign/i }).waitFor({ timeout: 40000 });
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: /Edit Campaign/i }).click({ timeout: 8000 });
    await page.waitForTimeout(2000);
    await page.locator('input[placeholder="Select a date"]').click({ timeout: 6000 });
    await page.waitForTimeout(1200);
    // Find the element for day "30" and its tag/role/clickable
    const info = await page.evaluate(() => {
      const cand = [...document.querySelectorAll('*')].filter(e => e.children.length===0 && /^(2[5-9]|30)$/.test(e.textContent.trim()));
      return cand.slice(0,8).map(e => {
        let cur=e, chain=[];
        for(let i=0;i<4&&cur;i++){ const cs=getComputedStyle(cur); chain.push({tag:cur.tagName,role:cur.getAttribute('role'),cls:(cur.className||'').toString().slice(0,40),cursor:cs.cursor,disabled:cur.getAttribute('disabled')!==null||cur.getAttribute('aria-disabled')==='true'}); cur=cur.parentElement; }
        return {day:e.textContent.trim(), chain};
      });
    });
    log(JSON.stringify(info, null, 2));
  } catch (e) { log('ERR: '+e.message); }
  finally { await browser.close(); }
})();
