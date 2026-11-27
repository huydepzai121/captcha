// Chẩn đoán trang đăng nhập thật: có widget captcha không, form tên gì, nằm đâu.
// Chạy: npx tsx scripts/probe-checkio.ts "<url>" [outDir]

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const target = process.argv[2] ?? 'https://vinades.vn/vi/timekeeping/checkio/';
const outDir = process.argv[3] ?? 'runs/probe-checkio';
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  headless: false,
  channel: 'chrome',
  args: ['--disable-blink-features=AutomationControlled'],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();

page.on('framenavigated', (f) => {
  if (f === page.mainFrame()) console.log(`[nav] ${f.url()}`);
});

await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60_000 });
await page.waitForTimeout(6000);
await page.locator('form[data-recaptcha2]').first().waitFor({ state: 'attached', timeout: 30_000 }).catch(() => {});
await page.waitForTimeout(1500);

console.log('URL cuối:', page.url());
console.log('title:', await page.title());

// Chạy bằng chuỗi: esbuild bọc hàm evaluate bằng `__name(...)` mà trang thật
// không có helper đó, nên hàm lồng nhau trong arrow sẽ ReferenceError.
const info = await page.evaluate(`(() => {
  function sel(s) {
    return Array.from(document.querySelectorAll(s)).map(function (e) {
      var r = e.getBoundingClientRect();
      return e.tagName.toLowerCase() + ' name=' + (e.name || '') + ' type=' + (e.type || '') +
        ' box=' + Math.round(r.x) + ',' + Math.round(r.y) + ',' + Math.round(r.width) + 'x' + Math.round(r.height) +
        ' vis=' + (r.width > 0 && r.height > 0);
    });
  }
  return {
    forms: Array.from(document.querySelectorAll('form')).map(function (f) {
      return f.getAttribute('action') + ' recaptcha2=' + f.getAttribute('data-recaptcha2');
    }),
    inputs: sel('input'),
    recaptchaDivs: sel('.g-recaptcha'),
    iframes: sel('iframe'),
    bodyText: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 400),
  };
})()`);
console.log(JSON.stringify(info, null, 2));

console.log('frames:', page.frames().map((f) => f.url().slice(0, 90)));

await page.screenshot({ path: path.join(outDir, 'login.png'), fullPage: true });
writeFileSync(path.join(outDir, 'page.html'), await page.content(), 'utf8');

await page.waitForTimeout(20_000);
await browser.close();
