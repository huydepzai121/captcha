// So hai cấu hình trên cùng một trang mẫu: bản cũ (ảnh gốc, ngưỡng trần) với
// bản siết (phóng ảnh nhỏ + soát lại từng ô mơ hồ). Đếm tỉ lệ pass thật.
//
// Chạy: npx tsx scripts/bench-jev-tuning.ts --trials 6 [--target url]

import { rmSync } from 'node:fs';
import path from 'node:path';
import { runAgent } from '../agent/demo-agent.js';
import { requireApiKey } from '../agent/config.js';
import { loadDotEnv } from '../agent/env.js';

loadDotEnv();

const args = process.argv.slice(2);
const get = (f: string): string | undefined => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};

const trials = Number.parseInt(get('--trials') ?? '6', 10);
const target = get('--target') ?? 'http://127.0.0.1:3400/';
const MAX_ATTEMPTS = 20;
const BUDGET_MS = 240_000;

interface Arm {
  name: string;
  minImageSide: number;
  ambiguity: boolean;
}

const arms: Arm[] = [
  { name: 'cũ · ảnh gốc 280 · không soát', minImageSide: 280, ambiguity: false },
  { name: 'mới · phóng 768 · soát ô mơ hồ', minImageSide: 768, ambiguity: true },
];

const pad = (s: string, n: number): string => s.padEnd(n);

const rows: Array<{ arm: string; pass: boolean; attempts: number; seconds: number; cost: number }> = [];

for (const arm of arms) {
  console.log(`\n── ${arm.name}`);
  for (let trial = 1; trial <= trials; trial += 1) {
    const profile = `tune-${Date.now().toString(36)}-${trial}`;
    const t0 = Date.now();
    const silence = (): void => {};
    try {
      const result = await runAgent({
        apiKey: requireApiKey(),
        headless: true,
        targetUrl: target,
        profile,
        threshold: 0.5,
        maxAttempts: MAX_ATTEMPTS,
        budgetMs: BUDGET_MS,
        minImageSide: arm.minImageSide,
        ambiguity: arm.ambiguity,
        onLog: silence,
      });
      const seconds = (Date.now() - t0) / 1000;
      rows.push({ arm: arm.name, pass: result.passed, attempts: result.attempts, seconds, cost: result.costUsd });
      console.log(
        `  trial ${trial}/${trials}: ${result.passed ? 'PASS' : 'FAIL'} · ${result.attempts} challenge · ` +
          `${seconds.toFixed(0)}s · $${result.costUsd.toFixed(5)}`,
      );
    } catch (err) {
      const seconds = (Date.now() - t0) / 1000;
      rows.push({ arm: arm.name, pass: false, attempts: 0, seconds, cost: 0 });
      console.log(`  trial ${trial}/${trials}: LỖI · ${err instanceof Error ? err.message.slice(0, 80) : ''}`);
    } finally {
      rmSync(path.join('runs', `pw-profile-chrome-${profile}`), { recursive: true, force: true });
    }
  }
}

const avg = (xs: number[], digits = 1): string =>
  xs.length === 0 ? '—' : (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(digits);

console.log('\n── tổng hợp');
for (const arm of arms) {
  const mine = rows.filter((r) => r.arm === arm.name);
  const passed = mine.filter((r) => r.pass).length;
  console.log(
    `${pad(arm.name, 34)} pass ${passed}/${mine.length} · challenge TB ${avg(mine.map((r) => r.attempts))} · ` +
      `giây TB ${avg(mine.map((r) => r.seconds))} · $ TB ${avg(mine.map((r) => r.cost), 5)}`,
  );
}
