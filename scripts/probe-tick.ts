// Tick có mất khi Google swap? Click lại lên ô đang tick thì bật hay tắt?
// Chạy: node --import tsx scripts/probe-tick.ts

import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import sharp from 'sharp';

const browser = await chromium.launch({ headless: false, channel: 'chrome' });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
await page.goto('http://127.0.0.1:3400/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
await page.frameLocator('iframe[src*="api2/anchor"]').locator('#recaptcha-anchor').click();
await page.waitForTimeout(2500);

const frame = page.frames().find((f) => f.url().includes('api2/bframe'));
if (!frame) throw new Error('không có bframe');
const table = frame.locator('table.rc-imageselect-table-33, table.rc-imageselect-table-44').first();
const box = await table.boundingBox();
const cells = table.locator('td');
const n = await cells.count();
const cols = await table.locator('tr').first().locator('td').count();
const rows = Math.round(n / cols);
console.log(`lưới ${cols}x${rows}, ô=${n}`);

const selCount = async (): Promise<number> =>
  frame.evaluate(
    () => Array.from(document.querySelectorAll('td.rc-imageselect-tile')).filter((td) => td.className.includes('selected')).length,
  );

const cellHash = async (index: number): Promise<string> => {
  const buf = await table.screenshot({ type: 'png', timeout: 2500 });
  const meta = await sharp(buf).metadata();
  const w = Math.floor((meta.width ?? 0) / cols);
  const h = Math.floor((meta.height ?? 0) / rows);
  const crop = await sharp(buf)
    .extract({
      left: (index % cols) * w + Math.floor(w * 0.28),
      top: Math.floor(index / cols) * h + Math.floor(h * 0.28),
      width: Math.max(1, Math.floor(w * 0.44)),
      height: Math.max(1, Math.floor(h * 0.44)),
    })
    .resize(32, 32)
    .raw()
    .toBuffer();
  return createHash('sha256').update(crop).digest('hex').slice(0, 12);
};

const clickCell = async (index: number): Promise<void> => {
  const b = await cells.nth(index).boundingBox();
  if (!b) return;
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
};

console.log('selected ban đầu:', await selCount(), 'hash ô 3:', await cellHash(3));
await clickCell(3);
for (const ms of [300, 700, 1500, 3000, 5000]) {
  await page.waitForTimeout(ms === 300 ? 300 : 500);
  console.log(`+${ms}ms selected=${await selCount()} hash ô 3=${await cellHash(3)}`);
}

console.log('\n--- click LẦN HAI lên cùng ô 3 ---');
await clickCell(3);
for (const ms of [200, 500, 1000]) {
  await page.waitForTimeout(ms);
  console.log(`+${ms}ms selected=${await selCount()} hash ô 3=${await cellHash(3)}`);
}

await browser.close();
