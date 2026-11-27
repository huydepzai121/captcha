// Runner: mở trang demo reCAPTCHA chính thức của Google
// (https://www.google.com/recaptcha/api2/demo), đi toàn bộ vòng:
// click anchor → nhận challenge grid → gọi solver → click từng ô theo
// toạ độ tâm (cơ chế "click" của harness) → verify → đọc kết quả từ Google.
// Mọi bước phát event về dashboard. Google chấm, mình chỉ click.

import { chromium, type Browser, type Page } from 'playwright';
import type { ClickSolver, SolverOutput } from './solver.js';
import type { RunStatus, SimEvent } from './types.js';

type LogStatus = RunStatus | 'INFO' | 'NET';

const DEMO_URL = 'https://www.google.com/recaptcha/api2/demo';
const ANCHOR_FRAME = 'iframe[src*="api2/anchor"]';
const CHALLENGE_FRAME = 'iframe[src*="api2/bframe"]';
const RUN_BUDGET_MS = 180_000;
const VERIFY_TIMEOUT_MS = 25_000;
const MAX_SOLVER_RETRIES = 2;

class AbortedError extends Error {}

const checkAbort = (signal: AbortSignal): void => {
  if (signal.aborted) throw new AbortedError('run stopped');
};

interface GridInfo {
  cols: number;
  rows: number;
  tableSel: string;
}

interface RunOptions {
  solver: ClickSolver;
  emit: (ev: SimEvent) => void;
  headless: boolean;
  signal: AbortSignal;
}

const sleep = (ms: number, signal: AbortSignal): Promise<void> => {
  const { promise, resolve } = Promise.withResolvers<void>();
  const t = setTimeout(resolve, ms);
  signal.addEventListener(
    'abort',
    () => {
      clearTimeout(t);
      resolve();
    },
    { once: true },
  );
  return promise;
};

// Xác định cấu trúc lưới từ DOM thật: đếm <tr> và <td> hàng đầu.
async function readGridInfo(page: Page): Promise<GridInfo> {
  const tableSel =
    'table.rc-imageselect-table-33, table.rc-imageselect-table-44, table.rc-imageselect-table-42';
  const info = await page
    .frameLocator(CHALLENGE_FRAME)
    .locator(tableSel)
    .first()
    .evaluate((table: HTMLTableElement) => {
      const rows = table.querySelectorAll('tr').length;
      const firstRowCells = table.querySelector('tr')?.querySelectorAll('td').length ?? 0;
      return { cols: firstRowCells, rows };
    });
  if (info.cols < 2 || info.rows < 2 || info.cols > 4 || info.rows > 4) {
    throw new Error(`không đọc được cấu trúc lưới: ${JSON.stringify(info)}`);
  }
  return { ...info, tableSel };
}

