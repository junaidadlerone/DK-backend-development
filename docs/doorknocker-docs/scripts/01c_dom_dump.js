const { chromium } = require('playwright');
const fs = require('fs');
const BASE = 'https://door-knocker-plus-dev.vercel.app';
const OUT = 'C:/Users/Shahzaib/Desktop/Claude/doorknocker-docs';
(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: `${OUT}/auth-state.json` });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/pick-organization`, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(4000);
  console.log('URL: ' + page.url());
  console.log('total elements: ' + await page.evaluate(() => document.querySelectorAll('*').length));
  // Find the element whose text is exactly an org name and report ancestor chain that is clickable
  const info = await page.evaluate(() => {
    function findClickableAncestor(el) {
      let cur = el; const chain = [];
      for (let i=0;i<6 && cur;i++){
        const cs = getComputedStyle(cur);
        chain.push({ tag: cur.tagName, cls: (cur.className||'').toString().slice(0,50), cursor: cs.cursor, role: cur.getAttribute('role') });
        cur = cur.parentElement;
      }
      return chain;
    }
    const all = [...document.querySelectorAll('*')];
    const target = all.find(e => e.children.length===0 && e.textContent.trim()==='Gaustavo');
    return target ? findClickableAncestor(target) : 'not found';
  });
  console.log(JSON.stringify(info, null, 2));
  fs.writeFileSync(`${OUT}/_picker.html`, await page.content());
  console.log('saved _picker.html');
  await browser.close();
})();
