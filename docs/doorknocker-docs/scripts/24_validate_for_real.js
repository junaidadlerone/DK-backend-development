// Submit validation for real (auth label -> enable -> submit) and poll until validated.
const { chromium } = require('playwright');
const BASE = 'https://door-knocker-plus-dev.vercel.app';
const EMAIL = 'aristotle@yopmail.com', PASS = 'Qwerty@1234';
const OUT = 'C:/Users/Shahzaib/Desktop/Claude/doorknocker-docs', SHOTS = `${OUT}/screenshots`;
const log = (m) => console.log(`[${new Date().toISOString().slice(11,19)}] ${m}`);
const snap = (page,n) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true });
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

    // already validated? check
    const pre = await page.evaluate(()=>document.body.innerText);
    if (!/Click to validate selected addresses/i.test(pre) && /These addresses are validated|Validated Addresses\s*\n?\s*[1-9]/i.test(pre)) {
      log('Already validated. Skipping.'); await snap(page,'launch_14_after_validation');
    } else {
      await page.getByRole('button', { name: /^Validate Addresses$/i }).first().click({ timeout: 8000 });
      await page.waitForTimeout(3500);
      const dialog = page.locator('[role="dialog"]');
      await dialog.getByText(/4242/).click({ timeout: 4000 }).catch(()=>{});
      await dialog.getByText(/I authorize/i).click({ timeout: 4000 });
      await page.waitForTimeout(800);
      await snap(page, 'launch_12_authorized');
      await dialog.getByRole('button', { name: /^Validate Addresses$/i }).click({ timeout: 8000 });
      log('Validation submitted. Polling...');
      await page.waitForTimeout(5000);
      await snap(page, 'launch_13_validation_started');

      let done = false;
      for (let i = 0; i < 27 && !done; i++) {
        await page.waitForTimeout(20000);
        const t = await page.evaluate(() => document.body.innerText);
        const validated = !/Click to validate selected addresses/i.test(t) &&
          (/These addresses are validated/i.test(t) || /Launch Campaign/i.test(t) || /Validated Addresses\s*\n?\s*[1-9]/i.test(t));
        log(`poll ${i+1}: validated=${validated}`);
        if (validated) done = true;
      }
      await snap(page, 'launch_14_after_validation');
      log('done=' + done);
    }
    const finalText = await page.evaluate(() => document.body.innerText.replace(/\n{3,}/g,'\n').slice(0,2400));
    log('FINAL:\n' + finalText);
  } catch (e) {
    log('ERROR: ' + e.message);
    try { await snap(page, '_validate_real_error'); } catch {}
  } finally { await browser.close(); }
})();
