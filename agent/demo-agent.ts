// language: TypeScript, file: agent/demo-agent.ts, runtime: Node 22
// Agent chạy trên trang demo reCAPTCHA của Google:
//   1. mở trang, tick anchor
//   2. vòng chọn: chụp lưới → vision mô tả → JEV quyết định → click ô khớp
//      lặp tới khi KHÔNG còn ô nào khớp
//   3. verify
//   4. nếu Google chấm sai, challenge vẫn giữ nguyên với ảnh mới → quay lại bước 2
//
// Hai điều load-bearing, rút ra từ chạy thật:
//   - Google swap ảnh mới vào ô vừa click bằng hiệu ứng mờ dần. Chụp theo đồng hồ
//     là sai; phải chụp tới khi ảnh ổn định (2 khung liên tiếp giống nhau).
//   - "Please also check the new images" nghĩa là verify quá sớm, không phải
//     challenge mới. Phải chọn tiếp trên cùng challenge đó.

import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, firefox, type BrowserContext, type Frame, type Locator, type Page } from 'playwright';
import sharp from 'sharp';
import { describeTiles, verifyTiles, type VerifyTilesResult, type VisionResult } from './vision.js';
import { decideTilesWithJev, cleanInstruction, extractTarget, type JevDecision } from './jev-decide.js';
import { solveGridWithJev } from './jev-solve.js';
import { solveHCaptcha } from './hcaptcha.js';
import { ANCHOR_FRAME, CHALLENGE_FRAME, DEMO_URL, requireApiKey } from './config.js';

export interface AgentOptions {
  apiKey: string;
  headless: boolean;
  /** Browser engine: 'chrome' (mặc định, Chromium/Chrome qua CDP) | 'firefox'. */
  browser?: 'chrome' | 'firefox';
  /**
   * `jev-images` (mặc định): JEV nhìn thẳng ảnh lưới. `vision`: đường cũ —
   * model mô tả từng ô bằng chữ rồi JEV chấm chữ.
   */
  decision?: 'jev-images' | 'vision';
  /** Hậu tố profile trình duyệt — dùng để chạy với phiên sạch. */
  profile?: string;
  /** Trang đích. Mặc định là trang demo của Google. */
  targetUrl?: string;
  /** Đổi model decision (mặc định jev-latest). */
  jevModel?: string;
  visionModel?: string;
  threshold?: number;
  maxAttempts?: number;
  budgetMs?: number;
  /** Làm chậm mọi thao tác Playwright, ms. Để 0 khi chạy tự động. */
  slowMo?: number;
  /** Giữ trình duyệt mở sau khi xong, để xem lại trạng thái cuối. */
  keepOpen?: boolean;
  /** Thư mục lưu ảnh các ca JEV không tìm thấy ô nào. */
  debugDir?: string;
  onLog?: (msg: string) => void;
  /**
   * Chạy sau khi trang đã mở, trước khi động vào captcha. Dùng cho trang đăng
   * nhập thật: điền sẵn tài khoản rồi bấm nút gửi — nhiều trang (NukeViet) chỉ
   * dựng widget reCAPTCHA sau cú bấm đó, nằm trong modal.
   */
  beforeSolve?: (page: Page) => Promise<void>;
  /** Chạy ngay khi captcha xong, trước khi đóng trình duyệt — để đọc kết quả. */
  afterSolve?: (page: Page, passed: boolean) => Promise<void>;
}

export interface AgentResult {
  passed: boolean;
  attempts: number;
  reason: string;
  durationMs: number;
  clicksPerAttempt: number[][];
  visionMs: number[];
  jevMs: number[];
  /** Số lượt JEV hỏng phải rơi về phán đoán của tầng mắt. */
  jevFailures: number;
  /** Số lượt phải bỏ đường JEV-ảnh, quay lại vision + JEV chữ. */
  visionFallbacks: number;
  costUsd: number;
}

/**
 * Ngân sách mặc định. Google leo thang qua nhiều challenge trước khi chấp nhận,
 * và mỗi challenge tốn ~30s (chọn nhiều lượt + verify). Đo thực tế: một lần pass
 * cần 4 challenge ≈ 113s, một lần khác cần hơn 8 challenge. Để 240s là quá chặt
 * và cắt ngang giữa lúc đang thắng.
 */
const RUN_BUDGET_MS = 600_000;
/**
 * Google trả lời trong 1-2s. Ba giây rưỡi là đủ rộng, và khi hết hạn thì vòng
 * lặp ngoài vẫn đọc lại lưới rồi xử lý đúng — nên chờ thêm chỉ đốt thời gian.
 * Không phân biệt được challenge mới bằng đề: Google hay phát lại cùng một đề
 * liên tiếp ("crosswalks" rồi "crosswalks"), nên so đề một mình không đủ.
 */
const VERIFY_TIMEOUT_MS = 3_500;

const sleep = (ms: number): Promise<void> => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
};

interface GridInfo {
  cols: number;
  rows: number;
  tableSel: string;
}

