// language: TypeScript, file: src/metrics/report.ts, runtime: Node 22
// Sinh report.json + report.md từ dữ liệu thô trong store (spec metrics-report).
// Mọi con số ở đây đọc từ bảng `attempts` — không tính lại từ ký ức của pool.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AttemptRow, RunRow, Store } from '../server/store.js';
import { CATEGORIES, DIFFICULTIES, type Category, type Difficulty } from '../domain/challenge.js';

export interface LatencyStats {
  p50: number;
  p95: number;
  max: number;
}

export interface ScalingPoint {
  workers: number;
  trials: number;
  wallMs: number;
  throughputPerMin: number;
}

export interface JudgeSummary {
  ran: boolean;
  /** Số attempt không được judge (lời gọi lỗi hoặc bị tắt). */
  unjudged: number;
  failureCause: Record<string, number>;
  meanSeverity: number | null;
  ambiguousCount: number;
}

export interface Report {
  runId: string;
  startedAt: number;
  finishedAt: number | null;
  config: RunRow['config'];
  totals: { attempts: number; ok: number; solveRate: number };
  byCategory: Record<string, { attempts: number; ok: number; solveRate: number | null }>;
  byDifficulty: Record<string, { attempts: number; ok: number; solveRate: number | null }>;
  latency: { solverMs: LatencyStats | null; totalMs: LatencyStats | null };
  usage: { inputTokens: number; outputTokens: number; costUsd: number };
  failures: Record<string, number>;
  coordSource: Record<string, number>;
  scaling: ScalingPoint[];
  judge: JudgeSummary;
}

const percentile = (sorted: readonly number[], p: number): number => {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? 0;
};

const latencyStats = (values: readonly number[]): LatencyStats | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted[sorted.length - 1] ?? 0,
  };
};

const rate = (ok: number, total: number): number | null => (total === 0 ? null : ok / total);

export interface BuildReportInput {
  runId: string;
  store: Store;
  scaling?: ScalingPoint[];
  judge?: JudgeSummary;
}

export function buildReport(input: BuildReportInput): Report {
  const { runId, store } = input;
  const run = store.getRun(runId);
  if (!run) throw new Error(`không có run: ${runId}`);

  const attempts: AttemptRow[] = store.listAttempts(runId);

  const byCategory: Report['byCategory'] = {};
  const byDifficulty: Report['byDifficulty'] = {};
  for (const c of CATEGORIES) byCategory[c] = { attempts: 0, ok: 0, solveRate: null };
  for (const d of DIFFICULTIES) byDifficulty[d] = { attempts: 0, ok: 0, solveRate: null };

  const failures: Record<string, number> = {
    timeout: 0,
    bad_schema: 0,
    click_outside_grid: 0,
    wrong_tiles: 0,
    expired: 0,
    judge_error: 0,
  };
  const coordSource: Record<string, number> = { model: 0, derived: 0, none: 0 };
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;

  let ok = 0;
  for (const a of attempts) {
    if (a.ok) ok += 1;
    else {
      const key = a.failureReason ?? 'unknown';
      failures[key] = (failures[key] ?? 0) + 1;
    }
    coordSource[a.coordSource ?? 'none'] = (coordSource[a.coordSource ?? 'none'] ?? 0) + 1;
    inputTokens += a.inputTokens ?? 0;
    outputTokens += a.outputTokens ?? 0;
    costUsd += a.costUsd ?? 0;

    const challenge = store.getChallenge(a.challengeId);
    if (challenge) {
      const cat = byCategory[challenge.target];
      if (cat) {
        cat.attempts += 1;
        if (a.ok) cat.ok += 1;
        cat.solveRate = rate(cat.ok, cat.attempts);
      }
      const diff = byDifficulty[challenge.difficulty as Difficulty];
      if (diff) {
        diff.attempts += 1;
        if (a.ok) diff.ok += 1;
        diff.solveRate = rate(diff.ok, diff.attempts);
      }
    }
  }

  return {
    runId,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    config: run.config,
    totals: { attempts: attempts.length, ok, solveRate: rate(ok, attempts.length) ?? 0 },
    byCategory,
    byDifficulty,
    latency: {
      solverMs: latencyStats(attempts.map((a) => a.solverMs ?? 0).filter((v) => v > 0)),
      totalMs: latencyStats(attempts.map((a) => a.totalMs ?? 0).filter((v) => v > 0)),
    },
    usage: { inputTokens, outputTokens, costUsd },
    failures,
    coordSource,
    scaling: input.scaling ?? [],
    judge: input.judge ?? {
      ran: false,
      unjudged: attempts.length,
      failureCause: {},
      meanSeverity: null,
      ambiguousCount: 0,
    },
  };
}

