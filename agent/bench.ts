// language: TypeScript, file: agent/bench.ts, runtime: Node 22
// Benchmark trên reCAPTCHA THẬT: chạy agent N lần, đo tỉ lệ pass.
//
// Chạy:
//   pnpm bench:demo --trials 20 --workers 2 --model anthropic/claude-haiku-4.5
//   node --env-file=.env --import tsx agent/bench.ts --trials 20 --workers 2
//
// Khác với `pnpm bench`: harness kia tự sinh đề và tự giữ đáp án, nên đo được
// từng ô. Ở đây đề và đáp án đều của Google — chỉ đo được pass/fail cuối cùng,
// cộng số challenge đã đi qua và chi phí.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { runAgent } from './demo-agent.js';
import { VISION_MODEL } from './vision.js';
import { loadDotEnv } from './env.js';

loadDotEnv();

const sleep = (ms: number): Promise<void> => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
};

// ── cờ dòng lệnh ─────────────────────────────────────────────────────
const args = process.argv.slice(2);
const get = (flag: string): string | undefined => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

/** Chấp nhận cả `vision:model` và `--model model`. */
const parseModel = (): string => {
  const raw = get('--model') ?? get('--solver') ?? '';
  if (raw.startsWith('vision:')) return raw.slice('vision:'.length);
  if (raw && raw !== 'vision') return raw;
  return VISION_MODEL;
};

const model = parseModel();
const trials = Number.parseInt(get('--trials') ?? '10', 10);
// Mặc định 1: chạy nhiều chromium song song trên CPU ít nhân làm mỗi phiên
// chậm đi, và reCAPTCHA hết hạn challenge sau ~2 phút. Song song ở đây đổi
// thông lượng lấy tỉ lệ hết hạn — không đáng.
const workers = Number.parseInt(get('--workers') ?? '1', 10);
const maxAttempts = Number.parseInt(get('--max-attempts') ?? '35', 10);
const headless = !args.includes('--headful');
/** Nghỉ giữa hai trial trong cùng một worker, ms. */
const cooldownMs = Number.parseInt(get('--cooldown') ?? '2000', 10);
const browserFlag = get('--browser') ?? 'chrome';
const targetFlag = get('--target');
const freshProfile = args.includes('--fresh');
const runId = get('--run-id') ?? `recaptcha-${Date.now().toString(36)}`;

const apiKey = process.env.AI_GATEWAY_API_KEY;
if (!apiKey) {
  console.error('AI_GATEWAY_API_KEY chưa set — cần key để gọi model');
  process.exit(1);
}

// ── dashboard trên port 3000 ─────────────────────────────────────────
const PORT = 3000;
const HOST = '127.0.0.1';
const RING_LIMIT = 500;

interface DashEvent {
  type: string;
  [key: string]: unknown;
}

class EventBus {
  private readonly ring: DashEvent[] = [];
  private readonly clients = new Set<{ send: (d: string) => void; readyState: number; OPEN: number }>();

  push(ev: DashEvent): void {
    this.ring.push(ev);
    if (this.ring.length > RING_LIMIT) this.ring.shift();
    const payload = JSON.stringify(ev);
    for (const c of this.clients) {
      if (c.readyState === c.OPEN) c.send(payload);
    }
  }

  add(c: { send: (d: string) => void; readyState: number; OPEN: number }): void {
    this.clients.add(c);
    for (const ev of this.ring) c.send(JSON.stringify(ev));
  }

  remove(c: { send: (d: string) => void; readyState: number; OPEN: number }): void {
    this.clients.delete(c);
  }
}

const bus = new EventBus();

