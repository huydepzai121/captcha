// language: TypeScript, file: src/worker/worker.ts, runtime: Node 22
// Vòng đời một worker: SPAWNED → EXECUTING → VERIFYING → COMPLETE | FAILED.
// Mỗi chuyển trạng thái phát một event ra event bus.

import type { BrowserContext, Page } from 'playwright';
import { pointToTile, type ClickSolver } from '../domain/solver.js';
import { installGuard } from './guard.js';
import type { SimEventLike, WorkerEvent } from '../server/app.js';

export type WorkerState = 'SPAWNED' | 'EXECUTING' | 'VERIFYING' | 'COMPLETE' | 'FAILED';

export interface TrialOutcome {
  workerId: number;
  challengeId: string;
  ok: boolean;
  selected: number[];
  latencyMs: number;
  solverMs: number;
  totalMs: number;
  failureReason: string | null;
  coordSource: 'model' | 'derived' | null;
}

export interface RunTrialInput {
  workerId: number;
  baseUrl: string;
  context: BrowserContext;
  solver: ClickSolver;
  difficulty: string;
  emit: (ev: SimEventLike) => void;
  runId: string;
  timeoutMs?: number;
}

const DEFAULT_TRIAL_TIMEOUT_MS = 45_000;

/** Một lượt trọn vẹn: xin đề → giải → nộp. Không retry (spec: "Không thử lại"). */
export async function runTrial(input: RunTrialInput): Promise<TrialOutcome> {
  const { workerId, baseUrl, context, solver, emit, runId } = input;
  const totalStart = Date.now();
  let page: Page | null = null;
  let challengeId = '';
  let solverMs = 0;
  let coordSource: 'model' | 'derived' | null = null;

  const say = (state: WorkerState, detail?: string): void => {
    const ev: WorkerEvent = {
      type: 'worker',
      workerId,
      challengeId,
      state,
      ts: Date.now(),
      ...(detail === undefined ? {} : { detail }),
    };
    emit(ev);
  };

  try {
    say('SPAWNED');
    await installGuard(context);

    const res = await fetch(`${baseUrl}/api/challenges`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ runId, difficulty: input.difficulty }),
    });
    if (!res.ok) throw new Error(`cấp challenge thất bại: HTTP ${res.status}`);
    const challenge = (await res.json()) as {
      id: string;
      instruction: string;
      grid: { cols: number; rows: number };
      imageUrl: string;
    };
    challengeId = challenge.id;

    page = await context.newPage();
    await page.goto(`${baseUrl}/c/${challengeId}`, { waitUntil: 'domcontentloaded' });

    const gridEl = page.locator('.grid-wrap');
    await gridEl.waitFor({ state: 'visible', timeout: 10_000 });

    say('EXECUTING');
    const box = await gridEl.boundingBox();
    if (!box) throw new Error('không lấy được boundingBox của lưới');
    const screenshot = await gridEl.screenshot({ type: 'png' });

    const solverStart = Date.now();
    const gridBox = { x: box.x, y: box.y, w: box.width, h: box.height };
    const result = await solver.solve({
      screenshot,
      instruction: challenge.instruction,
      grid: challenge.grid,
      gridBox,
      challengeId,
    });
    solverMs = Date.now() - solverStart;
    coordSource = result.coordSource;

    const selected = new Set<number>();
    for (const click of result.clicks) {
      const tile = pointToTile(click, gridBox, challenge.grid);
      if (tile === null) continue;
      selected.add(tile);
      const target = page.locator(`.cell[data-tile-index="${tile}"]`);
      await target.click({ timeout: 5_000 });
      emit({ type: 'click', workerId, challengeId, tile });
    }

    say('VERIFYING', `chọn ${selected.size} ô`);
    const verifyRes = await fetch(`${baseUrl}/api/challenges/${challengeId}/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        selected: [...selected].sort((a, b) => a - b),
        solver: solver.name,
        workerId,
        latencyMs: solverMs,
        solverMs,
        totalMs: Date.now() - totalStart,
        coordSource: result.coordSource,
        ...(result.usage ? { usage: result.usage } : {}),
      }),
    });
    const verdict = (await verifyRes.json().catch(() => ({}))) as { ok?: boolean };

    const ok = verifyRes.ok && verdict.ok === true;
    say(ok ? 'COMPLETE' : 'FAILED', `HTTP ${verifyRes.status}`);

    return {
      workerId,
      challengeId,
      ok,
      selected: [...selected].sort((a, b) => a - b),
      latencyMs: solverMs,
      solverMs,
      totalMs: Date.now() - totalStart,
      failureReason: ok ? null : verifyRes.ok ? 'wrong_tiles' : `http_${verifyRes.status}`,
      coordSource,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const reason = /quá \d+ms|timeout/i.test(message) ? 'timeout' : 'bad_schema';
    say('FAILED', message);
    return {
      workerId,
      challengeId,
      ok: false,
      selected: [],
      latencyMs: solverMs,
      solverMs,
      totalMs: Date.now() - totalStart,
      failureReason: reason,
      coordSource,
    };
  } finally {
    await page?.close().catch(() => {});
  }
}

export const TRIAL_TIMEOUT_HINT = DEFAULT_TRIAL_TIMEOUT_MS;
