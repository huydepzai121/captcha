// language: TypeScript, file: test/judge.spec.ts
// Judge: state không chứa ảnh, endpoint đúng, parse đủ ba dạng answer,
// lỗi không làm hỏng attempt.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { evaluateJev, EVALUATE_PATH, GATEWAY_BASE, isEvaluateAnswer } from '../src/judge/jev.js';
import { assertNoImageData, buildJudgeState } from '../src/judge/state.js';
import { buildQuestions, FAILURE_CAUSES, SEVERITY_SCALE } from '../src/judge/questions.js';
import type { ChallengeRow } from '../src/server/store.js';

const challenge: ChallengeRow = {
  id: 'c1',
  runId: 'r1',
  seed: 1,
  difficulty: 'medium',
  target: 'bridge',
  grid: { cols: 4, rows: 4 },
  tiles: [
    { index: 0, source: 'bridge-000.png', category: 'bridge', isTarget: true },
    { index: 1, source: 'bus-000.png', category: 'bus', isTarget: false },
    { index: 2, source: 'crosswalk-000.png', category: 'crosswalk', isTarget: true },
  ],
  splitObjects: [{ tileIndexA: 0, tileIndexB: 1, category: 'bridge' }],
  createdAt: 0,
  expiresAt: 0,
  verifiedAt: null,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

const stubFetch = (payload: unknown, status = 200) => {
  const calls: Array<{ url: string; body: unknown; headers: Record<string, string> }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({
        url: String(url),
        body: JSON.parse(String(init.body)) as unknown,
        headers: (init.headers ?? {}) as Record<string, string>,
      });
      return new Response(JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return calls;
};

describe('judge state', () => {
  it('không chứa dữ liệu ảnh', () => {
    const state = buildJudgeState({
      challenge,
      selected: [0, 1],
      outcome: { ok: false, correct: 1, wrong: 1, missed: 1 },
    });
    expect(() => assertNoImageData(state)).not.toThrow();
    const serialized = JSON.stringify(state).toLowerCase();
    expect(serialized).not.toContain('base64');
    expect(serialized).not.toContain('data:image');
    expect(serialized).not.toContain('.png');
  });

  it('mô tả tile lấy từ nhãn, không phải đường dẫn ảnh', () => {
    const state = buildJudgeState({
      challenge,
      selected: [0],
      outcome: { ok: false, correct: 0, wrong: 0, missed: 2 },
    });
    expect(state.tileDescriptions['0']).toContain('bridge');
    expect(state.tileDescriptions['1']).toContain('không khớp');
    expect(state.groundTruthTiles).toEqual([0, 2]);
  });

  it('assertNoImageData bắt được dữ liệu ảnh lọt vào', () => {
    expect(() => assertNoImageData({ note: 'data:image/png;base64,AAAA' })).toThrow();
    expect(() => assertNoImageData({ imagePath: 'a/b.png' })).toThrow();
  });
});

describe('judge questions', () => {
  it('ba câu hỏi đúng kiểu, một round trip', () => {
    const qs = buildQuestions({ target: 'bridge', targetCount: 2, hasSplitObject: false });
    expect(Object.keys(qs).sort()).toEqual(['ambiguous', 'failureCause', 'severity']);
    expect(qs.ambiguous?.type).toBe('boolean');
    expect(qs.failureCause?.type).toBe('choice');
    expect(qs.severity?.type).toBe('score');
  });

  it('choice criteria phủ đúng tập nhãn nguyên nhân', () => {
    const qs = buildQuestions({ target: 'bus', targetCount: 3, hasSplitObject: false });
    if (qs.failureCause?.type !== 'choice') throw new Error('sai kiểu');
    expect(Object.keys(qs.failureCause.criteria).sort()).toEqual([...FAILURE_CAUSES].sort());
  });

  it('score criteria nằm trong 2..10 bậc', () => {
    const qs = buildQuestions({ target: 'bus', targetCount: 3, hasSplitObject: false });
    if (qs.severity?.type !== 'score') throw new Error('sai kiểu');
    expect(qs.severity.criteria.length).toBe(SEVERITY_SCALE.length);
    expect(qs.severity.criteria.length).toBeGreaterThanOrEqual(2);
    expect(qs.severity.criteria.length).toBeLessThanOrEqual(10);
  });

  it('thêm câu splitAware khi đề có vật thể bị cắt', () => {
    const qs = buildQuestions({ target: 'bridge', targetCount: 2, hasSplitObject: true });
    expect(qs.splitAware?.type).toBe('boolean');
  });
});

describe('evaluateJev', () => {
  const questions = buildQuestions({ target: 'bridge', targetCount: 2, hasSplitObject: false });

  it('gọi đúng endpoint và mang state + questions', async () => {
    const calls = stubFetch({
      model: 'typesafe-ai/jev',
      answers: {
        ambiguous: { type: 'boolean', probability: 0.12 },
        failureCause: { type: 'choice', choice: 'correct', probabilities: { correct: 0.9 } },
        severity: { type: 'score', score: 0.4, probabilities: { '0': 0.6, '1': 0.4 } },
      },
      usage: { inputTokens: 100, outputTokens: 20 },
      providerMetadata: { gateway: { cost: '0.00001155' } },
    });

    const result = await evaluateJev({ apiKey: 'test-key', state: { a: 1 }, questions });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${GATEWAY_BASE}${EVALUATE_PATH}`);
    expect(calls[0]?.headers.authorization).toBe('Bearer test-key');
    const body = calls[0]?.body as { model: string; state: unknown; questions: unknown };
    expect(body.model).toBe('typesafe-ai/jev');
    expect(body.state).toEqual({ a: 1 });
    expect(Object.keys(body.questions as object).length).toBe(3);

    expect(result.answers.ambiguous).toEqual({ type: 'boolean', probability: 0.12 });
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 20 });
    expect(result.costUsd).toBeCloseTo(0.00001155, 10);
  });

  it('đọc được usage dạng snake_case của surface TypeSafe', async () => {
    stubFetch({
      answers: {
        ambiguous: { type: 'boolean', probability: 0.5 },
        failureCause: { type: 'choice', choice: 'correct', probabilities: {} },
        severity: { type: 'score', score: 1, probabilities: {} },
      },
      usage: { input_tokens: 7, output_tokens: 3 },
    });
    const result = await evaluateJev({ apiKey: 'k', state: 'x', questions });
    expect(result.usage).toEqual({ inputTokens: 7, outputTokens: 3 });
  });

  it('ném lỗi khi thiếu answer', async () => {
    stubFetch({ answers: { ambiguous: { type: 'boolean', probability: 0.5 } } });
    await expect(evaluateJev({ apiKey: 'k', state: 'x', questions })).rejects.toThrow(/thiếu answer/);
  });

  it('ném lỗi kèm status khi HTTP lỗi', async () => {
    stubFetch({ error: 'bad' }, 400);
    await expect(evaluateJev({ apiKey: 'k', state: 'x', questions })).rejects.toMatchObject({
      status: 400,
    });
  });

  it('bỏ qua answer sai shape thay vì tin mù', async () => {
    stubFetch({
      answers: {
        ambiguous: { type: 'boolean' },
        failureCause: { type: 'choice', choice: 'correct', probabilities: {} },
        severity: { type: 'score', score: 1, probabilities: {} },
      },
    });
    await expect(evaluateJev({ apiKey: 'k', state: 'x', questions })).rejects.toThrow(/thiếu answer/);
  });

  it('isEvaluateAnswer phân loại đúng', () => {
    expect(isEvaluateAnswer({ type: 'boolean', probability: 0.5 })).toBe(true);
    expect(isEvaluateAnswer({ type: 'choice', choice: 'a', probabilities: {} })).toBe(true);
    expect(isEvaluateAnswer({ type: 'score', score: 1, probabilities: {} })).toBe(true);
    expect(isEvaluateAnswer({ type: 'boolean' })).toBe(false);
    expect(isEvaluateAnswer(null)).toBe(false);
  });
});
