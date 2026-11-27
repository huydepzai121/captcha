// language: TypeScript, file: src/server/store.ts, runtime: Node 22
// SQLite store cho runs, challenges, attempts (spec challenge-server).
// Ground truth nằm ở đây và KHÔNG BAO GIỜ được serialize ra response.

import Database from 'better-sqlite3';
import type { Category, Difficulty, Tile } from '../domain/challenge.js';
import type { FailureReason } from '../domain/solver.js';

export interface ChallengeRow {
  id: string;
  runId: string;
  seed: number;
  difficulty: Difficulty;
  target: Category;
  grid: { cols: number; rows: number };
  tiles: Tile[];
  splitObjects: Array<{ tileIndexA: number; tileIndexB: number; category: Category }>;
  createdAt: number;
  expiresAt: number;
  verifiedAt: number | null;
}

export interface AttemptRow {
  challengeId: string;
  runId: string;
  selected: number[];
  ok: boolean;
  latencyMs: number;
  solver: string;
  workerId: number;
  submittedAt: number;
  failureReason: FailureReason | null;
  coordSource: 'model' | 'derived' | null;
  solverMs: number | null;
  totalMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
}

export interface UsageRecord {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  costUsd?: number | undefined;
}

export interface AttemptTelemetry {
  solverMs?: number | null;
  totalMs?: number | null;
  coordSource?: 'model' | 'derived' | null;
  usage?: UsageRecord | undefined;
}

export interface RunConfig {
  solver: string;
  workers: number;
  trials: number;
  difficulty: string;
  seedStart: number;
  commitSha: string;
}

export interface RunRow {
  id: string;
  startedAt: number;
  finishedAt: number | null;
  config: RunConfig;
}

export interface VerifyOutcome {
  ok: boolean;
  correct: number;
  wrong: number;
  missed: number;
  latencyMs: number;
}

export type VerifyResult =
  | { status: 'ok'; outcome: VerifyOutcome; attempt: AttemptRow }
  | { status: 'not_found' }
  | { status: 'already_verified' }
  | { status: 'expired' };

/** Gộp telemetry tuỳ chọn thành các cột nullable của `attempts`. */
const telemetryColumns = (
  tel: AttemptTelemetry,
): Pick<AttemptRow, 'coordSource' | 'solverMs' | 'totalMs' | 'inputTokens' | 'outputTokens' | 'costUsd'> => ({
  coordSource: tel.coordSource ?? null,
  solverMs: tel.solverMs ?? null,
  totalMs: tel.totalMs ?? null,
  inputTokens: tel.usage?.inputTokens ?? null,
  outputTokens: tel.usage?.outputTokens ?? null,
  costUsd: tel.usage?.costUsd ?? null,
});

/** Thời gian sống của một challenge (spec: mặc định 120 giây). */
export const CHALLENGE_TTL_MS = 120_000;

export class Store {
  private readonly db: Database.Database;