/** Ô cần click trong vòng này: trong lưới, và chưa click lần nào trong challenge. */
/** Không bao giờ click lại ô đã click — click lần hai là bỏ chọn. */
export const tilesToClick = (
  tiles: readonly number[],
  size: number,
  clicked: ReadonlySet<number>,
): number[] => tiles.filter((t) => Number.isInteger(t) && t >= 0 && t < size && !clicked.has(t));

const TABLE_SELECTORS =
  'table.rc-imageselect-table-33, table.rc-imageselect-table-44, table.rc-imageselect-table-42';

/** Frame chứa challenge, tìm bằng URL. Dùng thay contentDocument cho trang thật. */
const challengeFrame = (page: Page): Frame | null =>
  page.frames().find((f) => f.url().includes('api2/bframe')) ?? null;

/**
 * Chờ TOÀN BỘ ảnh tile load xong.
 *
 * Load-bearing: phải chờ đủ `expected` ô, không phải "có ít nhất một ô". Sau khi
 * Google swap ảnh mới vào ô vừa click, các ô còn lại đã nằm trong cache nên
 * `complete = true` ngay — thoát sớm ở đó nghĩa là chụp phải ảnh CŨ, model không
 * thấy vật thể mới, và agent verify thiếu ô ("Please also check the new images").
 */
async function waitForTilesLoaded(page: Page, expected: number, maxWaitMs: number): Promise<number> {
  const deadline = Date.now() + maxWaitMs;
  let loaded = 0;
  let stableFullFrames = 0;

  while (Date.now() < deadline) {
    // Đọc TRONG frame, không qua `contentDocument`: trang thật (muasamcong…)
    // nhúng bframe từ google.com nên `contentDocument` là null vì cross-origin.
    const frame = challengeFrame(page);
    loaded = frame
      ? await frame
          .evaluate(
            () =>
              (Array.from(document.querySelectorAll('img[class*="rc-image-tile"]')) as HTMLImageElement[]).filter(
                (img) => img.complete && img.naturalWidth > 0,
              ).length,
          )
          .catch(() => 0)
      : 0;

    // Đủ số ô, và giữ được hai vòng liên tiếp — ảnh có thể chớp qua trạng thái
    // "complete" của src cũ trước khi src mới kịp gán.
    if (loaded >= expected) {
      stableFullFrames += 1;
      if (stableFullFrames >= 2) return loaded;
    } else {
      stableFullFrames = 0;
    }

    await sleep(120);
  }
  return loaded;
}

/**
 * Chụp lưới bằng locator.screenshot với timeout NGẮN và thử lại nhiều nhịp.
 *
 * Load-bearing hai chiều, rút ra từ chạy thật:
 *   - locator.screenshot render ĐÚNG nội dung cross-frame. boundingBox +
 *     page.screenshot clip thì KHÔNG: box của phần tử trong iframe lệch với
 *     không gian clip của page — ảnh chụp thành dải 74x388 của form demo,
 *     vision mô tả "radio button, submit" thay vì lưới ô.
 *   - locator.screenshot chờ "element stable" theo timeout mặc định 30s; Google
 *     swap bảng giữa lúc chờ → "Element is not attached to the DOM", cả trial
 *     chết (4/10 trial chết vì đúng lý do này). Timeout ngắn + thử lại: đợt
 *     swap xong, lệnh chụp kế tiếp tự resolve đúng bảng mới.
 */
async function shootGrid(table: Locator, quality: number): Promise<Buffer> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const shot = await table.screenshot({ type: 'png', timeout: 2_500 });
      // Phóng 2x: lưới 4x4 cho mỗi ô ~97px — vật nhỏ (xe máy, cột đèn) mất
      // chi tiết ở độ phân giải gốc, vision bỏ sót. Lanczos giữ cạnh sắc.
      const meta = await sharp(shot).metadata();
      return await sharp(shot)
        .resize(Math.round((meta.width ?? 0) * 2), Math.round((meta.height ?? 0) * 2), {
          kernel: 'lanczos3',
        })
        .jpeg({ quality })
        .toBuffer();
    } catch (err) {
      lastError = err;
      await sleep(250);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('chụp lưới thất bại');
}
/**
 * Chụp lưới. Lượt đầu chỉ cần MỘT khung: `waitForTilesLoaded` đã xác nhận ảnh
 * load xong, nên vòng so hai khung chỉ tốn thêm thời gian mà không lọc được gì.
 * Từ lượt hai mới cần vòng đó, vì Google swap ảnh kèm hiệu ứng mờ dần.
 */
async function captureStableGrid(
  table: Locator,
  page: Page,
  opts: { expected: number; waitLoad: boolean; settle: boolean; maxWaitMs: number },
): Promise<Buffer> {
  if (opts.waitLoad) await waitForTilesLoaded(page, opts.expected, opts.maxWaitMs);
  if (!opts.settle) return shootGrid(table, 80);

  const deadline = Date.now() + opts.maxWaitMs;
  let prev = await shootGrid(table, 80);

  while (Date.now() < deadline) {
    await sleep(150);
    const next = await shootGrid(table, 80);
    if (prev.equals(next)) return next;
    prev = next;
  }
  return prev;
}

/**
 * Cắt một ô khỏi ảnh lưới. Lưới là bảng đều: w/cols × h/rows, đánh số
 * row-major. Mép cuối lấy nốt phần dư làm tròn.
 */
