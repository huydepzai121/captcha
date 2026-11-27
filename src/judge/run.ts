// language: TypeScript, file: src/judge/run.ts, runtime: Node 22
// Judge chạy SAU run, theo lô, đọc attempt từ store (spec evaluation-judge:
// "Judge chạy tách khỏi vòng lặp worker").
//
// Judge KHÔNG đụng vào pass/fail. Nó chỉ ghi thêm giải thích.

import { evaluateJev, type EvaluateAnswer } from './jev.js';
import { buildQuestions } from './questions.js';
import { buildJudgeState } from './state.js';
import type { Store } from '../server/store.js';

export interface JudgeRow {
  challengeId: string;
  ambiguous: boolean | null;
  failureCause: string | null;
  severity: number | null;
  probability: number | null;
  answers: Record<string, EvaluateAnswer>;
  latencyMs: number;
  costUsd: number | null;
}

export interface JudgeRunSummary {
  judged: number;
  unjudged: number;
  failureCause: Record<string, number>;
  meanSeverity: number | null;
  ambiguousCount: number;
  rows: JudgeRow[];
}

export interface RunJudgeInput {
  store: Store;
  runId: string;
  rootDir: string;
  apiKey?: string;
  model?: string;
  zeroDataRetention?: boolean;
  only?: string[];
  /** Giới hạn số attempt chấm — dùng cho smoke test. */
  limit?: number;
}

export async function runJudge(input: RunJudgeInput): Promise<JudgeRunSummary> {
  const apiKey = input.apiKey ?? process.env.AI_GATEWAY_API_KEY;
  const attempts = input.store.listAttempts(input.runId);
  const target = input.limit === undefined ? attempts : attempts.slice(0, input.limit);

  const rows: JudgeRow[] = [];
  let unjudged = attempts.length - target.length;

  if (!apiKey) {
    console.warn('[judge] AI_GATEWAY_API_KEY chưa set — bỏ qua toàn bộ lượt chấm');
    return {
      judged: 0,
      unjudged: attempts.length,
      failureCause: {},
      meanSeverity: null,
      ambiguousCount: 0,
      rows: [],
    };
  }

  for (const attempt of target) {
    const challenge = input.store.getChallenge(attempt.challengeId);
    if (!challenge) {
      unjudged += 1;
      continue;
    }

    const state = buildJudgeState({
      challenge,
      selected: attempt.selected,
      outcome: { ok: attempt.ok, correct: 0, wrong: 0, missed: 0 },
    });

    const questions = buildQuestions({
      target: challenge.target,
      targetCount: challenge.tiles.filter((t) => t.isTarget).length,
      hasSplitObject: challenge.splitObjects.length > 0,
    });

    try {
      const result = await evaluateJev({
        apiKey,
        state,
        questions,
        ...(input.model ? { model: input.model } : {}),
        providerOptions: {
          gateway: {
            ...(input.zeroDataRetention ? { zeroDataRetention: true } : {}),
            ...(input.only ? { only: input.only } : {}),
          },
        },
      });

      const causeAnswer = result.answers.failureCause;
      const severityAnswer = result.answers.severity;
      const ambiguousAnswer = result.answers.ambiguous;

      rows.push({
        challengeId: attempt.challengeId,
        ambiguous: ambiguousAnswer?.type === 'boolean' ? ambiguousAnswer.probability >= 0.5 : null,
        failureCause: causeAnswer?.type === 'choice' ? causeAnswer.choice : null,
        severity: severityAnswer?.type === 'score' ? severityAnswer.score : null,
        probability: ambiguousAnswer?.type === 'boolean' ? ambiguousAnswer.probability : null,
        answers: result.answers,
        latencyMs: result.latencyMs,
        costUsd: result.costUsd ?? null,
      });
    } catch (err) {
      // Judge hỏng không được đụng tới attempt: chỉ ghi nhận là không chấm được.
      unjudged += 1;
      console.warn(
        `[judge] ${attempt.challengeId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const failureCause: Record<string, number> = {};
  let severitySum = 0;
  let severityCount = 0;
  let ambiguousCount = 0;

  for (const row of rows) {
    if (row.failureCause) failureCause[row.failureCause] = (failureCause[row.failureCause] ?? 0) + 1;
    if (row.severity !== null) {
      severitySum += row.severity;
      severityCount += 1;
    }
    if (row.ambiguous === true) ambiguousCount += 1;
  }

  return {
    judged: rows.length,
    unjudged,
    failureCause,
    meanSeverity: severityCount === 0 ? null : severitySum / severityCount,
    ambiguousCount,
    rows,
  };
}
