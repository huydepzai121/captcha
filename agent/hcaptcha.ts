// language: TypeScript, file: agent/hcaptcha.ts, runtime: Node 22
// Flow hCaptcha. Khác reCAPTCHA ở chỗ load-bearing:
//   - lưới vẽ trên MỘT <canvas>, không có DOM từng ô → click bằng toạ độ,
//     không đọc được tick từ DOM, không chụp từng ô.
//   - prompt là chữ tự do trong `.prompt-text` ("Click the THREE matching shapes"),
//     không phải câu "Select all images with X" cố định.
//   - nút gửi là `.button-submit`; sai thì `.error-text` hiện "Please try again".
//
// JEV vẫn là bên quyết định: gửi ảnh canvas + một câu noul mỗi ô.

import sharp from 'sharp';
import type { Frame, Page } from 'playwright';
import { solveGridWithJev } from './jev-solve.js';
import { cleanInstruction } from './jev-decide.js';

export interface HCaptchaOptions {
  apiKey: string;
  threshold?: number;
  jevModel?: string;
  maxAttempts?: number;
  budgetMs?: number;
  onLog: (msg: string) => void;
  onCost: (usd: number) => void;
  onJev: (latencyMs: number) => void;
}

export interface HCaptchaResult {
  passed: boolean;
  attempts: number;
  reason: string;
  clicks: number[][];
}

const CHECKBOX = 'frame=checkbox';
const CHALLENGE = 'frame=challenge';

const sleep = (ms: number): Promise<void> => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
};

/** Di chuột nhiều chặng rồi mới nhấn — hCaptcha cũng chấm quỹ đạo. */
let last = { x: 640, y: 400 };
async function humanClick(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.move(last.x, last.y, { steps: 2 });
  await page.mouse.move(x, y, { steps: 6 + Math.floor(Math.random() * 5) });
  last = { x, y };
  await sleep(40 + Math.random() * 70);
  await page.mouse.down();
  await sleep(30 + Math.random() * 50);
  await page.mouse.up();
}

// Frame bị thay mỗi challenge nên bỏ frame đã detach, lấy cái mới nhất.
const frameWith = (page: Page, part: string): Frame | null => {
  const alive = page.frames().filter((f) => f.url().includes(part) && !f.isDetached());
  return alive[alive.length - 1] ?? null;
};

/** hCaptcha ghi token vào textarea trong trang cha — dấu hiệu đã giải xong. */
const hasToken = async (page: Page): Promise<boolean> => {
  const value = await page
    .locator('textarea[name="h-captcha-response"], textarea[name="g-recaptcha-response"]')
    .first()
    .inputValue({ timeout: 500 })
    .catch(() => '');
  return value.trim().length > 0;
};

const visible = async (frame: Frame | null, selector: string): Promise<boolean> =>
  frame ? await frame.locator(selector).first().isVisible().catch(() => false) : false;

/** Ảnh canvas → JPEG base64 trong khung 280–1024px mà API ảnh chấp nhận. */
async function canvasBase64(buf: Buffer): Promise<string> {
  const meta = await sharp(buf).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const longest = Math.max(width, height);
  const factor = longest > 1024 ? 1024 / longest : longest < 280 ? 280 / longest : 1;
  return (
    await sharp(buf)
      .resize(Math.round(width * factor), Math.round(height * factor), { fit: 'fill' })
      .jpeg({ quality: 88 })
      .toBuffer()
  ).toString('base64');
}

/** Đọc prompt; hCaptcha hay đổi chữ nên chỉ lấy phần hướng dẫn. */
async function readPrompt(frame: Frame): Promise<string> {
  const text = await frame.locator('.prompt-text').first().innerText({ timeout: 5_000 }).catch(() => '');
  return cleanInstruction(text).replace(/\s+/g, ' ').trim();
}

/**
 * Chờ trạng thái sau khi bấm gửi.
 *
 * Không dùng `.error-text` làm dấu hiệu sai: nó nằm sẵn trong DOM và hiện từ
 * trước khi gửi, nên đọc nó lúc nào cũng thấy "Please try again". Chỉ tin hai
 * tín hiệu thật: checkbox được tick, hoặc challenge bị thay/tháo.
 */
async function waitVerdict(
  page: Page,
  checkbox: Frame | null,
  challenge: Frame | null,
  previousPrompt: string,
): Promise<'solved' | 'wrong' | 'next' | 'timeout'> {
  const deadline = Date.now() + 6_000;
  while (Date.now() < deadline) {
    if (checkbox) {
      const checked = await checkbox
        .locator('#checkbox')
        .getAttribute('aria-checked')
        .catch(() => null);
      if (checked === 'true' || (await hasToken(page))) return 'solved';
    }
    if (!challenge || challenge.isDetached()) return 'solved';
    if (!(await visible(challenge, '.challenge-view canvas'))) return 'solved';
    const current = await readPrompt(challenge).catch(() => '');
    if (current.length > 0 && current !== previousPrompt) return 'next';
    await sleep(200);
  }
  return 'timeout';
}

const COUNT_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

/** Đề hCaptcha hay nói rõ số ô ("click the THREE matching shapes", "click the icon"). */
const wantedCount = (prompt: string): number | null => {
  const word = prompt.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/i)?.[1];
  if (word) return COUNT_WORDS[word.toLowerCase()] ?? null;
  const digit = prompt.match(/\b(\d{1,2})\b/);
  return digit ? Number.parseInt(digit[1] ?? '', 10) : null;
};

/**
 * Chạy trọn một phiên hCaptcha: tick checkbox rồi giải từng challenge.
 * Trả về ngay khi checkbox được tick hoặc hết lượt/ngân sách.
 */
