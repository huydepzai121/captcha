// Chẩn đoán: vì sao trang thật không mở challenge sau khi tick anchor.
// In kích thước iframe, thử click bằng chuột thật, đọc nội dung bframe.
// Chạy: node --import tsx scripts/probe-target.ts "<url>"

import { chromium } from 'playwright';

const url = process.argv[2];
if (!url) throw new Error('thiếu url');

const browser = await chromium.launch({ headless: false, channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });

const report = async (label: string): Promise<void> => {
  const boxes = await page.evaluate(() =>
    Array.from(document.querySelectorAll('iframe')).map((f) => {
      const r = f.getBoundingClientRect();
      return { src: f.src.slice(0, 60), w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) };
    }),
  );
  const bframe = page.frames().find((f) => f.url().includes('bframe'));
  const panel = bframe ? await bframe.locator('#rc-imageselect').count().catch(() => -1) : -1;
  const visible = bframe ? await bframe.locator('#rc-imageselect').isVisible().catch(() => false) : false;
  const text = bframe ? await bframe.locator('body').innerText({ timeout: 1500 }).catch(() => '') : '';
  console.log(`\n[${label}] iframes=${JSON.stringify(boxes)} panel=${panel} visible=${visible}`);
  if (text) console.log('  bframe text:', text.replace(/\s+/g, ' ').slice(0, 160));
};

await page.waitForTimeout(1500);
await report('sau khi tải');

const anchorIframe = page.locator('iframe[src*="api2/anchor"]').first();
const box = await anchorIframe.boundingBox().catch(() => null);
console.log('box anchor:', JSON.stringify(box));
const recaptchaBox = await page.locator('.g-recaptcha').boundingBox().catch(() => null);
console.log('box .g-recaptcha:', JSON.stringify(recaptchaBox));

if (recaptchaBox) {
  const x = recaptchaBox.x + 20;
  const y = recaptchaBox.y + recaptchaBox.height / 2;
  console.log(`click chuột tại ${x},${y}`);
  await page.mouse.move(x, y, { steps: 8 });
  await page.mouse.down();
  await page.waitForTimeout(60);
  await page.mouse.up();
}

for (const wait of [1500, 2000, 3000, 5000]) {
  await page.waitForTimeout(wait);
  await report(`sau click +${wait}ms`);
  const checked = await page
    .frameLocator('iframe[src*="api2/anchor"]')
    .locator('#recaptcha-anchor')
    .getAttribute('aria-checked')
    .catch(() => null);
  console.log('  aria-checked=', checked);
  if (checked === 'true') break;
}

await page.waitForTimeout(8000);
await browser.close();