  constructor(filename = ':memory:') {
    this.db = new Database(filename);
    this.db.pragma('journal_mode = WAL');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id         TEXT PRIMARY KEY,
        startedAt  INTEGER NOT NULL,
        finishedAt INTEGER,
        config     TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS challenges (
        id          TEXT PRIMARY KEY,
        runId       TEXT NOT NULL,
        seed        INTEGER NOT NULL,
        difficulty  TEXT NOT NULL,
        target      TEXT NOT NULL,
        cols        INTEGER NOT NULL,
        rows        INTEGER NOT NULL,
        tiles       TEXT NOT NULL,
        splitObjects TEXT NOT NULL,
        createdAt   INTEGER NOT NULL,
        expiresAt   INTEGER NOT NULL,
        verifiedAt  INTEGER
      );

      CREATE TABLE IF NOT EXISTS attempts (
        challengeId   TEXT PRIMARY KEY,
        runId         TEXT NOT NULL,
        selected      TEXT NOT NULL,
        ok            INTEGER NOT NULL,
        latencyMs     INTEGER NOT NULL,
        solver        TEXT NOT NULL,
        workerId      INTEGER NOT NULL,
        submittedAt   INTEGER NOT NULL,
        failureReason TEXT,
        coordSource   TEXT,
        solverMs      INTEGER,
        totalMs       INTEGER,
        inputTokens   INTEGER,
        outputTokens  INTEGER,
        costUsd       REAL
      );

      CREATE INDEX IF NOT EXISTS idx_challenges_run ON challenges(runId);
      CREATE INDEX IF NOT EXISTS idx_attempts_run ON attempts(runId);
    `);
  }

  createRun(id: string, config: RunConfig, startedAt = Date.now()): void {
    this.db
      .prepare('INSERT INTO runs (id, startedAt, finishedAt, config) VALUES (?, ?, NULL, ?)')
      .run(id, startedAt, JSON.stringify(config));
  }

  finishRun(id: string, finishedAt = Date.now()): void {
    this.db.prepare('UPDATE runs SET finishedAt = ? WHERE id = ?').run(finishedAt, id);
  }

  getRun(id: string): RunRow | null {
    const row = this.db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as
      | { id: string; startedAt: number; finishedAt: number | null; config: string }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      config: JSON.parse(row.config) as RunConfig,
    };
  }

  createChallenge(row: Omit<ChallengeRow, 'verifiedAt'>, verifiedAt: number | null = null): void {
    this.db
      .prepare(
        `INSERT INTO challenges
           (id, runId, seed, difficulty, target, cols, rows, tiles, splitObjects, createdAt, expiresAt, verifiedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.runId,
        row.seed,
        row.difficulty,
        row.target,
        row.grid.cols,
        row.grid.rows,
        JSON.stringify(row.tiles),
        JSON.stringify(row.splitObjects),
        row.createdAt,
        row.expiresAt,
        verifiedAt,
      );
  }