async function cropTile(buf: Buffer, index: number, cols: number, rows: number): Promise<Buffer> {
  const meta = await sharp(buf).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const tileW = Math.floor(width / cols);
  const tileH = Math.floor(height / rows);
  const col = index % cols;
  const row = Math.floor(index / cols);
  return sharp(buf)
    .extract({
      left: col * tileW,
      top: row * tileH,
      width: col === cols - 1 ? width - col * tileW : tileW,
      height: row === rows - 1 ? height - row * tileH : tileH,
    })
    .jpeg()
    .toBuffer();
}

/**
 * Các ô ĐANG được chọn, đọc từ DOM.
 *
 * Đây là nguồn sự thật duy nhất về việc tick đang bật hay tắt. Đoán qua `src`
 * ảnh là sai: Google swap ảnh mới vào ô đã chọn, nên `src` đổi trong khi tick
 * vẫn bật — và click thêm một lần nữa là tắt tick đó đi.
 */
async function readSelectedTiles(page: Page): Promise<Set<number>> {
  // Đọc trong frame: trang thật nhúng bframe cross-origin nên `contentDocument`
  // là null ở đó.
  const frame = challengeFrame(page);
  if (!frame) return new Set();
  const indexes = await frame
    .evaluate(() =>
      Array.from(document.querySelectorAll('td.rc-imageselect-tile'))
        .map((td, i) => (td.className.includes('selected') ? i : -1))
        .filter((i) => i >= 0),
    )
    .catch(() => [] as number[]);
  return new Set(indexes);
}

async function readGridInfo(page: Page): Promise<GridInfo> {
  const info = await page
    .frameLocator(CHALLENGE_FRAME)
    .locator(TABLE_SELECTORS)
    .first()
    .evaluate((table: HTMLTableElement) => {
      const rows = table.querySelectorAll('tr').length;
      const firstRowCells = table.querySelector('tr')?.querySelectorAll('td').length ?? 0;
      return { cols: firstRowCells, rows };
    });
  if (info.cols < 2 || info.rows < 2 || info.cols > 4 || info.rows > 4) {
    throw new Error(`cấu trúc lưới lạ: ${JSON.stringify(info)}`);
  }
  return { ...info, tableSel: TABLE_SELECTORS };
}

/** Google có đang hiện thông báo "chọn thêm ảnh mới" không. */
async function hasNewImagesPrompt(page: Page): Promise<boolean> {
  const frame = page.frameLocator(CHALLENGE_FRAME);
  const text = await frame
    .locator('#rc-imageselect-error-select-more, .rc-imageselect-incorrect-response')
    .first()
    .innerText({ timeout: 1_000 })
    .catch(() => '');
  return /new images|also check|matching images|chọn thêm/i.test(text);
}

async function clickVerify(page: Page): Promise<void> {
  // Click chuột thật qua toạ độ (boundingBox tính theo viewport, đã gộp offset
  // iframe). Fallback là click DOM cho trường hợp toạ độ không lấy được.
  const frame = page.frames().find((f) => f.url().includes('api2/bframe'));
  if (!frame) throw new Error('không tìm thấy bframe để bấm verify');
  const box = await frame
    .locator('#recaptcha-verify-button')
    .boundingBox()
    .catch(() => null);
  if (box) {
    await humanClick(page, box.x + box.width / 2, box.y + box.height / 2);
    return;
  }
  await frame.evaluate(() => {
    (document.getElementById('recaptcha-verify-button') as HTMLElement | null)?.click();
  });
}

/** Chuột "người": nhiều chặng di chuyển, dừng ngắn trước khi nhấn. Google theo
 * dõi quỹ đạo con trỏ — nhảy thẳng tới toạ độ là dấu hiệu máy móc. */
const lastPoint = { x: 640, y: 400 };

async function humanClick(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.move(lastPoint.x, lastPoint.y, { steps: 2 });
  await page.mouse.move(x, y, { steps: 6 + Math.floor(Math.random() * 5) });
  lastPoint.x = x;
  lastPoint.y = y;
  await sleep(40 + Math.random() * 70);
  await page.mouse.down();
  await sleep(30 + Math.random() * 50);
  await page.mouse.up();
}

