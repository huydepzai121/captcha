// language: TypeScript, file: scripts/smoke-pipeline.ts, runtime: Node 22
// Chạy trọn pipeline trên MỘT lưới thật: vision mô tả → JEV quyết định.
// In ra mọi thứ để soi chất lượng từng tầng.
// Chạy: pnpm exec tsx scripts/smoke-pipeline.ts

import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { ANCHOR_FRAME, CHALLENGE_FRAME, DEMO_URL } from '../agent/config.js';
import { describeTiles } from '../agent/vision.js';
import { decideTilesWithJev, extractTarget } from '../agent/jev-decide.js';
import { loadDotEnv } from '../agent/env.js';

const sleep = (ms: number): Promise<void> => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
};

loadDotEnv();

const apiKey = process.env.AI_GATEWAY_API_KEY;
if (!apiKey) {
  console.error('AI_GATEWAY_API_KEY chưa set — cần key để gọi model');
  process.exit(1);
}
const TABLE_SELECTORS =
  'table.rc-imageselect-table-33, table.rc-imageselect-table-44, table.rc-imageselect-table-42';

// ── bắt lưới thật ────────────────────────────────────────────────────
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
const buf: Buffer = await table.screenshot({ type: 'jpeg', quality: 92 });
writeFileSync('runs/pipeline-grid.jpg', buf);
await browser.close();

console.log('═══════════ ĐỀ BÀI ═══════════');
console.log(instruction);
console.log(`lưới ${gridInfo.rows}x${gridInfo.cols} · target = "${extractTarget(instruction)}"`);
console.log('ảnh lưu tại runs/pipeline-grid.jpg\n');

// ── tầng mắt ─────────────────────────────────────────────────────────
console.log('═══════════ VISION (chỉ mô tả) ═══════════');
const vision = await describeTiles({
  apiKey,
  imageBase64: buf.toString('base64'),
  cols: gridInfo.cols,
  rows: gridInfo.rows,
  instruction,
  focusTarget: extractTarget(instruction),
});
console.log(
  `${vision.latencyMs}ms · $${(vision.costUsd ?? 0).toFixed(6)} · ${vision.inputTokens}→${vision.outputTokens} token`,
);
for (const [i, d] of vision.descriptions.entries()) {
  const own = vision.verdicts[i] === 'yes' ? 'vision:yes' : vision.verdicts[i] === 'no' ? 'vision:no' : '';
  const filled = d ? '' : '  ← TRỐNG';
  console.log(`  [${i}] ${d || '(không có mô tả)'}${filled}${own ? `   (${own})` : ''}`);
}

// ── tầng não ─────────────────────────────────────────────────────────
// Phán đoán của vision đi kèm nhưng KHÔNG được đưa vào câu hỏi — JEV phải tự đọc
// mô tả. Verdict chỉ dùng khi JEV hỏng.
console.log('\n═══════════ JEV (bên quyết định) ═══════════');
const decision = await decideTilesWithJev({
  apiKey,
  instruction,
  tiles: vision.descriptions.map((description, index) => ({
    index,
    description,
    verdict: vision.verdicts[index] ?? 'unknown',
  })),
});
console.log(
  `${decision.latencyMs}ms · $${(decision.costUsd ?? 0).toFixed(6)} · nguồn: ${decision.source}` +
    (decision.error ? ` · ${decision.error}` : ''),
);
for (const [key, p] of Object.entries(decision.probabilities)) {
  const bar = '█'.repeat(Math.round(p * 20));
  const mark = p >= 0.5 ? ' ✓' : '';
  console.log(`  ${key.padEnd(8)} ${(p * 100).toFixed(1).padStart(5)}%  ${bar}${mark}`);
}
console.log(`\n→ JEV chọn: [${decision.tiles.join(', ')}]`);

console.log('\n═══════════ TỔNG ═══════════');
console.log(`vision ${vision.latencyMs}ms + jev ${decision.latencyMs}ms = ${vision.latencyMs + decision.latencyMs}ms`);
console.log(`chi phí: $${((vision.costUsd ?? 0) + (decision.costUsd ?? 0)).toFixed(6)}`);