  getChallenge(id: string): ChallengeRow | null {
    const row = this.db.prepare('SELECT * FROM challenges WHERE id = ?').get(id) as
      | {
          id: string;
          runId: string;
          seed: number;
          difficulty: string;
          target: string;
          cols: number;
          rows: number;
          tiles: string;
          splitObjects: string;
          createdAt: number;
          expiresAt: number;
          verifiedAt: number | null;
        }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      runId: row.runId,
      seed: row.seed,
      difficulty: row.difficulty as Difficulty,
      target: row.target as Category,
      grid: { cols: row.cols, rows: row.rows },
      tiles: JSON.parse(row.tiles) as Tile[],
      splitObjects: JSON.parse(row.splitObjects) as ChallengeRow['splitObjects'],
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      verifiedAt: row.verifiedAt,
    };
  }

  /**
   * Chấm bài. Ground truth chỉ được đọc ở đây.
   * Một challenge verify đúng một lần — lần hai trả `already_verified`.
   */
  verify(input: {
    challengeId: string;
    selected: number[];
    solver: string;
    workerId: number;
    latencyMs: number;
    telemetry?: AttemptTelemetry;
    now?: number;
  }): VerifyResult {
    const now = input.now ?? Date.now();
    const tel = input.telemetry ?? {};
    const challenge = this.getChallenge(input.challengeId);
    if (!challenge) return { status: 'not_found' };
    if (challenge.verifiedAt !== null) return { status: 'already_verified' };
    if (now > challenge.expiresAt) {
      this.db
        .prepare('UPDATE challenges SET verifiedAt = ? WHERE id = ?')
        .run(now, input.challengeId);
      this.insertAttempt({
        challengeId: input.challengeId,
        runId: challenge.runId,
        selected: input.selected,
        ok: false,
        latencyMs: input.latencyMs,
        solver: input.solver,
        workerId: input.workerId,
        submittedAt: now,
        failureReason: 'expired',
        ...telemetryColumns(tel),
      });
      return { status: 'expired' };
    }

    const truth = new Set(challenge.tiles.filter((t) => t.isTarget).map((t) => t.index));
    const picked = new Set(input.selected);

    let correct = 0;
    let wrong = 0;
    for (const t of picked) {
      if (truth.has(t)) correct += 1;
      else wrong += 1;
    }
    const missed = [...truth].filter((t) => !picked.has(t)).length;
    const ok = wrong === 0 && missed === 0;

    const attempt: AttemptRow = {
      challengeId: input.challengeId,
      runId: challenge.runId,
      selected: [...picked].sort((a, b) => a - b),
      ok,
      latencyMs: input.latencyMs,
      solver: input.solver,
      workerId: input.workerId,
      submittedAt: now,
      failureReason: ok ? null : 'wrong_tiles',
      ...telemetryColumns(tel),
    };

    this.db
      .prepare('UPDATE challenges SET verifiedAt = ? WHERE id = ?')
      .run(now, input.challengeId);
    this.insertAttempt(attempt);

    return {
      status: 'ok',
      outcome: { ok, correct, wrong, missed, latencyMs: input.latencyMs },
      attempt,
    };
  }

  /** Ghi attempt không qua verify (solver lỗi, timeout, schema hỏng). */
  recordFailure(input: {
    challengeId: string;
    runId: string;
    solver: string;
    workerId: number;
    reason: FailureReason;
    latencyMs: number;
    telemetry?: AttemptTelemetry;
    now?: number;
  }): void {
    const now = input.now ?? Date.now();
    this.insertAttempt({
      challengeId: input.challengeId,
      runId: input.runId,
      selected: [],
      ok: false,
      latencyMs: input.latencyMs,
      solver: input.solver,
      workerId: input.workerId,
      submittedAt: now,
      failureReason: input.reason,
      ...telemetryColumns(input.telemetry ?? {}),
    });
    this.db
      .prepare('UPDATE challenges SET verifiedAt = ? WHERE id = ? AND verifiedAt IS NULL')
      .run(now, input.challengeId);
  }

  private insertAttempt(a: AttemptRow): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO attempts
           (challengeId, runId, selected, ok, latencyMs, solver, workerId, submittedAt,
            failureReason, coordSource, solverMs, totalMs, inputTokens, outputTokens, costUsd)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        a.challengeId,
        a.runId,
        JSON.stringify(a.selected),
        a.ok ? 1 : 0,
        a.latencyMs,
        a.solver,
        a.workerId,
        a.submittedAt,
        a.failureReason,
        a.coordSource,
        a.solverMs,
        a.totalMs,
        a.inputTokens,
        a.outputTokens,
        a.costUsd,
      );
  }

  listAttempts(runId: string): AttemptRow[] {
    const rows = this.db
      .prepare('SELECT * FROM attempts WHERE runId = ? ORDER BY submittedAt')
      .all(runId) as Array<{
      challengeId: string;
      runId: string;
      selected: string;
      ok: number;
      latencyMs: number;
      solver: string;
      workerId: number;
      submittedAt: number;
      failureReason: string | null;
      coordSource: string | null;
      solverMs: number | null;
      totalMs: number | null;
      inputTokens: number | null;
      outputTokens: number | null;
      costUsd: number | null;
    }>;
    return rows.map((r) => ({
      challengeId: r.challengeId,
      runId: r.runId,
      selected: JSON.parse(r.selected) as number[],
      ok: r.ok === 1,
      latencyMs: r.latencyMs,
      solver: r.solver,
      workerId: r.workerId,
      submittedAt: r.submittedAt,
      failureReason: r.failureReason as FailureReason | null,
      coordSource: r.coordSource as 'model' | 'derived' | null,
      solverMs: r.solverMs,
      totalMs: r.totalMs,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      costUsd: r.costUsd,
    }));
  }

  /** Tổng hợp một run cho `GET /api/runs/:runId`. */
  summarizeRun(runId: string): {
    attempts: number;
    ok: number;
    byFailure: Record<string, number>;
  } {
    const attempts = this.listAttempts(runId);
    const byFailure: Record<string, number> = {};
    let ok = 0;
    for (const a of attempts) {
      if (a.ok) ok += 1;
      else {
        const key = a.failureReason ?? 'unknown';
        byFailure[key] = (byFailure[key] ?? 0) + 1;
      }
    }
    return { attempts: attempts.length, ok, byFailure };
  }

  listChallenges(runId: string): ChallengeRow[] {
    const rows = this.db
      .prepare('SELECT id FROM challenges WHERE runId = ? ORDER BY createdAt')
      .all(runId) as Array<{ id: string }>;
    return rows.map((r) => this.getChallenge(r.id)).filter((c): c is ChallengeRow => c !== null);
  }

  close(): void {
    this.db.close();
  }
}
