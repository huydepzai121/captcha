// Chẩn đoán hCaptcha: hình học canvas, prompt, và tín hiệu sau khi nộp SAI.
// Chạy: npx tsx scripts/probe-hcaptcha.ts [url]

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { chromium, type Frame, type Page } from 'playwright';

const url = process.argv[2] ?? 'http://127.0.0.1:3400/hcaptcha';
const OUT = path.join('runs', 'probe-hcaptcha');
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

const browser = await chromium.launch({ headless: false, channel: 'chrome' });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
await page.waitForTimeout(2500);

const checkbox = frameWith(page, 'frame=checkbox');
if (!checkbox) throw new Error('không thấy checkbox frame');
const cb = await checkbox.locator('#checkbox').boundingBox();
if (cb) await page.mouse.click(cb.x + cb.width / 2, cb.y + cb.height / 2);
console.log('đã tick checkbox');

let challenge: Frame | null = null;
for (let i = 0; i < 40; i += 1) {
  await sleep(300);
  challenge = frameWith(page, 'frame=challenge');
  if (challenge && (await challenge.locator('.challenge-view canvas').isVisible().catch(() => false))) break;
}
if (!challenge) throw new Error('không có challenge');

const dump = async (label: string): Promise<void> => {
  const info = await challenge!.evaluate(`(() => {
    const c = document.querySelector('.challenge-view canvas');
    const view = document.querySelector('.challenge-view');
    const err = document.querySelector('.error-text');
    const r = c ? c.getBoundingClientRect() : null;
    const cs = c ? getComputedStyle(c) : null;
    const es = err ? getComputedStyle(err) : null;
    return {
      prompt: (document.querySelector('.prompt-text') || {}).textContent || '',
      canvasAttr: c ? [c.width, c.height] : null,
      canvasCss: cs ? [cs.width, cs.height, cs.style] : null,
      canvasBox: r ? [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] : null,
      viewBox: view ? JSON.stringify(view.getBoundingClientRect()) : null,
      viewPad: view ? getComputedStyle(view).padding : null,
      errText: err ? JSON.stringify(err.textContent) : null,
      errDisplay: es ? [es.display, es.visibility, es.opacity] : null,
      errBox: err ? JSON.stringify(err.getBoundingClientRect()) : null,
      submit: (document.querySelector('.button-submit') || {}).textContent || '',
      submits: document.querySelectorAll('.button-submit').length,
    };
  })()`);
  console.log(`\n[${label}]`, JSON.stringify(info, null, 1));
  await page.screenshot({ path: path.join(OUT, `${label}.png`) });
};

await dump('01-truoc-khi-nop');

// Nộp rỗng để chắc chắn bị chấm sai, rồi xem trang đổi gì.
const submit = challenge.locator('.button-submit').first();
const sb = await submit.boundingBox();
if (sb) await page.mouse.click(sb.x + sb.width / 2, sb.y + sb.height / 2);
console.log('đã nộp rỗng');

await sleep(2500);
await dump('02-sau-khi-nop-sai');
await sleep(2500);
await dump('03-them-2s');

const checked = await frameWith(page, 'frame=checkbox')
  ?.locator('#checkbox')
  .getAttribute('aria-checked')
  .catch(() => null);
console.log('aria-checked:', checked);
console.log('canvas ảnh:', JSON.stringify(await sharp(await challenge.locator('.challenge-view canvas').first().screenshot())
  .metadata()
  .then((m) => [m.width, m.height])
  .catch(() => null)));

await sleep(1500);
await browser.close();
