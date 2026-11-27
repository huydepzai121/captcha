// language: TypeScript, file: agent/index.ts, runtime: Node 22

// `pnpm agent` — chạy agent trên trang demo reCAPTCHA của Google.
// Credential: biến môi trường, hoặc `.env` ở thư mục gốc (nạp một chỗ qua agent/env).

import { runAgent } from './demo-agent.js';
import { VISION_MODEL } from './vision.js';
import { DEMO_URL } from './config.js';
import { requireApiKey } from './config.js';
import { loadDotEnv } from './env.js';

loadDotEnv();

const args = process.argv.slice(2);
const get = (flag: string): string | undefined => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

const headless = !args.includes('--headful');
const slowMoRaw = get('--slowmo');
const keepOpen = args.includes('--keep-open');
const thresholdRaw = get('--threshold');
const visionModel = get('--vision-model');
const maxAttemptsRaw = get('--max-attempts');
const debugDir = get('--debug-dir');
const browserFlag = get('--browser');
const targetFlag = get('--target');
const decisionFlag = get('--decision') === 'vision' ? 'vision' : 'jev-images';
const jevModel = get('--jev-model');
const minSideRaw = get('--min-side');
const ambiguity = !args.includes('--no-ambiguity');

const threshold = thresholdRaw === undefined ? undefined : Number.parseFloat(thresholdRaw);
if (threshold !== undefined && !Number.isFinite(threshold)) {
  console.error(`--threshold không phải số: ${thresholdRaw ?? ''}`);
  process.exit(1);
}

try {
  const apiKey = requireApiKey();
  console.log('── agent ─────────────────────────────────────');
  console.log(`  vision:   ${visionModel ?? VISION_MODEL}${decisionFlag === 'vision' ? '' : ' (chỉ đường lùi)'}`);
  console.log(`  decision: ${decisionFlag === 'jev-images' ? 'JEV nhìn thẳng ảnh (jev-latest)' : 'vision mô tả → JEV chấm chữ'}`);
  console.log(`  ngưỡng:   ${threshold ?? 0.5}`);
  console.log(`  ảnh gửi:  phóng tới sàn ${minSideRaw ?? 768}px · soát ô mơ hồ: ${ambiguity ? 'bật' : 'tắt'}`);
  console.log(`  headless: ${headless}${slowMoRaw ? ` · slowMo ${slowMoRaw}ms` : ''}`);
  console.log(`  browser:  ${browserFlag ?? 'chrome'}`);
  console.log('');

  const result = await runAgent({
    apiKey,
    headless,
    keepOpen,
    onLog: (msg) => console.log(`  ${msg}`),
    ...(slowMoRaw ? { slowMo: Number.parseInt(slowMoRaw, 10) } : {}),
    ...(threshold === undefined ? {} : { threshold }),
    ...(minSideRaw ? { minImageSide: Number.parseInt(minSideRaw, 10) } : {}),
    ambiguity,
    ...(visionModel ? { visionModel } : {}),
    ...(targetFlag ? { targetUrl: targetFlag === 'demo' ? DEMO_URL : targetFlag } : {}),
    decision: decisionFlag,
    ...(jevModel ? { jevModel } : {}),
    ...(maxAttemptsRaw ? { maxAttempts: Number.parseInt(maxAttemptsRaw, 10) } : {}),
    ...(debugDir ? { debugDir } : {}),
    ...(browserFlag === 'firefox' ? { browser: 'firefox' as const } : {}),
  });

  const avg = (arr: number[]): number => (arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length);

  console.log('');
  console.log('═══════════════════════════════════════════════');
  console.log(`  Kết quả:   ${result.passed ? '✓ PASS' : '✗ FAIL'}`);
  console.log(`  Lý do:     ${result.reason}`);
  console.log(`  Challenge: ${result.attempts}`);
  console.log(`  Thời gian: ${(result.durationMs / 1000).toFixed(1)}s`);
  console.log(`  Chi phí:   $${result.costUsd.toFixed(6)}`);
  if (result.visionMs.length > 0) {
    console.log(`  Vision:    ${result.visionMs.length} lượt · trung bình ${avg(result.visionMs).toFixed(0)}ms`);
    console.log(`  JEV:       ${result.jevMs.length} lượt · trung bình ${avg(result.jevMs).toFixed(0)}ms`);
  }
  if (result.jevFailures > 0) {
    console.log(`  JEV hỏng:  ${result.jevFailures} lượt — đã rơi về phán đoán của vision`);
  }
  if (result.visionFallbacks > 0) {
    console.log(`  Lùi vision: ${result.visionFallbacks} lượt — JEV ảnh không dùng được`);
  }
  console.log('═══════════════════════════════════════════════');
  process.exit(result.passed ? 0 : 1);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
