// language: TypeScript, file: src/judge/jev.ts, runtime: Node 22
// Client cho evaluation API của AI Gateway (spec evaluation-judge).
//
// Contract đã verify từ doc (2026-09-21):
//   POST https://ai-gateway.vercel.sh/v1/evaluate
//   body: { model, state, questions, providerOptions? }
//   resp: { model, answers, usage, providerMetadata.gateway{cost,...} }
//
// Lưu ý load-bearing:
//   - `state` KHÔNG nhận ảnh. string | object | array.
//   - `probability` của boolean là P(true), không phải confidence.
//   - Giá trị trả về làm tròn 2 chữ số → tổng probabilities có thể != 1.
//   - Evaluation KHÔNG chạy qua endpoint OpenAI/Anthropic-compatible.

export const GATEWAY_BASE = 'https://ai-gateway.vercel.sh';
export const EVALUATE_PATH = '/v1/evaluate';
export const DEFAULT_EVAL_MODEL = 'typesafe-ai/jev';

export interface BooleanQuestion {
  type: 'boolean';
  instructions: string;
  criteria?: { true: string; false: string };
}

export interface ChoiceQuestion {
  type: 'choice';
  instructions: string;
  criteria: Record<string, string>;
}

export interface ScoreQuestion {
  type: 'score';
  instructions: string;
  criteria: string[];
}

export type EvaluateQuestion = BooleanQuestion | ChoiceQuestion | ScoreQuestion;

export type EvaluateQuestionSet = Record<string, EvaluateQuestion>;

export interface BooleanAnswer {
  type: 'boolean';
  /** P(true). */
  probability: number;
}

export interface ChoiceAnswer {
  type: 'choice';
  choice: string;
  probabilities: Record<string, number>;
}

export interface ScoreAnswer {
  type: 'score';
  score: number;
  probabilities: Record<string, number>;
}

export type EvaluateAnswer = BooleanAnswer | ChoiceAnswer | ScoreAnswer;

export interface EvaluateUsage {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
}

export interface EvaluateProviderOptions {
  gateway?: {
    zeroDataRetention?: boolean;
    only?: string[];
  };
}

export interface EvaluateResult {
  model: string;
  answers: Record<string, EvaluateAnswer>;
  usage: EvaluateUsage;
  /** USD, đọc từ providerMetadata.gateway.cost. */
  costUsd?: number | undefined;
  latencyMs: number;
  raw: unknown;
}

export interface EvaluateInput {
  apiKey: string;
  state: unknown;
  questions: EvaluateQuestionSet;
  model?: string;
  providerOptions?: EvaluateProviderOptions;
  baseUrl?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  /**
   * Số lần thử lại khi gặp 5xx. Typesafe trả 503 khá thường xuyên
   * ("Service temporarily unavailable"), và mất một lượt chấm vì lỗi tạm thời
   * làm hỏng số liệu judge. Mặc định 2. Không thử lại 4xx — đó là lỗi của mình.
   */
  maxRetries?: number;
}

export class EvaluateError extends Error {
  readonly status: number | undefined;
  readonly body: string;

  constructor(message: string, status?: number, body = '') {
    super(message);
    this.name = 'EvaluateError';
    this.status = status;
    this.body = body;
  }
}

const DEFAULT_TIMEOUT_MS = 30_000;

interface RawEvaluateResponse {
  model?: string;
  answers?: Record<string, unknown>;
  usage?: { inputTokens?: number; outputTokens?: number; input_tokens?: number; output_tokens?: number };
  providerMetadata?: {
    gateway?: { cost?: string | number; generationId?: string };
    typesafe?: { confidence?: Record<string, unknown> };
  };
}

/** Chuẩn hoá usage: hai surface trả hai shape khác nhau. */
const readUsage = (usage: RawEvaluateResponse['usage']): EvaluateUsage => ({
  inputTokens: usage?.inputTokens ?? usage?.input_tokens,
  outputTokens: usage?.outputTokens ?? usage?.output_tokens,
});