export async function runAgent(opts: AgentOptions): Promise<AgentResult> {
  const t0 = Date.now();
  const rawLog = opts.onLog ?? (() => {});
  const log = (msg: string): void => rawLog(`[+${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`);
  let context: BrowserContext | null = null;

  let attempts = 0;
  let totalCost = 0;
  let jevFailures = 0;
  let visionFallbacks = 0;
  const clicksPerAttempt: number[][] = [];
  const visionMs: number[] = [];
  const jevMs: number[] = [];

  if (opts.debugDir) mkdirSync(opts.debugDir, { recursive: true });

  const budget = opts.budgetMs ?? RUN_BUDGET_MS;
  const maxAttempts = opts.maxAttempts ?? 35;
  const decisionMode = opts.decision ?? 'jev-images';
  try {
    // Persistent profile: cookie/history tích lũy qua các run — Google tin
    // session quay lại hơn session mới tinh, chuỗi escalation ngắn hơn hẳn.
    // Mỗi browser một profile riêng — profile do Chrome channel ghi, bundled
    // Chromium (bản 1243) mở lại là crash exit 21, và ngược lại.
    const profileDir = path.join('runs', `pw-profile-${opts.browser ?? 'chrome'}${opts.profile ? `-${opts.profile}` : ''}`);
    mkdirSync(profileDir, { recursive: true });
    const launchOpts = {
      headless: opts.headless,
      slowMo: opts.slowMo ?? 0,
      viewport: { width: 1280, height: 800 },
    };
    if (opts.browser === 'firefox') {
      context = await firefox.launchPersistentContext(profileDir, {
        ...launchOpts,
        // dom.webdriver.enabled=false → navigator.webdriver === false tự nhiên.
        firefoxUserPrefs: { 'dom.webdriver.enabled': false },
      });
      log('trình duyệt: Firefox (persistent profile)');
    } else {
      try {
        context = await chromium.launchPersistentContext(profileDir, {
          ...launchOpts,
          channel: 'chrome',
          args: ['--disable-blink-features=AutomationControlled'],
        });
        log('trình duyệt: Chrome (channel chrome, persistent)');
      } catch {
        context = await chromium.launchPersistentContext(profileDir, { ...launchOpts });
        log('trình duyệt: Chromium bundled (persistent)');
      }
    }
    const page = context.pages()[0] ?? (await context.newPage());

    const targetUrl = opts.targetUrl ?? DEMO_URL;
    log(`mở ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });

    if (opts.beforeSolve) await opts.beforeSolve(page);

    // hCaptcha có DOM khác hẳn (lưới vẽ trên canvas) nên phải đi flow riêng.
    if ((await detectProvider(page)) === 'hcaptcha') {
      log('phát hiện hCaptcha — dùng flow canvas riêng');
      const r = await solveHCaptcha(page, {
        apiKey: opts.apiKey,
        maxAttempts,
        budgetMs: budget,
        ...(opts.threshold === undefined ? {} : { threshold: opts.threshold }),
        ...(opts.jevModel ? { jevModel: opts.jevModel } : {}),
        onLog: log,
        onCost: (usd) => {
          totalCost += usd;
        },
        onJev: (ms) => jevMs.push(ms),
      });
      log(r.passed ? 'PASS ✓' : 'FAIL');
      return {
        passed: r.passed,
        attempts: r.attempts,
        reason: r.reason,
        durationMs: Date.now() - t0,
        clicksPerAttempt: r.clicks,
        visionMs,
        jevMs,
        visionFallbacks,
        jevFailures,
        costUsd: totalCost,
      };
    }

    const anchor = page.frameLocator(ANCHOR_FRAME).locator('#recaptcha-anchor');
    await anchor.waitFor({ state: 'visible', timeout: 20_000 });

    // Phải click CHUỘT THẬT lên anchor. Đo trên trang thật (muasamcong): bframe
    // nằm sẵn ở y=-9999 và chỉ được kéo ra khi có trusted mouse event —
    // `locator.click()` chạy xong mà challenge không mở, rồi chết ở bước chờ.
    let opened: 'checked' | 'challenge' | 'timeout' = 'timeout';
    for (let round = 1; round <= 2 && opened === 'timeout'; round += 1) {
      await clickAnchor(page);
      log(round === 1 ? 'đã tick anchor' : 'tick anchor lại — chưa thấy phản hồi');
      opened = await waitForChallenge(page, 8_000);
    }

    if (opened === 'checked' || (await anchor.getAttribute('aria-checked').catch(() => null)) === 'true') {
      log('Google pass thẳng — không cần challenge');
      if (opts.afterSolve) await opts.afterSolve(page, true);
      return {
        passed: true,
        attempts: 0,
        reason: 'Google pass thẳng',
        durationMs: Date.now() - t0,
        clicksPerAttempt,
        visionMs,
        jevMs,
        visionFallbacks,
        jevFailures,
        costUsd: 0,
      };
    }
    if (opened === 'timeout') throw new Error('tick anchor không mở được challenge');

    while (Date.now() - t0 < budget && attempts < maxAttempts) {
      attempts += 1;
      // Đợi Google xoá tick (swap ảnh sau verify) trước khi chụp lưới mới.
      // Không đợi thì waitForTilesLoaded pass ngay trên ảnh CŨ còn "complete"
      // → capture dính lưới cũ → chọn sai trên lưới mới → reset vô hạn.
      // Banner "select more" thì tick có chủ đích được giữ — thoát sớm.
      const clearDeadline = Date.now() + 3_000;
      while (Date.now() < clearDeadline) {
        if (await hasNewImagesPrompt(page)) break;
        if ((await readSelectedTiles(page)).size === 0) break;
        await sleep(150);
      }
      const bframe = page.frameLocator(CHALLENGE_FRAME);
      await bframe.locator('#rc-imageselect').waitFor({ state: 'visible', timeout: 20_000 });

      const grid = await readGridInfo(page);
      const instruction = (await bframe.locator('.rc-imageselect-instructions').innerText({ timeout: 5_000 }))
        .replace(/\s+/g, ' ')
        .trim();
      const table = bframe.locator(grid.tableSel).first();

      log(`── challenge #${attempts} · ${grid.cols}x${grid.rows} · "${cleanInstruction(instruction)}"`);

      const clickedThisAttempt: number[] = [];
      const clickedThisChallenge = new Set<number>();
      const maxRounds = grid.cols * grid.rows + 3;

      // ── vòng chọn: chọn tới khi hết ô khớp ──────────────────────────
      let rechecked = false;

      let captureFailed = false;
      for (let round = 1; round <= maxRounds; round += 1) {
        let shot: Buffer;
        try {
          shot = await captureStableGrid(table, page, { expected: grid.cols * grid.rows, waitLoad: true, settle: round > 1, maxWaitMs: 5000 });
        } catch (err) {
          log(`   chụp lưới lỗi (${err instanceof Error ? err.message.slice(0, 60) : 'không rõ'}) — bỏ lượt này`);
          captureFailed = true;
          break;
        }
        const shotBase64 = shot.toString('base64');

        // ── quyết định ─────────────────────────────────────────────────
        // Mặc định: JEV nhìn thẳng ảnh lưới, trả xác suất từng ô — một round
        // trip, không mất thông tin qua câu chữ, và đúng việc noul sinh ra để
        // làm. `--decision vision` giữ đường cũ làm đường lùi.
        let decision: JevDecision | null = null;
        let vision: VisionResult | null = null;

        if (decisionMode === 'jev-images') {
          try {
            const gridDecision = await solveGridWithJev({
              apiKey: opts.apiKey,
              imageBase64: await gridImageBase64(shot),
              cols: grid.cols,
              rows: grid.rows,
              instruction,
              ...(opts.threshold === undefined ? {} : { threshold: opts.threshold }),
              ...(opts.jevModel ? { model: opts.jevModel } : {}),
            });
            decision = gridDecision;
            jevMs.push(gridDecision.latencyMs);
            totalCost += gridDecision.costUsd ?? 0;
            log(
              `   lượt ${round}: JEV(ảnh) ${gridDecision.latencyMs}ms → ${gridDecision.tiles.length} ô [${gridDecision.tiles.join(',')}]`,
            );
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            log(`   JEV ảnh lỗi (${message.slice(0, 80)}) — rơi về vision+JEV cho lượt này`);
          }
        }

        /** Đường lùi: vision mô tả từng ô, JEV chấm mô tả. Chậm và tốn hơn. */
        const decideWithVision = async (): Promise<void> => {
          let visionError = 'không rõ';
          for (let vi = 1; vi <= 3; vi += 1) {
            try {
              vision = await describeTiles({
                apiKey: opts.apiKey,
                imageBase64: shotBase64,
                cols: grid.cols,
                rows: grid.rows,
                instruction,
                focusTarget: extractTarget(instruction),
                ...(opts.visionModel ? { model: opts.visionModel } : {}),
              });
              break;
            } catch (err) {
              visionError = err instanceof Error ? err.message.slice(0, 120) : 'không rõ';
              log(`   vision lỗi (${visionError.slice(0, 60)}) — thử lại ${vi}/3`);
              await sleep(1_500);
            }
          }
          if (!vision) throw new Error(`vision lỗi 3 lần liên tiếp: ${visionError}`);
          let seen = vision;
          visionMs.push(seen.latencyMs);
          totalCost += seen.costUsd ?? 0;
          totalCost += seen.costUsd ?? 0;

          // Ô thiếu mô tả thì JEV không có gì để chấm, và ô đó chắc chắn bị bỏ
          // sót. Đo thực tế: một challenge chỉ về 12/16 ô, và đó là challenge
          // hỏng đầu tiên. Hỏi lại một lần trước khi chấp nhận kết quả thiếu.
          const total = grid.cols * grid.rows;
          let missing = seen.descriptions.filter((d) => d.length === 0).length;
          if (missing > 0) {
            log(`   thiếu mô tả ${missing}/${total} ô — hỏi lại`);
            const retry = await describeTiles({
              apiKey: opts.apiKey,
              imageBase64: shotBase64,
              cols: grid.cols,
              rows: grid.rows,
              instruction,
              focusTarget: extractTarget(instruction),
              ...(opts.visionModel ? { model: opts.visionModel } : {}),
            });
            visionMs.push(retry.latencyMs);
            totalCost += retry.costUsd ?? 0;

            const retryMissing = retry.descriptions.filter((d) => d.length === 0).length;
            if (retryMissing < missing) {
              seen = retry;
              missing = retryMissing;
            }
            log(`   sau khi hỏi lại: còn thiếu ${missing}/${total}`);
          }

          // Tầng não quyết trên mô tả. Phán đoán yes/no của vision đi kèm nhưng
          // chỉ dùng khi JEV hỏng, hoặc khi JEV bỏ trống một ô.
          const decided = await decideTilesWithJev({
            apiKey: opts.apiKey,
            instruction,
            tiles: seen.descriptions.map((description, index) => ({
              index,
              description,
              verdict: seen.verdicts[index] ?? 'unknown',
            })),
            ...(opts.threshold === undefined ? {} : { threshold: opts.threshold }),
          });
          jevMs.push(decided.latencyMs);
          totalCost += decided.costUsd ?? 0;
          if (decided.degraded) {
            jevFailures += 1;
            log(`   JEV hỏng (${decided.error ?? 'không rõ'}) — dùng phán đoán của vision cho lượt này`);
          }

          const described = seen.descriptions.filter((d) => d.length > 0).length;
          log(
            `   lượt ${round}: vision ${seen.latencyMs}ms (${described}/${grid.cols * grid.rows} ô có mô tả) · ` +
              `${decided.source === 'jev' ? 'JEV' : 'vision(fallback)'} ${decided.latencyMs}ms → ${decided.tiles.length} ô [${decided.tiles.join(',')}]`,
          );
          if (described === 0) {
            log(`   CẢNH BÁO: vision không mô tả được ô nào. Raw: ${seen.raw.slice(0, 200)}`);
          }
          decision = decided;
        };

        if (!decision) {
          visionFallbacks += 1;
          await decideWithVision();
        }
        if (!decision) throw new Error('không có quyết định cho lượt này');

        // In phân bố xác suất đầy đủ. Ngưỡng 0.5 chỉ là một nhát cắt — để chỉnh
        // được ngưỡng thì phải thấy các ô nằm sát ngưỡng hay tách hẳn.
        // Nguồn fallback thì đây là xác suất dựng lại (1/0/0.5), không phải của JEV.
        const dist = Object.entries(decision.probabilities)
          .map(([k, p]) => `${k.replace('tile_', '')}:${(p * 100).toFixed(0)}`)
          .join(' ');
        log(`   ${decision.source === 'jev' ? 'JEV' : 'điểm'}: ${dist}`);

        // Hai ca cần hỏi thẳng vision trên ảnh từng ô (một lượt gọi cho cả nhóm):
        //   - Google đang báo "chọn thêm" — lượt verify trước thiếu ô. Chỉ THÊM
        //     ô mới: thiếu là mềm ("select all matching images"), chọn nhầm là
        //     chết (incorrect). Regex cũ không khớp text này nên agent cứ verify
        //     lại cùng lựa chọn cho tới khi chết lượt.
        //   - JEV thoái hoá (max p < 0.2 trên toàn bộ ô) — mô tả trôi hoặc lưới
        //     khó; crop trực tiếp là tín hiệu độc lập với mô tả.
        const underselect = await hasNewImagesPrompt(page);
        // JEV hỏng cũng tính là thoái hoá: lúc đó `decision` chỉ còn là phán
        // đoán của tầng mắt, không có xác suất nào để tin.
        const degenerate =
          decision.degraded ||
          (decision.tiles.length === 0 &&
            Math.max(0, ...Object.values(decision.probabilities)) < 0.2);
        if (underselect || degenerate) {
          const already = await readSelectedTiles(page);
          const candidates = Array.from({ length: grid.cols * grid.rows }, (_, i) => i).filter(
            (i) => !already.has(i),
          );
          if (candidates.length > 0) {
            const recallCrops = await Promise.all(
              candidates.map((tile) => cropTile(shot, tile, grid.cols, grid.rows)),
            );
            let check: VerifyTilesResult | null = null;
            try {
              check = await verifyTiles({
                apiKey: opts.apiKey,
                target: extractTarget(instruction),
                tiles: candidates.map((tile, i) => ({ index: tile, imageBase64: recallCrops[i]!.toString('base64') })),
                ...(opts.visionModel ? { model: opts.visionModel } : {}),
              });
            } catch (err) {
              log(`   recall lỗi (${err instanceof Error ? err.message.slice(0, 60) : 'không rõ'}) — bỏ qua, dùng nguyên JEV`);
            }
            if (check) {
              totalCost += check.costUsd ?? 0;
              decision = {
                ...decision,
                tiles: [...new Set([...decision.tiles, ...check.yes])].sort((a, b) => a - b),
              };
              log(
                `   recall (${underselect ? 'còn thiếu' : 'JEV thoái hoá'}): +${check.yes.size} ô → ${decision.tiles.length} ô [${decision.tiles.join(',')}]`,
              );
            }
          }
        }

        // Lưu ảnh mỗi lượt khi bật debug — nhìn tận mắt capture có đúng lưới
        // không, và phân biệt "ảnh bị Google làm khó" với "model bỏ sót".
        if (opts.debugDir) {
          writeFileSync(`${opts.debugDir}/shot-${attempts}-${round}.jpg`, shot);
        }
        if (decision.tiles.length === 0 && opts.debugDir) {
          // `vision` chỉ được gán trong closure nên TS coi nó là null ở đây.
          const raw = (vision as VisionResult | null)?.raw ?? '';
          writeFileSync(`${opts.debugDir}/miss-${attempts}-${round}.txt`, raw);
        }

        if (decision.tiles.length === 0) {
          log('   không còn ô khớp — chuyển sang verify');
          break;
        }

        // Click theo bounding box RIÊNG của từng ô, không chia đều từ bounding
        // box của bảng. Bảng reCAPTCHA có viền và khoảng cách giữa các ô, nên
        // `table.width / cols` cho ra toạ độ lệch — lệch đủ để Google ghi nhận
        // sai ô, và càng lệch khi cửa sổ nhỏ.
        await table.scrollIntoViewIfNeeded().catch(() => {});
        const cells = table.locator('td');

        // Ô ĐÃ CLICK trong suốt challenge này. Không dựa DOM: đo được rằng
        // Google giữ tick và thay ảnh liên tục trong ô vừa click (hash đổi mỗi
        // 0,5s), còn click lần hai lên ô đã tick là BỎ CHỌN và hoàn ảnh cũ.
        // Nên danh sách này là nguồn sự thật, không phải class trong DOM.
        const toClick = tilesToClick(decision.tiles, grid.cols * grid.rows, clickedThisChallenge);
        if (toClick.length === 0) {
          log('   không còn ô mới để chọn — chuyển sang verify');
          break;
        }

        for (const tile of toClick) {
          const cell = cells.nth(tile);
          const cellBox = await cell.boundingBox({ timeout: 2_000 }).catch(() => null);
          if (!cellBox) {
            log(`   bỏ ô ${tile}: không lấy được boundingBox`);
            continue;
          }
          const jitterX = (Math.random() - 0.5) * Math.min(8, cellBox.width * 0.15);
          const jitterY = (Math.random() - 0.5) * Math.min(8, cellBox.height * 0.15);
          await sleep(60 + Math.random() * 90);
          await humanClick(
            page,
            cellBox.x + cellBox.width / 2 + jitterX,
            cellBox.y + cellBox.height / 2 + jitterY,
          );

          // Click trượt mà không biết thì verify với 0 ô và Google chấm sai.
          await sleep(70);
          const nowSelected = await readSelectedTiles(page);
          if (!nowSelected.has(tile)) {
            log(`   click ô ${tile} KHÔNG ăn — thử lại`);
            await sleep(110);
            await humanClick(page, cellBox.x + cellBox.width / 2, cellBox.y + cellBox.height / 2);
          }

          clickedThisChallenge.add(tile);
          clickedThisAttempt.push(tile);
        }

        // Lưới biến mất nghĩa là Google đã chấm xong
        if ((await bframe.locator('#rc-imageselect:visible').count().catch(() => 0)) === 0) break;
      }

      clicksPerAttempt.push(clickedThisAttempt);
      if (captureFailed) continue;

      // ── verify ─────────────────────────────────────────────────────
      // Đọc trạng thái tick thật trước khi nộp. Nếu DOM báo 0 ô chọn trong khi
      // ta đã click thì Google đã dựng lại bảng làm rơi tick — click lại đúng
      // những ô đó (chỉ ô đang KHÔNG tick, vì click ô đã tick là bỏ chọn).
      let selectedBeforeVerify = await readSelectedTiles(page);
      const lost = [...clickedThisChallenge].filter((t) => !selectedBeforeVerify.has(t));
      if (selectedBeforeVerify.size === 0 && lost.length > 0) {
        log(`   mất hết tick — chọn lại ${lost.length} ô`);
        const cells2 = table.locator('td');
        for (const tile of lost) {
          const cellBox = await cells2.nth(tile).boundingBox({ timeout: 2_000 }).catch(() => null);
          if (!cellBox) continue;
          await humanClick(page, cellBox.x + cellBox.width / 2, cellBox.y + cellBox.height / 2);
          await sleep(90);
        }
        selectedBeforeVerify = await readSelectedTiles(page);
      }
      log(`   đang chọn ${selectedBeforeVerify.size} ô [${[...selectedBeforeVerify].sort((a, b) => a - b).join(',')}]`);

      await sleep(120 + Math.random() * 100);
      log('   verify → Google chấm');
      await clickVerify(page);

      const verdict = await waitForVerdict(page, instruction);

      if (verdict === 'solved') {
        log('PASS ✓');
        if (opts.afterSolve) await opts.afterSolve(page, true);
        return {
          passed: true,
          attempts,
          reason: `Google xác nhận đúng sau ${attempts} challenge`,
          durationMs: Date.now() - t0,
          clicksPerAttempt,
          visionMs,
          jevMs,
          visionFallbacks,
          jevFailures,
          costUsd: totalCost,
        };
      }

      if (verdict === 'expired') {
        return {
          passed: false,
          attempts,
          reason: 'challenge hết hạn',
          durationMs: Date.now() - t0,
          clicksPerAttempt,
          visionMs,
          jevMs,
          visionFallbacks,
          jevFailures,
          costUsd: totalCost,
        };
      }

      // Sai: challenge có thể vẫn giữ nguyên với ảnh mới. Vòng lặp ngoài sẽ
      // quay lại chọn trên chính challenge đó — không reset, không chờ vô ích.
      const stillAsking = await hasNewImagesPrompt(page);
      log(
        stillAsking
          ? '   Google báo còn ảnh mới — chọn tiếp'
          : verdict === 'wrong'
            ? '   Google chấm SAI'
            : '   challenge mới',
      );
      await sleep(350);
    }

    if (opts.afterSolve) await opts.afterSolve(page, false);

    return {
      passed: false,
      attempts,
      reason: attempts >= maxAttempts ? `hết ${maxAttempts} lượt` : 'hết ngân sách thời gian',
      durationMs: Date.now() - t0,
      clicksPerAttempt,
      visionMs,
      jevMs,
      visionFallbacks,
      jevFailures,
      costUsd: totalCost,
    };
  } finally {
    if (opts.keepOpen) {
      log('giữ trình duyệt mở — đóng cửa sổ để thoát');
    } else {
      await context?.close().catch(() => {});
    }
  }
}

