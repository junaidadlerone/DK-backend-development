// On Pick a Template, inspect card DOM so we can select one properly, then continue and observe routing.
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
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: /Create New Campaign/i }).first().click({ timeout: 10000 });
    await page.waitForTimeout(1000);
    await page.locator('[role="dialog"] input[placeholder="Summer Sale Campaign"]').fill('Doc Probe T');
    await page.getByText('Location Zone', { exact: true }).first().click({ timeout: 8000 });
    await page.waitForTimeout(500);
    await page.locator('[role="dialog"] input[placeholder="Select a date"]').click({ timeout: 5000 }).catch(()=>{});
    await page.waitForTimeout(500);
    await page.getByRole('gridcell', { name: '25', exact: true }).click({ timeout: 4000 }).catch(()=>{});
    await page.locator('[role="dialog"]').getByRole('button', { name: /^Create Campaign$/i }).click({ timeout: 8000 });
    await page.waitForTimeout(4000);

    // Inspect: find the element holding template name "Modern Detached Home" and its clickable ancestor chain
    const probe = await page.evaluate(() => {
      const all = [...document.querySelectorAll('*')];
      const t = all.find(e => e.children.length===0 && e.textContent.trim()==='Modern Detached Home');
      if (!t) return 'name not found';
      const chain=[]; let cur=t;
      for (let i=0;i<7 && cur;i++){ const cs=getComputedStyle(cur);
        chain.push({tag:cur.tagName, cls:(cur.className||'').toString().slice(0,70), cursor:cs.cursor, role:cur.getAttribute('role')}); cur=cur.parentElement; }
      return chain;
    });
    log('CARD CHAIN: ' + JSON.stringify(probe, null, 2));

    // Click the card by its name's clickable ancestor (cursor:pointer)
    await page.getByText('Modern Detached Home', { exact: true }).first().click({ timeout: 6000 }).catch(e=>log('name click: '+e.message));
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${SHOTS}/cc_lz_03b_template_selected.png`, fullPage: true });
    // Now Continue without Editing
    await page.getByRole('button', { name: /Continue without Editing/i }).click({ timeout: 6000 }).catch(e=>log('continue: '+e.message));
    await page.waitForTimeout(3500);
    log('URL after continue: ' + page.url());
    await page.screenshot({ path: `${SHOTS}/cc_lz_03c_after_template_continue.png`, fullPage: true });
    const txt = await page.evaluate(()=>document.body.innerText.replace(/\n{3,}/g,'\n').slice(0,1500));
    log('PAGE TEXT:\n' + txt);
  } catch (e) {
    log('ERROR: ' + e.message);
    try { await page.screenshot({ path: `${SHOTS}/_tmplprobe_error.png`, fullPage: true }); } catch {}
  } finally { await browser.close(); }
})();
