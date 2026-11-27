// language: TypeScript, file: scripts/smoke-grid.ts, runtime: Node 22
// Chẩn đoán: các ô "biến dạng" trong ảnh chụp là ảnh thật của Google,
// hay do chụp trúng lúc ảnh đang fade?
//
// Cách kiểm: chụp cùng một lưới nhiều lần, cách nhau 2 giây, so hash.
//   - Hash khác nhau → ảnh đang đổi → chụp trúng animation (lỗi của mình)
//   - Hash giống nhau → ảnh đứng yên → nội dung thật của Google

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { ANCHOR_FRAME, CHALLENGE_FRAME, DEMO_URL } from '../agent/config.js';

const sleep = (ms: number): Promise<void> => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
};

for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
  if (match?.[1] && !(match[1] in process.env)) {
    process.env[match[1]] = match[2]!.replace(/^["']|["']$/g, '');
  }
}

mkdirSync('runs', { recursive: true });

const TABLE_SELECTORS =
  'table.rc-imageselect-table-33, table.rc-imageselect-table-44, table.rc-imageselect-table-42';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
await page.goto(DEMO_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });

const anchor = page.frameLocator(ANCHOR_FRAME).locator('#recaptcha-anchor');
await anchor.waitFor({ state: 'visible', timeout: 15_000 });
await anchor.click({ timeout: 10_000 });
await sleep(3000);

const bframe = page.frameLocator(CHALLENGE_FRAME);
await bframe.locator('#rc-imageselect').waitFor({ state: 'visible', timeout: 20_000 });
await sleep(3000);

const instruction = (await bframe.locator('.rc-imageselect-instructions').innerText())
  .replace(/\s+/g, ' ')
  .trim();
console.log(`đề: ${instruction}\n`);

const table = bframe.locator(TABLE_SELECTORS).first();

console.log('chụp 6 lần, cách nhau 2s:');
const hashes: string[] = [];

for (let i = 1; i <= 6; i += 1) {
  const buf: Buffer = await table.screenshot({ type: 'png' });
  const hash = createHash('sha256').update(buf).digest('hex').slice(0, 12);
  hashes.push(hash);
  writeFileSync(`runs/seq-${i}.png`, buf);
  console.log(`  lần ${i}: ${hash}  (${buf.length} bytes)`);
  if (i < 6) await sleep(2000);
}

const unique = new Set(hashes);
console.log(`\n${unique.size} hash khác nhau trên 6 lần chụp`);
console.log(
  unique.size === 1
    ? '→ ảnh ĐỨNG YÊN: nội dung là thật của Google, không phải lỗi timing'
    : '→ ảnh ĐANG ĐỔI: chụp trúng animation — cần chờ thêm',
);

// Kiểm tra từng ô có src hợp lệ và đã load chưa
const tileState = await page.evaluate(() => {
  const frame = document.querySelector('iframe[src*="api2/bframe"]') as HTMLIFrameElement | null;
  const doc = frame?.contentDocument;
  if (!doc) return [];
  const imgs = Array.from(doc.querySelectorAll('img[class*="rc-image-tile"]')) as HTMLImageElement[];
  return imgs.map((img, i) => ({
    i,
    complete: img.complete,
    natural: `${img.naturalWidth}x${img.naturalHeight}`,
    srcLen: img.src.length,
  }));
});

console.log('\ntrạng thái từng img:');
for (const t of tileState) {
  console.log(`  ô ${t.i}: complete=${t.complete} natural=${t.natural} srcLen=${t.srcLen}`);
}

await browser.close();
