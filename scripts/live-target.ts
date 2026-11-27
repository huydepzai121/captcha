// Chạy agent trên một trang đăng nhập thật bất kỳ: mở trang, (tuỳ chọn) điền
// tài khoản, tick/solve captcha, đọc chữ trên trang sau khi Google trả token.
//
// Chạy: npx tsx scripts/live-target.ts "<url>" [--user U --pass P] [--headful] [--slowmo N]

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright';
import { runAgent } from '../agent/demo-agent.js';
import { requireApiKey } from '../agent/config.js';
import { loadDotEnv } from '../agent/env.js';

loadDotEnv();

const args = process.argv.slice(2);
const get = (f: string): string | undefined => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};
const target = args[0];
if (!target || target.startsWith('--')) throw new Error('thiếu url đích');

const OUT = path.join('runs', 'live-target');
mkdirSync(OUT, { recursive: true });
const log = (m: string): void => console.log(`  ${m}`);
const sleep = (ms: number): Promise<void> => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
};

const user = get('--user');
const pass = get('--pass');

async function fillForm(page: Page): Promise<void> {
  const u = page.locator('input[name="nv_login"], #username, input[name="username"]').first();
  await u.waitFor({ state: 'visible', timeout: 30_000 });
  await u.click();
  await u.pressSequentially(user!, { delay: 45 });
  const p = page.locator('input[name="nv_password"], #password, input[name="password"]').first();
  await p.click();
  await p.pressSequentially(pass!, { delay: 40 });
  log(`đã điền ${user}`);
}

async function readPage(page: Page, passed: boolean): Promise<void> {
  log(`captcha ${passed ? 'ĐÃ QUA' : 'CHƯA QUA'} — đọc phản hồi`);
  await page.waitForTimeout(3_000);
  await page.screenshot({ path: path.join(OUT, 'sau-captcha.png'), fullPage: true }).catch(() => {});
  const body = String(await page.evaluate('document.body ? document.body.innerText : ""').catch(() => ''))
    .replace(/\s+/g, ' ')
    .trim();
  log(`url: ${page.url()}`);
  log(`chữ: ${body.slice(0, 260)}`);
  await sleep(90_000);
}

const result = await runAgent({
  apiKey: requireApiKey(),
  headless: !args.includes('--headful'),
  keepOpen: true,
  slowMo: Number.parseInt(get('--slowmo') ?? '120', 10),
  targetUrl: target,
  profile: 'target',
  threshold: 0.5,
  ...(user && pass ? { beforeSolve: fillForm } : {}),
  afterSolve: readPage,
  onLog: log,
});

console.log(`  captcha: ${result.passed ? 'PASS' : 'FAIL'} · ${result.attempts} challenge · ${result.reason}`);
process.exitCode = result.passed ? 0 : 1;
