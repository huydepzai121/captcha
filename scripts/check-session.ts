// Mở lại profile đã đăng nhập và xem trang chấm công thật sự hiện gì.
// Chạy: npx tsx scripts/check-session.ts

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const OUT = path.join('runs', 'live-checkio');
mkdirSync(OUT, { recursive: true });

const context = await chromium.launchPersistentContext(path.join('runs', 'pw-profile-chrome-checkio'), {
  headless: false,
  channel: 'chrome',
  args: ['--disable-blink-features=AutomationControlled'],
  viewport: { width: 1280, height: 800 },
});
const page = context.pages()[0] ?? (await context.newPage());

const bodyText = async (): Promise<string> =>
  String(await page.evaluate('document.body ? document.body.innerText : ""').catch(() => ''))
    .replace(/\s+/g, ' ')
    .trim();

await page.goto('https://vinades.vn/vi/timekeeping/checkio/', { waitUntil: 'domcontentloaded', timeout: 60_000 });
await page.waitForTimeout(8_000);

console.log(`URL: ${page.url()}`);
console.log(`title: ${await page.title()}`);
console.log(`chữ: ${(await bodyText()).slice(0, 400)}`);
await page.screenshot({ path: path.join(OUT, '04-checkio-sau-dang-nhap.png'), fullPage: true }).catch(() => {});