const readCost = (meta: RawEvaluateResponse['providerMetadata']): number | undefined => {
  const cost = meta?.gateway?.cost;
  if (typeof cost === 'number') return cost;
  if (typeof cost === 'string') {
    const n = Number.parseFloat(cost);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
};

/** Kiểm tra answer có đúng shape của một trong ba kiểu đã khai báo. */
export const isEvaluateAnswer = (value: unknown): value is EvaluateAnswer => {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as { type?: unknown };
  if (v.type === 'boolean') return typeof (value as BooleanAnswer).probability === 'number';
  if (v.type === 'choice') {
    const a = value as ChoiceAnswer;
    return typeof a.choice === 'string' && typeof a.probabilities === 'object';
  }
  if (v.type === 'score') {
    const a = value as ScoreAnswer;
    return typeof a.score === 'number' && typeof a.probabilities === 'object';
  }
  return false;
};

/**
 * Gọi một lượt evaluation. Không retry — spec evaluation-judge yêu cầu lỗi mạng
 * không được kéo dài vòng lặp; retry là quyết định của tầng gọi.
 */
/** Thử lại khi 5xx. 4xx là lỗi của mình, không thử lại. */
const isRetryable = (err: unknown): boolean =>
  err instanceof EvaluateError && err.status !== undefined && err.status >= 500;

const sleep = (ms: number): Promise<void> => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
};

export async function evaluateJev(input: EvaluateInput): Promise<EvaluateResult> {
  const maxRetries = input.maxRetries ?? 2;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (attempt > 0) {
      // Backoff 400ms, 1200ms — đủ để 503 tạm thời qua đi.
      await sleep(400 * 3 ** (attempt - 1));
    }
    try {
      return await evaluateOnce(input);
    } catch (err) {
      lastError = err;
      if (!isRetryable(err) || attempt === maxRetries) throw err;
    }
  }

  throw lastError;
}

async function evaluateOnce(input: EvaluateInput): Promise<EvaluateResult> {
  const baseUrl = input.baseUrl ?? GATEWAY_BASE;
  const model = input.model ?? DEFAULT_EVAL_MODEL;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onOuterAbort = (): void => controller.abort();
  input.signal?.addEventListener('abort', onOuterAbort, { once: true });

  const t0 = Date.now();
  try {
    const res = await fetch(`${baseUrl}${EVALUATE_PATH}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify({
        model,
        state: input.state,
        questions: input.questions,
        ...(input.providerOptions ? { providerOptions: input.providerOptions } : {}),
      }),
      signal: controller.signal,
    });

    const text = await res.text();
    if (!res.ok) {
      throw new EvaluateError(`evaluate ${res.status}`, res.status, text.slice(0, 800));
    }

    let parsed: RawEvaluateResponse;
    try {
      parsed = JSON.parse(text) as RawEvaluateResponse;
    } catch {
      throw new EvaluateError('evaluate: response không phải JSON', res.status, text.slice(0, 400));
    }

    const answers: Record<string, EvaluateAnswer> = {};
    for (const [key, value] of Object.entries(parsed.answers ?? {})) {
      if (isEvaluateAnswer(value)) answers[key] = value;
    }

    const missing = Object.keys(input.questions).filter((k) => !(k in answers));
    if (missing.length > 0) {
      throw new EvaluateError(
        `evaluate: thiếu answer cho ${missing.join(', ')}`,
        res.status,
        text.slice(0, 400),
      );
    }

    const costUsd = readCost(parsed.providerMetadata);
    return {
      model: parsed.model ?? model,
      answers,
      usage: readUsage(parsed.usage),
      ...(costUsd === undefined ? {} : { costUsd }),
      latencyMs: Date.now() - t0,
      raw: parsed,
    };
  } catch (err) {
    if (err instanceof EvaluateError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new EvaluateError(`evaluate: quá ${timeoutMs}ms`, undefined, '');
    }
    throw new EvaluateError(
      `evaluate: ${err instanceof Error ? err.message : String(err)}`,
      undefined,
      '',
    );
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener('abort', onOuterAbort);
  }
}