const startDashboard = async (): Promise<FastifyInstance> => {
  const app = Fastify({ logger: false });
  await app.register(fastifyWebsocket);
  await app.register(fastifyStatic, { root: path.join(process.cwd(), 'public') });

  app.get('/ws', { websocket: true }, (socket) => {
    const client = socket as unknown as { send: (d: string) => void; readyState: number; OPEN: number };
    bus.add(client);
    socket.on('close', () => bus.remove(client));
  });

  try {
    await app.listen({ port: PORT, host: HOST });
  } catch {
    console.error(
      `không mở được dashboard tại ${HOST}:${PORT} — port đang bị một tiến trình khác giữ ` +
        `(vd. một "pnpm serve" hay bench cũ còn sống). Đóng nó rồi chạy lại.`,
    );
    process.exit(1);
  }
  console.log(`  dashboard → http://${HOST}:${PORT}\n`);
  return app;
};

// ── một trial ────────────────────────────────────────────────────────
export interface TrialResult {
  index: number;
  passed: boolean;
  challenges: number;
  durationMs: number;
  costUsd: number;
  reason: string;
  visionCalls: number;
  jevCalls: number;
  jevFailures: number;
}

const runOne = async (index: number): Promise<TrialResult> => {
  const slot = index % Math.max(1, workers);
  bus.push({
    type: 'worker',
    workerId: slot,
    challengeId: `trial-${index + 1}`,
    state: 'SPAWNED',
    ts: Date.now(),
    detail: model,
  });

  const result = await runAgent({
    apiKey,
    headless,
    browser: browserFlag as 'chrome' | 'firefox',
    visionModel: model,
    ...(targetFlag ? { targetUrl: targetFlag } : {}),
    ...(freshProfile ? { profile: `t${index}-${Date.now().toString(36)}` } : {}),
    onLog: (msg) => {
      // Chỉ đẩy log nghiệp vụ lên dashboard, bỏ qua log nội bộ dài dòng
      if (/^(──|   lượt|   JEV:|   đang chọn|   tick|   verify|   ô nằm vùng|   recall)/.test(msg)) {
        bus.push({ type: 'log', status: 'INFO', message: `trial ${index + 1}: ${msg.trim()}`, ts: Date.now() });
      }
    },
  });

  bus.push({
    type: 'worker',
    workerId: slot,
    challengeId: `trial-${index + 1}`,
    state: result.passed ? 'COMPLETE' : 'FAILED',
    ts: Date.now(),
    detail: result.reason,
  });

  return {
    index,
    passed: result.passed,
    challenges: result.attempts,
    durationMs: result.durationMs,
    costUsd: result.costUsd,
    reason: result.reason,
    visionCalls: result.visionMs.length,
    jevCalls: result.jevMs.length,
    jevFailures: result.jevFailures,
  };
};

