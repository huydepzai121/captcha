// Kiểm tra click trên canvas hCaptcha có ăn không: chụp trước/sau và so pixel.
// Chạy: node --import tsx scripts/probe-hcaptcha-click.ts

import sharp from 'sharp';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: false, channel: 'chrome' });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
await page.goto('https://accounts.hcaptcha.com/demo', { waitUntil: 'domcontentloaded', timeout: 45_000 });
await page.waitForTimeout(2500);

const cb = page.frames().find((f) => f.url().includes('frame=checkbox'));
const cbBox = await cb!.locator('#checkbox').boundingBox();
await page.mouse.click(cbBox!.x + 15, cbBox!.y + 15);
await page.waitForTimeout(6000);

const frame = page.frames().find((f) => f.url().includes('frame=challenge'));
if (!frame) throw new Error('không có challenge');
const canvas = frame.locator('.challenge-view canvas').first();
const box = await canvas.boundingBox();
console.log('canvas box:', JSON.stringify(box));
console.log('prompt:', await frame.locator('.prompt-text').first().innerText().catch(() => ''));

const shot1 = await canvas.screenshot({ type: 'png' });
const stats = await sharp(shot1).stats();
console.log('ảnh 1: bytes=', shot1.length, 'mean=', stats.channels.map((c) => c.mean.toFixed(1)).join('/'), 'size=', JSON.stringify(await sharp(shot1).metadata().then((m) => [m.width, m.height])));

// Click giữa lưới (tâm ô 4 của 3x3) rồi chụp lại.
const cols = 3;
const rows = 3;
const x = box!.x + ((4 % cols) + 0.5) * (box!.width / cols);
const y = box!.y + (Math.floor(4 / cols) + 0.5) * (box!.height / rows);
console.log('click tại', x.toFixed(0), y.toFixed(0));
await page.mouse.move(x, y, { steps: 6 });
await page.mouse.down();
await page.waitForTimeout(60);
await page.mouse.up();
await page.waitForTimeout(900);

const shot2 = await canvas.screenshot({ type: 'png' });
const diff = await sharp(shot2).raw().toBuffer();
const base = await sharp(shot1).raw().toBuffer();
let changed = 0;
for (let i = 0; i < Math.min(diff.length, base.length); i += 1) if (Math.abs((diff[i] ?? 0) - (base[i] ?? 0)) > 12) changed += 1;
console.log('pixel lệch >12:', changed, '/', diff.length);

console.log('submit visible:', await frame.locator('.button-submit').isVisible().catch(() => false));
console.log('submit box:', JSON.stringify(await frame.locator('.button-submit').boundingBox().catch(() => null)));
console.log('error visible:', await frame.locator('.error-text').isVisible().catch(() => false));

await page.waitForTimeout(1000);
await browser.close();