const pct = (value: number | null): string => (value === null ? '—' : `${(value * 100).toFixed(1)}%`);

export function renderReportMarkdown(report: Report): string {
  const lines: string[] = [];
  lines.push(`# Benchmark report — \`${report.runId}\``);
  lines.push('');
  lines.push(`- Solver: \`${report.config.solver}\``);
  lines.push(`- Workers: ${report.config.workers} · Trials: ${report.config.trials}`);
  lines.push(`- Difficulty: ${report.config.difficulty}`);
  lines.push(`- Commit: \`${report.config.commitSha}\``);
  lines.push('');
  lines.push('## Tổng');
  lines.push('');
  lines.push('| | |');
  lines.push('|---|---|');
  lines.push(`| Attempts | ${report.totals.attempts} |`);
  lines.push(`| Đúng | ${report.totals.ok} |`);
  lines.push(`| Solve rate | **${pct(report.totals.solveRate)}** |`);
  lines.push('');
  lines.push('## Theo category');
  lines.push('');
  lines.push('| category | attempts | đúng | solve rate |');
  lines.push('|---|---|---|---|');
  for (const [name, row] of Object.entries(report.byCategory)) {
    lines.push(`| ${name} | ${row.attempts} | ${row.ok} | ${pct(row.solveRate)} |`);
  }
  lines.push('');
  lines.push('## Theo độ khó');
  lines.push('');
  lines.push('| difficulty | attempts | đúng | solve rate |');
  lines.push('|---|---|---|---|');
  for (const [name, row] of Object.entries(report.byDifficulty)) {
    lines.push(`| ${name} | ${row.attempts} | ${row.ok} | ${pct(row.solveRate)} |`);
  }
  lines.push('');
  lines.push('## Độ trễ (ms)');
  lines.push('');
  lines.push('| | p50 | p95 | max |');
  lines.push('|---|---|---|---|');
  const s = report.latency.solverMs;
  const t = report.latency.totalMs;
  lines.push(`| solverMs | ${s?.p50 ?? '—'} | ${s?.p95 ?? '—'} | ${s?.max ?? '—'} |`);
  lines.push(`| totalMs | ${t?.p50 ?? '—'} | ${t?.p95 ?? '—'} | ${t?.max ?? '—'} |`);
  lines.push('');
  lines.push('## Phân rã thất bại');
  lines.push('');
  lines.push('| lý do | số |');
  lines.push('|---|---|');
  let failureTotal = 0;
  for (const [reason, count] of Object.entries(report.failures)) {
    lines.push(`| ${reason} | ${count} |`);
    failureTotal += count;
  }
  lines.push(`| **tổng** | **${failureTotal}** |`);
  lines.push('');
  lines.push(`Số attempt thất bại: ${report.totals.attempts - report.totals.ok}`);
  lines.push('');
  lines.push('## Nguồn toạ độ');
  lines.push('');
  lines.push('| nguồn | số |');
  lines.push('|---|---|');
  for (const [src, count] of Object.entries(report.coordSource)) {
    lines.push(`| ${src} | ${count} |`);
  }
  lines.push('');
  if (report.scaling.length > 0) {
    lines.push('## Đường cong scaling');
    lines.push('');
    lines.push('| workers | trials | wallMs | throughput/phút |');
    lines.push('|---|---|---|---|');
    for (const p of report.scaling) {
      lines.push(`| ${p.workers} | ${p.trials} | ${p.wallMs} | ${p.throughputPerMin.toFixed(1)} |`);
    }
    lines.push('');
  }
  lines.push('## Judge');
  lines.push('');
  if (!report.judge.ran) {
    lines.push('Judge không chạy cho run này.');
  } else {
    lines.push(`- Attempt không được judge: ${report.judge.unjudged}`);
    lines.push(`- Challenge bị đánh dấu mơ hồ: ${report.judge.ambiguousCount}`);
    lines.push(
      `- Severity trung bình: ${report.judge.meanSeverity === null ? '—' : report.judge.meanSeverity.toFixed(2)}`,
    );
    lines.push('');
    lines.push('| failureCause | số |');
    lines.push('|---|---|');
    for (const [cause, count] of Object.entries(report.judge.failureCause)) {
      lines.push(`| ${cause} | ${count} |`);
    }
  }
  lines.push('');
  lines.push('> Kết luận chỉ áp dụng cho phân bố dữ liệu đã đo.');
  lines.push('');
  return lines.join('\n');
}

export function writeReport(report: Report, outDir: string): { json: string; md: string } {
  mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, 'report.json');
  const mdPath = path.join(outDir, 'report.md');
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeFileSync(mdPath, renderReportMarkdown(report), 'utf8');
  return { json: jsonPath, md: mdPath };
}

export type { Category };
