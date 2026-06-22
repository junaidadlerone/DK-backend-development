// Submit address validation (test card already saved) and poll until complete.
const { chromium } = require('playwright');
const BASE = 'https://door-knocker-plus-dev.vercel.app';
const EMAIL = 'aristotle@yopmail.com', PASS = 'Qwerty@1234';
const OUT = 'C:/Users/Shahzaib/Desktop/Claude/doorknocker-docs', SHOTS = `${OUT}/screenshots`;
const log = (m) => console.log(`[${new Date().toISOString().slice(11,19)}] ${m}`);
async function snap(page, name) {
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
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
    await page.locator('tr', { hasText: 'Doc LZ Setup' }).first().click({ timeout: 10000 });
    await page.waitForURL('**/campaigns/create**', { timeout: 20000 }).catch(()=>{});
    await page.getByRole('button', { name: /Validate Addresses/i }).first().waitFor({ timeout: 40000 });
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: /^Validate Addresses$/i }).first().click({ timeout: 8000 });
    await page.waitForTimeout(4000);

    // In modal: tick authorization checkbox
    const dialog = page.locator('[role="dialog"]');
    const cb = dialog.locator('input[type="checkbox"]');
    if (await cb.count()) { await cb.first().check({ timeout: 5000 }).catch(async()=>{ await dialog.getByText(/I authorize/i).click({timeout:4000}).catch(()=>{}); }); }
    log('authorization checked');
    await snap(page, 'launch_12_validate_modal_authorized');

    // Click modal Validate Addresses (submit)
    await dialog.getByRole('button', { name: /^Validate Addresses$/i }).click({ timeout: 8000 });
    log('Submitted validation payment. Polling for completion...');
    await page.waitForTimeout(4000);
    await snap(page, 'launch_13_validation_started');

    // Poll up to ~9 minutes for validation completion
    let done = false;
    for (let i = 0; i < 27 && !done; i++) {
      await page.waitForTimeout(20000);
      const t = await page.evaluate(() => document.body.innerText);
      const validated = /These addresses are validated|Addresses validated|Launch Campaign|Validated Addresses\s*\n?\s*\d+/i.test(t);
      const stillValidating = /validating|in progress|processing/i.test(t);
      log(`poll ${i+1}: validated=${validated} validating=${stillValidating}`);
      if (validated && !/Click to validate selected addresses/i.test(t)) { done = true; }
    }
    await snap(page, 'launch_14_after_validation');
    const finalText = await page.evaluate(() => document.body.innerText.replace(/\n{3,}/g,'\n').slice(0,2200));
    log('FINAL STATE:\n' + finalText);
    log('DONE validation (done=' + done + ')');
  } catch (e) {
    log('ERROR: ' + e.message);
    try { await snap(page, '_validation_error'); } catch {}
  } finally { await browser.close(); }
})();
