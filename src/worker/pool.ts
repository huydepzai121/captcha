// language: TypeScript, file: src/worker/pool.ts, runtime: Node 22
// Pool N worker song song. Mỗi worker một browser context riêng.
// Bắt SIGINT/SIGTERM, đóng mọi context trước khi thoát (spec: "Dọn tiến trình").

import { chromium, type Browser, type BrowserContext } from 'playwright';
import type { ClickSolver } from '../domain/solver.js';
import { runTrial, type TrialOutcome } from './worker.js';
import type { SimEventLike } from '../server/app.js';

export interface PoolOptions {
  baseUrl: string;
  runId: string;
  solver: ClickSolver;
  difficulty: string;
  workers: number;
  trials: number;
  headless: boolean;
  emit: (ev: SimEventLike) => void;
}

export interface PoolResult {
  outcomes: TrialOutcome[];
  wallMs: number;
}

export class WorkerPool {
  private browser: Browser | null = null;
  private readonly contexts = new Set<BrowserContext>();
  private stopping = false;

  private readonly onSignal = (): void => {
    this.stopping = true;
    void this.shutdown();
  };

  async shutdown(): Promise<void> {
    for (const ctx of this.contexts) {
      await ctx.close().catch(() => {});
    }
    this.contexts.clear();
    await this.browser?.close().catch(() => {});
    this.browser = null;
  }

  async run(opts: PoolOptions): Promise<PoolResult> {
    const { baseUrl, runId, solver, difficulty, workers, trials, headless, emit } = opts;
    const t0 = Date.now();

    process.once('SIGINT', this.onSignal);
    process.once('SIGTERM', this.onSignal);

    this.browser = await chromium.launch({ headless });

    const outcomes: TrialOutcome[] = new Array(trials);
    let next = 0;
    let live = 0;

    await new Promise<void>((resolve) => {
      const pump = (): void => {
        if (this.stopping) {
          if (live === 0) resolve();
          return;
        }
        while (live < workers && next < trials) {
          const index = next;
          next += 1;
          live += 1;
          const workerId = index % workers;

          void (async () => {
            let context: BrowserContext | null = null;
            try {
              context = await this.browser!.newContext({ viewport: { width: 900, height: 900 } });
              this.contexts.add(context);
              outcomes[index] = await runTrial({
                workerId,
                baseUrl,
                context,
                solver,
                difficulty,
                emit,
                runId,
              });
              emit({
                type: 'progress',
                done: outcomes.filter(Boolean).length,
                total: trials,
                ts: Date.now(),
              });
            } catch (err) {
              outcomes[index] = {
                workerId,
                challengeId: '',
                ok: false,
                selected: [],
                latencyMs: 0,
                solverMs: 0,
                totalMs: 0,
                failureReason: 'bad_schema',
                coordSource: null,
              };
              emit({
                type: 'log',
                status: 'FAILED',
                message: err instanceof Error ? err.message : String(err),
                ts: Date.now(),
              });
            } finally {
              if (context) {
                this.contexts.delete(context);
                await context.close().catch(() => {});
              }
              live -= 1;
              if (next >= trials && live === 0) resolve();
              else pump();
            }
          })();
        }
        if (live === 0 && next >= trials) resolve();
      };
      pump();
    });

    process.removeListener('SIGINT', this.onSignal);
    process.removeListener('SIGTERM', this.onSignal);

    await this.shutdown();
    return { outcomes: outcomes.filter(Boolean), wallMs: Date.now() - t0 };
  }
}
