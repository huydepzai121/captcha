// language: TypeScript, file: src/judge/cli.ts, runtime: Node 22
// `pnpm judge --run-id <id> [--limit N] [--zdr]` — chấm lại một run đã xong.
//
// Judge chạy sau run, không nằm trong vòng lặp worker. Nó chỉ ghi thêm giải thích,
// không đụng vào pass/fail hay solve rate.

import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Store } from '../server/store.js';
import { runJudge } from './run.js';

interface JudgeCliOptions {
  runId: string;
  limit?: number;
  zeroDataRetention: boolean;
  only?: string[];
  model?: string;
}

const parseArgs = (argv: readonly string[]): JudgeCliOptions => {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const limitRaw = get('--limit');
  const onlyRaw = get('--only');
  const runId = get('--run-id');
  if (!runId) throw new Error('thiếu --run-id');

  return {
    runId,
    ...(limitRaw ? { limit: Number.parseInt(limitRaw, 10) } : {}),
    zeroDataRetention: argv.includes('--zdr'),
    ...(onlyRaw ? { only: onlyRaw.split(',').map((s) => s.trim()) } : {}),
    ...(get('--model') ? { model: get('--model') as string } : {}),
  };
};

const main = async (): Promise<void> => {
  const opts = parseArgs(process.argv.slice(2));
  const rootDir = process.cwd();
  mkdirSync(path.join(rootDir, 'runs'), { recursive: true });
  const store = new Store(path.join(rootDir, 'runs', 'bench.sqlite'));

  const run = store.getRun(opts.runId);
  if (!run) throw new Error(`không có run: ${opts.runId}`);

  const summary = await runJudge({
    store,
    runId: opts.runId,
    rootDir,
    zeroDataRetention: opts.zeroDataRetention,
    ...(opts.limit === undefined ? {} : { limit: opts.limit }),
    ...(opts.only === undefined ? {} : { only: opts.only }),
    ...(opts.model === undefined ? {} : { model: opts.model }),
  });

  const outPath = path.join(rootDir, 'runs', opts.runId, 'judge.json');
  writeFileSync(
    outPath,
    `${JSON.stringify(
      {
        runId: opts.runId,
        judged: summary.judged,
        unjudged: summary.unjudged,
        failureCause: summary.failureCause,
        meanSeverity: summary.meanSeverity,
        ambiguousCount: summary.ambiguousCount,
        rows: summary.rows,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  console.log(
    `[judge] ${summary.judged} lượt chấm · ${summary.unjudged} không chấm được → ${path.relative(rootDir, outPath)}`,
  );
  store.close();
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