/**
 * Ảnh lưới gửi cho JEV: JPEG base64, không tiền tố `data:`.
 *
 * API từ chối ảnh có cạnh ngoài 280–1568px, nên phải co/giãn cho vừa khung đó.
 * Lưới 4x4 chụp ở 1x chỉ ~600px — giãn lên 1024 giúp vật nhỏ có pixel để thở.
 */
const MIN_IMAGE_SIDE = 280;
const MAX_IMAGE_SIDE = 1024;

async function gridImageBase64(shot: Buffer): Promise<string> {
  const meta = await sharp(shot).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const longest = Math.max(width, height);
  const factor =
    longest > MAX_IMAGE_SIDE ? MAX_IMAGE_SIDE / longest : longest < MIN_IMAGE_SIDE ? MIN_IMAGE_SIDE / longest : 1;

  const out = await sharp(shot)
    .resize(Math.round(width * factor), Math.round(height * factor), { fit: 'fill' })
    .jpeg({ quality: 88 })
    .toBuffer();
  return out.toString('base64');
}

/** Widget nào đang có trên trang: hCaptcha hay reCAPTCHA. */
async function detectProvider(page: Page): Promise<'recaptcha' | 'hcaptcha'> {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    if (page.frames().some((f) => f.url().includes('hcaptcha.com'))) return 'hcaptcha';
    if (page.frames().some((f) => f.url().includes('recaptcha/api2/anchor'))) return 'recaptcha';
    await sleep(150);
  }
  // Không thấy widget lạ thì cứ đi đường reCAPTCHA, nó tự chờ và báo lỗi rõ hơn.
  return 'recaptcha';
}