// ── pool ─────────────────────────────────────────────────────────────
const main = async (): Promise<void> => {
  console.log('── bench trên reCAPTCHA ──────────────────────');
  console.log(`  model:   ${model}`);
  console.log(`  trials:  ${trials} · workers: ${workers}`);
  console.log(`  headless: ${headless} · maxAttempts: ${maxAttempts} · browser: ${browserFlag ?? 'chrome'}`);

  const app = await startDashboard();

  const results: TrialResult[] = [];
  let next = 0;
  let live = 0;

  await new Promise<void>((resolve) => {
    const pump = (): void => {
      while (live < workers && next < trials) {
        const index = next;
        next += 1;
        live += 1;

        void (async () => {
          try {
            const r = await runOne(index);
            results[index] = r;
            const soFar = results.filter(Boolean);
            const passed = soFar.filter((x) => x.passed).length;
            console.log(
              `  [${String(index + 1).padStart(3)}/${trials}] ${r.passed ? 'PASS' : 'FAIL'} · ${r.challenges} challenge · ${(r.durationMs / 1000).toFixed(0)}s · ${r.costUsd.toFixed(5)} · chạy dần ${passed}/${soFar.length}`,
            );
            bus.push({ type: 'progress', done: soFar.length, total: trials, passed, ts: Date.now() });
          } catch (err) {
            results[index] = {
              index,
              passed: false,
              challenges: 0,
              durationMs: 0,
              costUsd: 0,
              reason: err instanceof Error ? err.message : String(err),
              visionCalls: 0,
              jevCalls: 0,
              jevFailures: 0,
            };
            console.log(`  [${String(index + 1).padStart(3)}/${trials}] LỖI ${results[index]?.reason.slice(0, 80)}`);
          } finally {
            live -= 1;
            if (cooldownMs > 0) await sleep(cooldownMs);
            if (next >= trials && live === 0) resolve();
            else pump();
          }
        })();
      }
      if (live === 0 && next >= trials) resolve();
    };
    pump();
  });

  const done = results.filter(Boolean);
  const passed = done.filter((r) => r.passed);
  const rate = done.length === 0 ? 0 : passed.length / done.length;
  const avg = (f: (r: TrialResult) => number): number =>
    done.length === 0 ? 0 : done.reduce((s, r) => s + f(r), 0) / done.length;

  const jevFailures = done.reduce((s, r) => s + r.jevFailures, 0);

  console.log('');
  console.log('═══════════════════════════════════════════════');
  console.log(`  Pass:        ${passed.length}/${done.length}  (${(rate * 100).toFixed(1)}%)`);
  console.log(`  Thời gian:   trung bình ${(avg((r) => r.durationMs) / 1000).toFixed(0)}s/trial`);
  console.log(`  Challenge:   trung bình ${avg((r) => r.challenges).toFixed(1)}/trial`);
  console.log(`  Chi phí:     $${avg((r) => r.costUsd).toFixed(5)}/trial · tổng $${done.reduce((s, r) => s + r.costUsd, 0).toFixed(4)}`);
  if (jevFailures > 0) console.log(`  JEV hỏng:    ${jevFailures} lượt (đã rơi về phán đoán của vision)`);
  console.log('═══════════════════════════════════════════════');

  const outDir = path.join('runs', runId);
  mkdirSync(outDir, { recursive: true });
  const report = {
    runId,
    model,
    trials,
    workers,
    maxAttempts,
    headless,
    startedAt: new Date().toISOString(),
    passed: passed.length,
    total: done.length,
    passRate: rate,
    avgDurationMs: avg((r) => r.durationMs),
    avgChallenges: avg((r) => r.challenges),
    totalCostUsd: done.reduce((s, r) => s + r.costUsd, 0),
    jevFailures,
    results: done,
  };
  writeFileSync(path.join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const md = [
    `# reCAPTCHA benchmark — \`${runId}\``,
    '',
    `- Model: \`${model}\``,
    `- Trials: ${done.length} · Workers: ${workers}`,
    `- Headless: ${headless}`,
    '',
    '| | |',
    '|---|---|',
    `| Pass | **${passed.length}/${done.length} (${(rate * 100).toFixed(1)}%)** |`,
    `| Thời gian trung bình | ${(avg((r) => r.durationMs) / 1000).toFixed(1)}s |`,
    `| Challenge trung bình | ${avg((r) => r.challenges).toFixed(1)} |`,
    `| Chi phí trung bình | $${avg((r) => r.costUsd).toFixed(5)} |`,
    `| Chi phí tổng | $${done.reduce((s, r) => s + r.costUsd, 0).toFixed(4)} |`,
    `| JEV hỏng | ${jevFailures} lượt (rơi về vision) |`,
    '',
    '## Từng trial',
    '',
    '| # | kết quả | challenge | thời gian | chi phí | lý do |',
    '|---|---|---|---|---|---|',
    ...done.map(
      (r) =>
        `| ${r.index + 1} | ${r.passed ? 'PASS' : 'FAIL'} | ${r.challenges} | ${(r.durationMs / 1000).toFixed(0)}s | $${r.costUsd.toFixed(5)} | ${r.reason} |`,
    ),
    '',
    '> Kết luận chỉ áp dụng cho phân bố challenge của trang demo trong khoảng thời gian chạy.',
    '',
  ].join('\n');
  writeFileSync(path.join(outDir, 'report.md'), md, 'utf8');

  console.log(`  report → ${outDir}/report.json · report.md`);
  await app.close();
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
