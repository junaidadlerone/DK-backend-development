// Login probe: sign in as admin, detect MFA, capture nav, save storage state.
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = 'https://door-knocker-plus-dev.vercel.app';
const EMAIL = 'aristotle@yopmail.com';
const PASS = 'Qwerty@1234';
const OUT = 'C:/Users/Shahzaib/Desktop/Claude/doorknocker-docs';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const log = (m) => console.log(`[${new Date().toISOString().slice(11,19)}] ${m}`);

  try {
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 45000 });
    log('Login page: ' + page.url());

    await page.fill('input[type="email"], input[name="email"], input[placeholder*="mail" i]', EMAIL);
    await page.fill('input[type="password"]', PASS);
    await page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Sign in"), button:has-text("Log in")').first().click();
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(()=>log('idle timeout'));
    await page.waitForTimeout(3000);
    log('After login URL: ' + page.url());

    const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 1500));
    const mfa = /verification|code|otp|authenticat|6.digit|enter the code/i.test(bodyText);
    log('MFA likely? ' + mfa);
    log('--- BODY TEXT ---'); console.log(bodyText); log('--- END ---');

    // capture left-nav items
    const navItems = await page.$$eval('nav a, aside a, [role="navigation"] a', els =>
      els.map(e => ({ text: e.textContent.trim(), href: e.getAttribute('href') })).filter(x => x.text));
    log('NAV: ' + JSON.stringify(navItems, null, 2));

    await page.screenshot({ path: `${OUT}/screenshots/_probe_post_login.png`, fullPage: true });
    await ctx.storageState({ path: `${OUT}/auth-state.json` });
    log('Saved auth-state.json and probe screenshot');
  } catch (e) {
    log('ERROR: ' + e.message);
    try { await page.screenshot({ path: `${OUT}/screenshots/_probe_error.png`, fullPage: true }); } catch {}
  } finally {
    await browser.close();
  }
})();
