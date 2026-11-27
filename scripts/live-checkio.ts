// Chạy agent trên trang chấm công thật của vinades.vn.
//
// Trang checkio đẩy sang SSO (iportal.vn), form đăng nhập ở đó không dựng
// reCAPTCHA sẵn: widget chỉ hiện trong modal SAU khi bấm "Đăng nhập"
// (site.js → reCaptcha2Execute). Vì vậy phải điền form + bấm nút trước khi
// agent tìm anchor, và đọc thông báo sau khi Google trả token.
//
// Chạy: npx tsx scripts/live-checkio.ts [--headful] [--slowmo 120]

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright';
import { runAgent } from '../agent/demo-agent.js';
import { requireApiKey } from '../agent/config.js';
import { loadDotEnv } from '../agent/env.js';

loadDotEnv();

const TARGET = 'https://vinades.vn/vi/timekeeping/checkio/';
const OUT = path.join('runs', 'live-checkio');
mkdirSync(OUT, { recursive: true });

const args = process.argv.slice(2);
const get = (f: string): string | undefined => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};
const sleep = (ms: number): Promise<void> => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
};

// Tài khoản: lấy từ --user/--pass, không có thì nhập bừa (đúng định dạng,
// chắc chắn không tồn tại) để đo riêng phần captcha.
const login = get('--user') ?? `nguoithu${Math.random().toString(36).slice(2, 8)}@example.com`;
const password = get('--pass') ?? `SaiMatKhau${Math.floor(Math.random() * 9000 + 1000)}`;

const log = (m: string): void => console.log(`  ${m}`);

const shot = async (page: Page, name: string): Promise<void> => {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true }).catch(() => {});
};

/** Điền tài khoản bừa rồi bấm Đăng nhập — thao tác thật để site bung modal captcha. */
async function fillAndSubmit(page: Page): Promise<void> {
  const user = page.locator('input[name="nv_login"]').first();
  const pass = page.locator('input[name="nv_password"]').first();
  await user.waitFor({ state: 'visible', timeout: 60_000 });

  await user.click();
  await user.pressSequentially(login, { delay: 45 });
  await sleep(180);
  await pass.click();
  await pass.pressSequentially(password, { delay: 40 });
  await sleep(250);
  await shot(page, '01-da-dien');

  log(`điền tài khoản: ${login} / ${password}`);
  await page.locator('form[data-recaptcha2] button.bsubmit').first().click();
  log('đã bấm Đăng nhập → chờ modal reCAPTCHA');

  // Modal chỉ dựng sau cú bấm; anchor nằm trong iframe nên chờ ở tầng trang.
  await page.waitForTimeout(2_500);
  await shot(page, '02-sau-khi-bam');
}

/** Google trả token thì site tự submit form — đọc xem server nói gì. */
async function readVerdict(page: Page, passed: boolean): Promise<void> {
  log(`captcha ${passed ? 'ĐÃ QUA' : 'CHƯA QUA'} — chờ phản hồi của server`);
  const startUrl = page.url();
  const deadline = Date.now() + 30_000;
  let movedAway = false;
  let message = '';

  while (Date.now() < deadline) {
    const url = page.url();
    const body = await page.evaluate('document.body ? document.body.innerText : ""').catch(() => '');
    const text = String(body).replace(/\s+/g, ' ');

    // Đăng nhập xong thì SSO đẩy ngược về vinades.vn — chính là đích ban đầu.
    if (url.includes('vinades.vn') && !url.includes('iportal.vn')) {
      movedAway = true;
      break;
    }
    const said = text.match(/(Không tìm thấy tài khoản|Tên đăng nhập hoặc mật khẩu không đúng|Mật khẩu[^.]{0,60}|Tài khoản[^.]{0,60})/i)?.[0];
    if (said) {
      message = said;
      break;
    }
    await sleep(400);
  }

  await page.waitForTimeout(2_000);
  await shot(page, '03-ket-qua');

  const body = String(await page.evaluate('document.body ? document.body.innerText : ""').catch(() => ''))
    .replace(/\s+/g, ' ')
    .trim();
  log(`trang kết quả: ${page.url()}`);
  if (message) log(`server trả: "${message}"`);
  log(`chữ trên trang: ${body.slice(0, 220)}`);

  if (movedAway) {
    log('ĐĂNG NHẬP THÀNH CÔNG — đã về trang chấm công');
    if (/chấm công|vào ca|ra ca|check ?in|check ?out/i.test(body)) {
      log(`trang có nút chấm công: ${body.match(/[^.]{0,60}(chấm công|vào ca|ra ca)[^.]{0,40}/i)?.[0] ?? ''}`);
    }
  }

  await page.waitForTimeout(60_000).catch(() => {});
}

const result = await runAgent({
  apiKey: requireApiKey(),
  headless: !args.includes('--headful'),
  keepOpen: true,
  slowMo: Number.parseInt(get('--slowmo') ?? '120', 10),
  targetUrl: TARGET,
  profile: 'checkio',
  ...(args.includes('--firefox') ? { browser: 'firefox' as const } : {}),
  threshold: 0.5,
  beforeSolve: fillAndSubmit,
  afterSolve: readVerdict,
  onLog: log,
});

console.log('');
console.log(`  captcha: ${result.passed ? 'PASS' : 'FAIL'} · ${result.attempts} challenge · $${result.costUsd.toFixed(5)}`);
console.log(`  lý do:   ${result.reason}`);
console.log(`  ảnh:     ${OUT}`);
process.exitCode = result.passed ? 0 : 1;  // keepOpen: cửa sổ ở lại cho người xem
