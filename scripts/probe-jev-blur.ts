// Đo độ bền của JEV theo độ rõ ảnh: cùng một lưới, cùng một đề, chỉ đổi độ mờ.
// Chạy: npx tsx scripts/probe-jev-blur.ts [url]

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { chromium, type Frame, type Page } from 'playwright';
import { solveGridWithJev } from '../agent/jev-solve.js';
import { cleanInstruction } from '../agent/jev-decide.js';
import { requireApiKey } from '../agent/config.js';
import { loadDotEnv } from '../agent/env.js';

loadDotEnv();

const url = process.argv[2] ?? 'http://127.0.0.1:3400/';
const OUT = path.join('runs', 'probe-jev-blur');
mkdirSync(OUT, { recursive: true });

const sleep = (ms: number): Promise<void> => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
};

const frameWith = (page: Page, part: string): Frame | null => {
  const alive = page.frames().filter((f) => f.url().includes(part) && !f.isDetached());
  return alive[alive.length - 1] ?? null;
};

/** Ảnh gửi API: JPEG 280–1024, hệ số phóng/thu truyền vào để giữ đúng cỡ. */
async function encode(buf: Buffer, scale = 1): Promise<string> {
  const meta = await sharp(buf).metadata();
  const long = Math.max(meta.width ?? 0, meta.height ?? 0);
  const fit = (long > 1024 ? 1024 / long : long < 280 ? 280 / long : 1) * scale;
  const img = sharp(buf).resize(Math.round((meta.width ?? 0) * fit), Math.round((meta.height ?? 0) * fit), { fit: 'fill' });
  return (await img.jpeg({ quality: 88 }).toBuffer()).toString('base64');
}

const short = (p: number): string => String(Math.round(p * 100)).padStart(3);

const browser = await chromium.launch({ headless: false, channel: 'chrome' });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
await page.waitForTimeout(2500);

const cbFrame = frameWith(page, 'anchor');
const cb = await cbFrame?.locator('#recaptcha-anchor').boundingBox();
if (cb) await page.mouse.click(cb.x + 20, cb.y + cb.height / 2);

let challenge: Frame | null = null;
for (let i = 0; i < 40; i += 1) {
  await sleep(400);
  challenge = frameWith(page, 'api2/bframe');
  if (challenge && (await challenge.locator('#rc-imageselect').isVisible().catch(() => false))) break;
}
if (!challenge) throw new Error('không mở được challenge');

const instruction = cleanInstruction(
  await challenge.locator('.rc-imageselect-instructions').innerText({ timeout: 5_000 }),
).replace(/\s+/g, ' ').trim();
const tableSel = (await challenge.locator('table[class*=rc-imageselect-table]').first().getAttribute('class')) ?? '';
const size = tableSel.match(/table-(\\d)(\\d)/);
const table = challenge.locator('table[class*=rc-imageselect-table]').first();
await sleep(1_800);
const raw = await table.screenshot({ type: 'png' });
await page.close?.();

const meta = await sharp(raw).metadata();
const cols = Number(size?.[2] ?? 3);
const rows = Number(size?.[1] ?? 3);
console.log(`đề: "${instruction}" · lưới đoán ${rows}x${cols} · ảnh ${meta.width}x${meta.height}`);

const variants: Array<[string, Buffer]> = [
  ['gốc', raw],
  ['mờ nhẹ (blur 1.2)', await sharp(raw).blur(1.2).png().toBuffer()],
  ['mờ vừa (blur 2.5)', await sharp(raw).blur(2.5).png().toBuffer()],
  ['mờ nặng (blur 4)', await sharp(raw).blur(4).png().toBuffer()],
  ['thu nhỏ 50%', await sharp(raw).resize(Math.round((meta.width ?? 0) / 2)).png().toBuffer()],
  ['phóng lên 1024', await sharp(raw).resize(1024, 1024, { fit: 'fill' }).png().toBuffer()],
  ['jpeg q60', await sharp(raw).jpeg({ quality: 60 }).png().toBuffer()],
];

for (const [label, buf] of variants) {
  const imageBase64 = await encode(buf);
  const d = await solveGridWithJev({
    apiKey: requireApiKey(),
    imageBase64,
    cols,
    rows,
    threshold: 0.5,
    instruction: `Image grid ${rows}x${cols}. Task: "${instruction}". Answer whether each tile contains it.`,
  });
  const probs = Array.from({ length: rows * cols }, (_, i) => d.probabilities[`tile_${i}`] ?? 0);
  const picked = probs.filter((p) => p >= 0.5).length;
  const sorted = [...probs].sort((a, b) => b - a);
  console.log(
    `${label.padEnd(20)} chọn ${String(picked).padStart(2)} ô · cao nhất ${short(sorted[0] ?? 0)} · ` +
      `cao thứ 2 ${short(sorted[1] ?? 0)} · ${d.latencyMs}ms · $${(d.costUsd ?? 0).toFixed(6)}`,
  );
  console.log(`   ${probs.map(short).join(' ')}`);
}

await browser.close();
