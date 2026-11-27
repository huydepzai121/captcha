// language: TypeScript, file: scripts/smoke-select.ts, runtime: Node 22
// Tìm class CSS mà reCAPTCHA dùng để đánh dấu ô đã chọn.
//
// Cách làm: mở challenge, dump class của mọi td, click một ô, dump lại.
// Class nào MỚI XUẤT HIỆN sau khi click chính là class "đã chọn".

import { readFileSync } from 'node:fs';
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

const TABLE_SELECTORS =
  'table.rc-imageselect-table-33, table.rc-imageselect-table-44, table.rc-imageselect-table-42';

const dumpClasses = async (page: import('playwright').Page, label: string): Promise<string[]> => {
  const classes = await page.evaluate(() => {
    const frame = document.querySelector('iframe[src*="api2/bframe"]') as HTMLIFrameElement | null;
    const doc = frame?.contentDocument;
    if (!doc) return [];
    const tds = Array.from(doc.querySelectorAll('td'));
    return tds.map((td) => td.className);
  });
  console.log(`\n${label}:`);
  for (const [i, c] of classes.entries()) console.log(`  td[${i}]: "${c}"`);
  return classes;
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
await page.goto(DEMO_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });

const anchor = page.frameLocator(ANCHOR_FRAME).locator('#recaptcha-anchor');
await anchor.waitFor({ state: 'visible', timeout: 15_000 });
await anchor.click({ timeout: 10_000 });
await sleep(2500);

const bframe = page.frameLocator(CHALLENGE_FRAME);
await bframe.locator('#rc-imageselect').waitFor({ state: 'visible', timeout: 20_000 });
await sleep(2500);

const instruction = (await bframe.locator('.rc-imageselect-instructions').innerText())
  .replace(/\s+/g, ' ')
  .trim();
console.log(`đề: ${instruction}`);

const before = await dumpClasses(page, 'TRƯỚC khi click');

// Click ô 0
const table = bframe.locator(TABLE_SELECTORS).first();
const cell = table.locator('td').nth(0);
const box = await cell.boundingBox();
if (!box) throw new Error('không lấy được boundingBox ô 0');
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
console.log('\nđã click ô 0');
await sleep(1200);

const after = await dumpClasses(page, 'SAU khi click ô 0');

console.log('\n=== class MỚI XUẤT HIỆN sau khi click ===');
const beforeSet = new Set(before.flatMap((c) => c.split(/\s+/).filter(Boolean)));
const afterSet = new Set(after.flatMap((c) => c.split(/\s+/).filter(Boolean)));
for (const c of afterSet) {
  if (!beforeSet.has(c)) console.log(`  + ${c}`);
}

// Click lần hai để xem class có mất đi (bỏ chọn) không
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
console.log('\nđã click ô 0 lần hai');
await sleep(1200);
await dumpClasses(page, 'SAU khi click lần hai (bỏ chọn)');

await browser.close();