/** Click anchor bằng chuột thật (trusted event); fallback click phần tử. */
async function clickAnchor(page: Page): Promise<void> {
  const box = await page
    .locator(ANCHOR_FRAME)
    .first()
    .boundingBox()
    .catch(() => null);
  if (box) {
    await humanClick(page, box.x + 22, box.y + box.height / 2);
    return;
  }
  await page
    .frameLocator(ANCHOR_FRAME)
    .locator('#recaptcha-anchor')
    .click({ timeout: 10_000 });
}

/** Chờ Google quyết: tick thẳng, hay mở challenge. */
async function waitForChallenge(page: Page, maxWaitMs: number): Promise<'checked' | 'challenge' | 'timeout'> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const checked = await page
      .frameLocator(ANCHOR_FRAME)
      .locator('#recaptcha-anchor')
      .getAttribute('aria-checked')
      .catch(() => null);
    if (checked === 'true') return 'checked';
    const frame = challengeFrame(page);
    if (frame && (await frame.locator('#rc-imageselect').isVisible().catch(() => false))) return 'challenge';
    await sleep(150);
  }
  return 'timeout';
}

/**
 * Đọc kết quả sau khi bấm verify.
 *
 * `previousInstruction` là đề của challenge vừa nộp. Google đưa challenge mới
 * mà KHÔNG tích anchor (anchor chỉ được tích khi mọi challenge đều đúng), nên
 * chờ anchor là chờ vô ích. Đổi đề chính là dấu hiệu challenge mới — bắt được
 * trong 1-2s thay vì ngồi hết timeout.
 */