export async function runRecaptchaSession(opts: RunOptions): Promise<void> {
  const { solver, emit, headless, signal } = opts;
  const t0 = Date.now();
  let browser: Browser | null = null;
  let challengeCount = 0;

  const log = (status: LogStatus, message: string): void => {
    emit({ type: 'log', status, message, ts: Date.now() });
  };
  const net = (provider: string, host: string, latencyMs: number, usage?: string): void => {
    emit({
      type: 'log',
      status: 'NET',
      message: `${provider} · ${host} · ${latencyMs}ms`,
      ts: Date.now(),
      net: { provider, host, latencyMs, usage },
    });
  };
  const finish = (solved: boolean, reason: string): void => {
    emit({ type: 'result', solved, challenges: challengeCount, reason, durationMs: Date.now() - t0 });
  };

  try {
    log('SPAWNED', `chromium ${headless ? 'headless' : 'headful'} · solver=${solver.name}`);

    browser = await chromium.launch({ headless });
    checkAbort(signal);

    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const loadT0 = Date.now();
    log('FETCHING', `GET ${DEMO_URL}`);
    await page.goto(DEMO_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    net('google', 'www.google.com', Date.now() - loadT0);
    checkAbort(signal);

    // Bước 1: tick checkbox reCAPTCHA trong anchor iframe
    const anchor = page.frameLocator(ANCHOR_FRAME).locator('#recaptcha-anchor');
    await anchor.waitFor({ state: 'visible', timeout: 15_000 });
    await anchor.click({ timeout: 10_000 });
    log('FETCHING', 'anchor clicked — chờ challenge');
    await sleep(600 + Math.random() * 500, signal);
    checkAbort(signal);

    // Risk engine pass thẳng: không có challenge nào xuất hiện
    const checked = await anchor.getAttribute('aria-checked').catch(() => null);
    if (checked === 'true') {
      finish(true, 'Google pass thẳng — không cần challenge');
      return;
    }

    // Bước 2: vòng lặp challenge cho tới khi solved / hết ngân sách
    while (Date.now() - t0 < RUN_BUDGET_MS) {
      checkAbort(signal);
      const bframe = page.frameLocator(CHALLENGE_FRAME);
      await bframe.locator('#rc-imageselect').waitFor({ state: 'visible', timeout: 20_000 });

      // đọc instruction + cấu trúc lưới + ảnh
      const grid = await readGridInfo(page);
      const instruction = (
        await bframe.locator('.rc-imageselect-instructions').innerText({ timeout: 5_000 })
      )
        .replace(/\s+/g, ' ')
        .trim();

      const table = bframe.locator(grid.tableSel).first();
      const shotT0 = Date.now();
      const imageBuf: Buffer = await table.screenshot({ type: 'jpeg', quality: 90 });
      const imageBase64 = imageBuf.toString('base64');
      challengeCount += 1;
      emit({
        type: 'challenge',
        instruction,
        cols: grid.cols,
        rows: grid.rows,
        imageBase64,
        index: challengeCount,
      });
      net('google', 'google.com/recaptcha', Date.now() - shotT0);

      // gọi solver (retry — lỗi mạng không giết cả run)
      let answer: SolverOutput | null = null;
      let lastErr: unknown = null;
      for (let attempt = 0; attempt <= MAX_SOLVER_RETRIES; attempt += 1) {
        checkAbort(signal);
        try {
          log('ANALYZING', `solver ${solver.name} — challenge #${challengeCount}`);
          answer = await solver.solve({
            imageBase64,
            instruction,
            cols: grid.cols,
            rows: grid.rows,
          });
          net(
            'solver',
            solver.name.startsWith('vision') ? 'ai-gateway.vercel.sh' : 'local',
            answer.latencyMs,
            answer.detail.slice(0, 160),
          );
          break;
        } catch (err) {
          lastErr = err;
          log(
            'INFO',
            `solver lỗi (lần ${attempt + 1}): ${err instanceof Error ? err.message : String(err)}`,
          );
          await sleep(1_200, signal);
        }
      }
      if (!answer) {
        throw new Error(
          `solver thất bại sau ${MAX_SOLVER_RETRIES + 1} lần: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
        );
      }

      if (answer.tiles.length === 0) {
        log('INFO', 'solver trả 0 ô — click verify luôn');
      }

      // Bước 3: cơ chế click — tile index → tâm ô tuyệt đối → mouse.click
      log('EXECUTING', `click ${answer.tiles.length} ô [${answer.tiles.join(',')}]`);
      const box = await table.boundingBox();
      if (!box) throw new Error('mất bounding box của grid');
      const cellW = box.width / grid.cols;
      const cellH = box.height / grid.rows;
      for (const tile of answer.tiles) {
        checkAbort(signal);
        const col = tile % grid.cols;
        const row = Math.floor(tile / grid.cols);
        // jitter trong 20% ô — không click dead-center như robot
        const jitterX = (Math.random() - 0.5) * Math.min(12, cellW * 0.2);
        const jitterY = (Math.random() - 0.5) * Math.min(12, cellH * 0.2);
        const x = box.x + (col + 0.5) * cellW + jitterX;
        const y = box.y + (row + 0.5) * cellH + jitterY;
        await sleep(220 + Math.random() * 380, signal);
        await page.mouse.click(x, y);
        emit({ type: 'click', tile, x: Math.round(x), y: Math.round(y) });
      }

      // Bước 4: verify — Google là bên chấm
      checkAbort(signal);
      await sleep(400 + Math.random() * 300, signal);
      const verifyT0 = Date.now();
      log('VERIFYING', 'POST verify → Google chấm');
      await bframe.locator('#recaptcha-verify-button').click({ timeout: 5_000 });

      // Bước 5: đọc kết quả — solved / sai (challenge mới) / hết giờ
      const verdict = await waitForVerdict(page, signal);
      if (verdict === 'solved') {
        net('google', 'google.com/recaptcha/api2/userverify', Date.now() - verifyT0);
        finish(true, `Google xác nhận đúng sau ${challengeCount} challenge`);
        return;
      }
      if (verdict === 'expired') {
        finish(false, 'challenge hết hạn');
        return;
      }
      log('INFO', verdict === 'wrong' ? 'Google chấm SAI — challenge mới' : 'challenge mới xuất hiện');
      await sleep(500, signal);
      // vòng lặp tiếp: challenge tiếp theo trong cùng bframe
    }
    finish(false, 'hết ngân sách thời gian 180s');
  } catch (err) {
    if (err instanceof AbortedError || signal.aborted) {
      finish(false, 'dừng bởi người dùng');
    } else {
      log('FAILED', err instanceof Error ? err.message : String(err));
      finish(false, err instanceof Error ? err.message : String(err));
    }
  } finally {
    await browser?.close().catch(() => {});
  }
}

/** Poll trạng thái sau khi bấm verify: solved / wrong / expired / next. */
async function waitForVerdict(
  page: Page,
  signal: AbortSignal,
): Promise<'solved' | 'wrong' | 'expired' | 'next'> {
  const deadline = Date.now() + VERIFY_TIMEOUT_MS;
  let sawChallenge = false;
  while (Date.now() < deadline) {
    if (signal.aborted) throw new AbortedError('run stopped');
    const anchorChecked = await page
      .frameLocator(ANCHOR_FRAME)
      .locator('#recaptcha-anchor')
      .getAttribute('aria-checked')
      .catch(() => null);
    if (anchorChecked === 'true') return 'solved';

    const frame = page.frameLocator(CHALLENGE_FRAME);
    const wrong = await frame
      .locator('.rc-imageselect-incorrect-response:visible')
      .count()
      .catch(() => 0);
    if (wrong > 0) return 'wrong';

    const expired = await frame
      .locator('.rc-imageselect-error-response:visible')
      .count()
      .catch(() => 0);
    if (expired > 0) return 'expired';

    // bframe không còn challenge → gần như chắc chắn solved
    const challengeVisible = await frame.locator('#rc-imageselect:visible').count().catch(() => 0);
    if (challengeVisible === 0 && sawChallenge) return 'solved';
    if (challengeVisible > 0) sawChallenge = true;

    await sleep(400, signal);
  }
  return 'next';
}