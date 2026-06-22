// Enter an org, land on dashboard, map navigation + capture screenshots.
const { chromium } = require('playwright');
const BASE = 'https://door-knocker-plus-dev.vercel.app';
const OUT = 'C:/Users/Shahzaib/Desktop/Claude/doorknocker-docs';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: `${OUT}/auth-state.json` });
  const page = await ctx.newPage();
  const log = (m) => console.log(`[${new Date().toISOString().slice(11,19)}] ${m}`);

  try {
    await page.goto(`${BASE}/pick-organization`, { waitUntil: 'networkidle', timeout: 45000 });
    log('At: ' + page.url());

    // Click the first org card (hundred - Last Accessed)
    await page.locator('text=hundred').first().click();
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(()=>log('idle timeout'));
    await page.waitForTimeout(3000);
    log('After org select URL: ' + page.url());

    const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 2000));
    log('--- DASHBOARD TEXT ---'); console.log(bodyText); log('--- END ---');

    // Map all nav/sidebar links
    const navItems = await page.$$eval('nav a, aside a, [role="navigation"] a, a[href^="/"]', els => {
      const seen = new Set();
      return els.map(e => ({ text: e.textContent.trim().replace(/\s+/g,' '), href: e.getAttribute('href') }))
        .filter(x => x.text && x.href && !seen.has(x.href) && (seen.add(x.href), true));
    });
    log('NAV LINKS:'); console.log(JSON.stringify(navItems, null, 2));

    await page.screenshot({ path: `${OUT}/screenshots/dashboard_landing.png`, fullPage: true });
    await ctx.storageState({ path: `${OUT}/auth-state.json` }); // refresh state with org selected
    log('Saved dashboard_landing.png + refreshed auth-state');
  } catch (e) {
    log('ERROR: ' + e.message);
    try { await page.screenshot({ path: `${OUT}/screenshots/_org_error.png`, fullPage: true }); } catch {}
  } finally {
    await browser.close();
  }
})();
