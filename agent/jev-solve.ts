// language: TypeScript, file: agent/jev-solve.ts, runtime: Node 22
// JEV NHÌN THẲNG ẢNH LƯỚI và trả xác suất cho từng ô — một round trip.
//
// Đây là đường chính. Bản cũ bắt một model vision mô tả ô thành chữ rồi mới cho
// JEV chấm chữ; giờ JEV đọc được ảnh (TypeSafe `assets` + header danger-zone) nên
// bỏ được tầng mô tả: ít token hơn, không mất thông tin qua câu chữ, và câu hỏi
// "ô này có chứa X không" đúng là thứ noul sinh ra để trả lời.
//
// Giới hạn của API (docs.typesafe.ai/images): cạnh 280–1568px, PNG/JPEG, base64
// KHÔNG kèm tiền tố `data:`. Ảnh lưới được encode lại sang JPEG đúng cỡ trước khi gửi.

import { TYPESAFE_BASE, DECISION_MODEL, DANGER_ZONE_HEADER } from './config.js';
import type { JevDecision } from './jev-decide.js';

export interface SolveGridInput {
  apiKey: string;
  /** JPEG base64, không có tiền tố `data:`. */
  imageBase64: string;
  cols: number;
  rows: number;
  instruction: string;
  threshold?: number;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
  /** Số lượt gọi. Mặc định 2. */
  attempts?: number;
}

interface NoulAnswer {
  type?: unknown;
  noul?: unknown;
  probability?: unknown;
}

/** Lỗi 4xx: thử lại cũng thế (ảnh sai cỡ, hết context, key sai). */
class FatalJevError extends Error {}

/** Giá Jev: $42/Btok input, output miễn phí (docs.typesafe.ai/models). */
const USD_PER_INPUT_TOKEN = 42 / 1_000_000_000;

const sleep = (ms: number): Promise<void> => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
};

const probabilityOf = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : null;

/**
 * Hỏi JEV về từng ô của ảnh lưới. Ném lỗi khi hết lượt để tầng gọi còn đường
 * lùi (vision + JEV chữ); không tự bịa kết quả.
 */
export async function solveGridWithJev(input: SolveGridInput): Promise<JevDecision> {
  const threshold = input.threshold ?? 0.5;
  const baseUrl = input.baseUrl ?? TYPESAFE_BASE;
  const model = input.model ?? DECISION_MODEL;
  const timeoutMs = input.timeoutMs ?? 30_000;
  const attempts = Math.max(1, input.attempts ?? 2);
  const reference = 'grid-image';
  const t0 = Date.now();

  const questions: Record<string, { type: 'noul'; instructions: string }> = {};
  for (let row = 0; row < input.rows; row += 1) {
    for (let col = 0; col < input.cols; col += 1) {
      questions[`tile_${row * input.cols + col}`] = {
        type: 'noul',
        // Nói rõ cách đếm: lưới captcha không có nhãn, model phải biết gốc toạ độ.
        instructions:
          `In \`${reference}\`, does the tile at row ${row + 1}, column ${col + 1} ` +
          '(counting from the top-left) contain the thing the instruction asks for?',
      };
    }
  }

  const body = JSON.stringify({
    model,
    state: { instruction: input.instruction, grid: `${input.rows} rows x ${input.cols} columns`, image: reference },
    assets: {
      [reference]: { type: 'image', format: 'jpg', data_base64: input.imageBase64 },
    },
    questions,
  });

  let lastError = 'JEV không trả lời';

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (attempt > 1) await sleep(400 * attempt);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(`${baseUrl}/v1/systemone`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${input.apiKey}`,
          [DANGER_ZONE_HEADER]: 'true',
        },
        body,
        signal: controller.signal,
      });

      const text = await res.text();
      if (!res.ok) {
        lastError = `JEV HTTP ${res.status}: ${text.slice(0, 200)}`;
        if (res.status < 500) throw new FatalJevError(lastError);
        continue;
      }

      const parsed = JSON.parse(text) as {
        answers?: Record<string, NoulAnswer>;
        usage?: { input_tokens?: number; output_tokens?: number };
        providerMetadata?: { gateway?: { cost?: string } };
      };

      const probabilities: Record<string, number> = {};
      const tiles: number[] = [];
      let answered = 0;

      for (const key of Object.keys(questions)) {
        const answer = parsed.answers?.[key];
        const p = probabilityOf(answer?.noul ?? answer?.probability);
        if (p === null) continue;
        answered += 1;
        probabilities[key] = p;
        if (p >= threshold) tiles.push(Number.parseInt(key.slice('tile_'.length), 10));
      }

      if (answered === 0) {
        lastError = 'JEV không trả lời ô nào';
        continue;
      }

      // TypeSafe trả `usage`, không trả cost — quy ra USD theo giá công bố.
      // Output miễn phí nên chỉ tính input; ảnh tính theo token như chữ.
      const reported = Number.parseFloat(String(parsed.providerMetadata?.gateway?.cost ?? ''));
      const tokens = parsed.usage?.input_tokens ?? 0;
      const costUsd = Number.isFinite(reported) ? reported : tokens * USD_PER_INPUT_TOKEN;
      return {
        tiles: tiles.sort((a, b) => a - b),
        probabilities,
        source: 'jev',
        degraded: answered < Object.keys(questions).length,
        error: answered < Object.keys(questions).length ? `thiếu answer cho ${Object.keys(questions).length - answered} ô` : null,
        latencyMs: Date.now() - t0,
        costUsd,
        inputTokens: tokens,
        raw: null,
      };
    } catch (err) {
      if (err instanceof FatalJevError) throw err;
      lastError = err instanceof Error ? err.message : String(err);
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(lastError);
}