async function waitForVerdict(
  page: Page,
  previousInstruction: string,
): Promise<'solved' | 'wrong' | 'expired' | 'next'> {
  const deadline = Date.now() + VERIFY_TIMEOUT_MS;
  const normalize = (s: string): string => s.replace(/\s+/g, ' ').trim();

  while (Date.now() < deadline) {
    const anchorChecked = await page
      .frameLocator(ANCHOR_FRAME)
      .locator('#recaptcha-anchor')
      .getAttribute('aria-checked')
      .catch(() => null);
    if (anchorChecked === 'true') return 'solved';

    const frame = page.frameLocator(CHALLENGE_FRAME);

    const wrong = await frame.locator('.rc-imageselect-incorrect-response:visible').count().catch(() => 0);
    if (wrong > 0) return 'wrong';

    const expired = await frame.locator('.rc-imageselect-error-response:visible').count().catch(() => 0);
    if (expired > 0) return 'expired';

    // Đề đổi → challenge mới
    const current = await frame
      .locator('.rc-imageselect-instructions')
      .innerText({ timeout: 800 })
      .catch(() => null);
    if (current !== null && normalize(current) !== normalize(previousInstruction)) return 'next';

    // Lưới biến mất hẳn → đã xong
    const challengeVisible = await frame.locator('#rc-imageselect:visible').count().catch(() => 0);
    if (challengeVisible === 0) return 'solved';

    await sleep(120);
  }
  return 'next';
}

export { requireApiKey, DEMO_URL };