export async function solveHCaptcha(page: Page, opts: HCaptchaOptions): Promise<HCaptchaResult> {
  const budget = opts.budgetMs ?? 180_000;
  const maxAttempts = opts.maxAttempts ?? 20;
  const clicks: number[][] = [];
  const t0 = Date.now();

  await page.waitForTimeout(1_200);
  let checkbox = frameWith(page, CHECKBOX);
  if (!checkbox) throw new Error('không thấy khung hCaptcha');

  const box = await checkbox.locator('#checkbox').boundingBox().catch(() => null);
  if (!box) throw new Error('không lấy được checkbox hCaptcha');
  await humanClick(page, box.x + box.width / 2, box.y + box.height / 2);
  opts.onLog('đã tick "I am human"');

  let attempts = 0;
  let lastPrompt = '';

  while (Date.now() - t0 < budget && attempts < maxAttempts) {
    checkbox = frameWith(page, CHECKBOX);

    const checked = await checkbox
      ?.locator('#checkbox')
      .getAttribute('aria-checked')
      .catch(() => null);
    if (checked === 'true') return { passed: true, attempts, reason: 'hCaptcha đã xác nhận', clicks };

    // Chờ canvas tối đa 10s mà KHÔNG tính lượt: hCaptcha cần vài giây mới vẽ.
    // Trước đây tăng lượt mỗi vòng nên 5 lượt cháy hết trong 4 giây vô ích.
    const waitUntil = Date.now() + 10_000;
    let challenge = frameWith(page, CHALLENGE);
    while (Date.now() < waitUntil && !(await visible(challenge, '.challenge-view canvas'))) {
      await sleep(300);
      challenge = frameWith(page, CHALLENGE);
      const nowChecked = await frameWith(page, CHECKBOX)
        ?.locator('#checkbox')
        .getAttribute('aria-checked')
        .catch(() => null);
      if (nowChecked === 'true' || (await hasToken(page))) {
        return { passed: true, attempts, reason: 'hCaptcha đã xác nhận', clicks };
      }
    }
    if (!(await visible(challenge, '.challenge-view canvas'))) {
      return { passed: false, attempts, reason: 'không có challenge nào mở ra', clicks };
    }
    attempts += 1;
    const frame: Frame = challenge!;

    const prompt = await readPrompt(frame);
    if (!prompt) {
      await sleep(400);
      continue;
    }
    lastPrompt = prompt;
    opts.onLog(`── challenge #${attempts} · "${prompt}"`);

    const canvas = frame.locator('.challenge-view canvas').first();
    const grid = await canvas.boundingBox();
    if (!grid) throw new Error('không lấy được khung lưới hCaptcha');

    // hCaptcha vẽ lưới đều; ô ~166x156. Suy số cột/hàng rồi kẹp 2..4.
    const cols = Math.min(4, Math.max(2, Math.round(grid.width / 166)));
    const rows = Math.min(4, Math.max(2, Math.round(grid.height / 156)));
    const cellW = grid.width / cols;
    const cellH = grid.height / rows;

    const shot = await canvas.screenshot({ type: 'png', timeout: 4_000 });
    const decision = await solveGridWithJev({
      apiKey: opts.apiKey,
      imageBase64: await canvasBase64(shot),
      cols,
      rows,
      instruction:
        `Image grid ${rows}x${cols}. Task: "${prompt}". ` +
        'Answer whether each numbered tile is one the task asks to click.',
      ...(opts.threshold === undefined ? {} : { threshold: opts.threshold }),
      ...(opts.jevModel ? { model: opts.jevModel } : {}),
    });
    opts.onJev(decision.latencyMs);
    opts.onCost(decision.costUsd ?? 0);
    opts.onLog(`   JEV ${decision.latencyMs}ms → ${decision.tiles.length} ô [${decision.tiles.join(',')}]`);

    const picked: number[] = [];
    // Đề nói rõ số ô thì cắt về đúng số đó, giữ ô có xác suất cao nhất.
    const want = wantedCount(prompt);
    const ordered =
      want === null
        ? decision.tiles
        : [...decision.tiles]
            .sort((a, b) => (decision.probabilities[`tile_${b}`] ?? 0) - (decision.probabilities[`tile_${a}`] ?? 0))
            .slice(0, want)
            .sort((a, b) => a - b);

    for (const tile of ordered) {
      if (tile < 0 || tile >= cols * rows) continue;
      const col = tile % cols;
      const row = Math.floor(tile / cols);
      const x = grid.x + (col + 0.5) * cellW + (Math.random() - 0.5) * Math.min(6, cellW * 0.15);
      const y = grid.y + (row + 0.5) * cellH + (Math.random() - 0.5) * Math.min(6, cellH * 0.15);
      await humanClick(page, x, y);
      picked.push(tile);
      await sleep(120 + Math.random() * 120);
    }
    clicks.push(picked);
    await sleep(400);

    const submit = frame.locator('.button-submit').first();
    const sb = await submit.boundingBox().catch(() => null);
    if (sb) await humanClick(page, sb.x + sb.width / 2, sb.y + sb.height / 2);
    else await humanClick(page, grid.x + grid.width / 2, grid.y + grid.height + 30).catch(() => {});
    opts.onLog('   đã gửi');

    const verdict = await waitVerdict(page, checkbox, challenge, lastPrompt);
    if (verdict === 'solved') {
      return { passed: true, attempts, reason: `hCaptcha xác nhận sau ${attempts} challenge`, clicks };
    }
    opts.onLog(verdict === 'wrong' ? '   hCaptcha chấm SAI' : `   ${verdict === 'next' ? 'challenge mới' : 'không rõ kết quả'}`);
    await sleep(600);
  }

  return {
    passed: false,
    attempts,
    reason: `hết ${maxAttempts} lượt hoặc hết ngân sách`,
    clicks,
  };
}
