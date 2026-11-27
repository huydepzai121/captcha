// language: TypeScript, file: src/bench/cli.ts, runtime: Node 22
// `pnpm bench` — chạy benchmark trọn vòng: dựng server, chạy pool, ghi report.
//
// Cờ: --workers N --trials N --solver NAME --difficulty LEVEL --run-id ID --judge MODE

import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { buildServer, HOST } from '../server/app.js';
import { Store, type RunConfig } from '../server/store.js';
import { createRegistry, type SolverRegistry } from '../solvers/index.js';
import { WorkerPool } from '../worker/pool.js';
import { buildReport, writeReport } from '../metrics/report.js';
import { runJudge, type JudgeRunSummary } from '../judge/run.js';

const PORT = 3000;

export interface CliOptions {
  workers: number;
  trials: number;
  solver: string;
  difficulty: string;
  runId: string;
  judge: 'off' | 'after';
  headless: boolean;
}

const parseArgs = (argv: readonly string[]): CliOptions => {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  const workers = Number.parseInt(get('--workers') ?? '8', 10);
  const trials = Number.parseInt(get('--trials') ?? '50', 10);
  const judgeRaw = get('--judge') ?? 'off';

  return {
    workers: Number.isFinite(workers) && workers > 0 ? workers : 8,
    trials: Number.isFinite(trials) && trials > 0 ? trials : 50,
    solver: get('--solver') ?? 'random',
    difficulty: get('--difficulty') ?? 'medium',
    runId: get('--run-id') ?? `run-${Date.now().toString(36)}`,
    judge: judgeRaw === 'after' ? 'after' : 'off',
    headless: get('--headful') === undefined,
  };
};

const gitSha = (): string => {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
};

export async function runBench(opts: CliOptions): Promise<{ runId: string; reportPath: string }> {
  const rootDir = process.cwd();
  const runsDir = path.join(rootDir, 'runs');
  mkdirSync(runsDir, { recursive: true });
  const store = new Store(path.join(runsDir, 'bench.sqlite'));

  const registry: SolverRegistry = createRegistry({
    rootDir,
    groundTruthFor: (challengeId) => store.getChallenge(challengeId)?.tiles ?? null,
  });

  // Resolve solver TRƯỚC khi tạo run — cấu hình sai phải chết sạch, không để lại
  // một run rỗng trong store.
  let solver;
  try {
    solver = registry.resolve(opts.solver);
  } catch (err) {
    store.close();
    console.error(`[bench] không dùng được solver "${opts.solver}": ${err instanceof Error ? err.message : String(err)}`);
    console.error(`[bench] solver có sẵn: ${registry.names.join(', ')}`);
    throw err;
  }

  const config: RunConfig = {
    solver: opts.solver,
    workers: opts.workers,
    trials: opts.trials,
    difficulty: opts.difficulty,
    seedStart: 0,
    commitSha: gitSha(),
  };
  store.createRun(opts.runId, config);

  const { app, bus } = await buildServer({ rootDir, store });
  await app.listen({ port: PORT, host: HOST });
  const baseUrl = `http://${HOST}:${PORT}`;

  console.log(`[bench] pid=${process.pid} port=${PORT} run=${opts.runId}`);
  console.log(`[bench] dashboard → ${baseUrl}/`);
  console.log(
    `[bench] solver=${opts.solver} workers=${opts.workers} trials=${opts.trials} difficulty=${opts.difficulty}`,
  );

  const pool = new WorkerPool();
  const { outcomes, wallMs } = await pool.run({
    baseUrl,
    runId: opts.runId,
    solver,
    difficulty: opts.difficulty,
    workers: opts.workers,
    trials: opts.trials,
    headless: opts.headless,
    emit: (ev) => bus.push(ev),
  });

  const ok = outcomes.filter((o) => o.ok).length;
  console.log(
    `[bench] xong: ${ok}/${outcomes.length} đúng (${((ok / Math.max(1, outcomes.length)) * 100).toFixed(1)}%) · ${wallMs}ms`,
  );

  let judgeSummary: JudgeRunSummary | undefined;
  if (opts.judge === 'after') {
    judgeSummary = await runJudge({ store, runId: opts.runId, rootDir });
    console.log(
      `[bench] judge: ${judgeSummary.judged} lượt chấm, ${judgeSummary.unjudged} không chấm được`,
    );
  }

  store.finishRun(opts.runId);

  const report = buildReport({
    runId: opts.runId,
    store,
    scaling: [
      {
        workers: opts.workers,
        trials: opts.trials,
        wallMs,
        throughputPerMin: (outcomes.length / Math.max(1, wallMs)) * 60_000,
      },
    ],
    ...(judgeSummary
      ? {
          judge: {
            ran: true,
            unjudged: judgeSummary.unjudged,
            failureCause: judgeSummary.failureCause,
            meanSeverity: judgeSummary.meanSeverity,
            ambiguousCount: judgeSummary.ambiguousCount,
          },
        }
      : {}),
  });

  const outDir = path.join(rootDir, 'runs', opts.runId);
  const paths = writeReport(report, outDir);

  await app.close();
  store.close();

  console.log(`[bench] report → ${path.relative(rootDir, paths.json)} · ${path.relative(rootDir, paths.md)}`);
  return { runId: opts.runId, reportPath: paths.json };
}

const isMain = process.argv[1] !== undefined && import.meta.url.endsWith(path.basename(process.argv[1]));

if (isMain) {
  runBench(parseArgs(process.argv.slice(2)))
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      // Lỗi cấu hình đã được in rõ ở tầng gọi; không đổ stack trace vô nghĩa.
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes('solver') && !message.includes('--run-id')) {
        console.error(err);
      }
      process.exit(1);
    });
}
