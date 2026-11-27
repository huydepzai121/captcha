// language: TypeScript, file: scripts/smoke-vision.ts, runtime: Node 22
// Chẩn đoán tầng vision: bắt ảnh grid thật rồi in RAW response của model.
// Chạy: pnpm exec tsx scripts/smoke-vision.ts

import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { ANCHOR_FRAME, CHALLENGE_FRAME, DEMO_URL, GATEWAY_BASE } from '../agent/config.js';

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

const table = bframe.locator(TABLE_SELECTORS).first();
const instruction = (await bframe.locator('.rc-imageselect-instructions').innerText())
  .replace(/\s+/g, ' ')
  .trim();

const gridInfo = await table.evaluate((t: HTMLTableElement) => {
  const rows = t.querySelectorAll('tr').length;
  const cols = t.querySelector('tr')?.querySelectorAll('td').length ?? 0;
  return { cols, rows };
});

const buf: Buffer = await table.screenshot({ type: 'png' });
writeFileSync('runs/debug-grid.png', buf);

const total = gridInfo.cols * gridInfo.rows;
const prompt = [
  `Bạn nhìn một ảnh lưới ${gridInfo.rows} hàng x ${gridInfo.cols} cột, tổng ${total} ô, đánh số row-major từ 0 đến ${total - 1}.`,
  `Yêu cầu của đề: "${instruction}".`,
  '',
  'Mô tả ngắn gọn nội dung chính của từng ô.',
].join('\n');

console.log('── gọi vision, in RAW ──────────────────────');
const t0 = Date.now();
const res = await fetch(`${GATEWAY_BASE}/v1/chat/completions`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    authorization: `Bearer ${process.env.AI_GATEWAY_API_KEY}`,
  },
  body: JSON.stringify({
    model: 'deepseek/deepseek-v4.1-flash',
    max_tokens: 16_384,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${buf.toString('base64')}` } },
        ],
      },
    ],
  }),
});

const text = await res.text();
console.log(`HTTP ${res.status} · ${Date.now() - t0}ms`);
const json = JSON.parse(text) as {
  choices?: Array<{ message?: { content?: string; reasoning?: string } }>;
  usage?: unknown;
};
const msg = json.choices?.[0]?.message;
console.log('\n=== CONTENT ===');
console.log(JSON.stringify(msg?.content));
console.log('\n=== REASONING (200 ký tự đầu) ===');
console.log((msg?.reasoning ?? '').slice(0, 200));
console.log('\n=== USAGE ===');
console.log(JSON.stringify(json.usage));

await browser.close();
