// language: TypeScript, file: agent/jev-decide.ts, runtime: Node 22
// Tầng não: JEV nhận mô tả từng ô (chữ, không ảnh) và trả boolean cho từng ô
// — "ô này có khớp instruction không?". Toàn bộ trong một round trip.
//
// JEV là BÊN QUYẾT ĐỊNH. Tầng mắt gửi mô tả thuần (đã bỏ chữ "yes —") để JEV
// không chỉ gật theo model. Phán đoán riêng của vision chỉ dùng làm dự phòng khi
// JEV hỏng — trước đây một lần 503 là cả trial chết, và mất luôn số liệu.
//
// Hàm này KHÔNG ném ra ngoài. Lỗi JEV biến thành `degraded: true` + nguồn
// `vision-fallback`, để vòng lặp gọi biết mà ghi log và vẫn đi tiếp.

import {
  evaluateJev,
  type EvaluateQuestionSet,
  type EvaluateResult,
} from '../src/judge/jev.js';
import type { TileVerdict } from './vision.js';

/** Một ô cần quyết định. `verdict` là phán đoán của tầng mắt, chỉ dùng dự phòng. */
export interface DecideTile {
  index: number;
  description: string;
  verdict?: TileVerdict;
}

export interface JevDecision {
  tiles: number[];
  probabilities: Record<string, number>;
  /** `jev`: JEV quyết. `vision-fallback`: JEV hỏng, dùng phán đoán tầng mắt. */
  source: 'jev' | 'vision-fallback';
  degraded: boolean;
  error: string | null;
  latencyMs: number;
  costUsd: number | null;
  /** Token input đã dùng, khi provider có trả. */
  inputTokens?: number;
  raw: EvaluateResult | null;
}

/**
 * Google nối hướng dẫn phụ vào instruction:
 *   "Select all images with a fire hydrant Click verify once there are none left."
 * Cắt đuôi đó trước khi dùng. Không cắt thì target thành cả một câu và JEV
 * sẽ đi tìm một thứ không tồn tại.
 */
export function cleanInstruction(instruction: string): string {
  return instruction
    .split(/\bClick\s+verify\b|\bIf\s+there\s+are\s+none\b|\bNếu\s+không\s+còn\b/i)[0]!
    .replace(/\s+/g, ' ')
    .trim();
}

/** Trích target từ instruction kiểu "Select all images with a fire hydrant". */
export function extractTarget(instruction: string): string {
  const cleaned = cleanInstruction(instruction);
  const hit = cleaned.match(/\bwith\s+(?:a\s+|an\s+|the\s+)?(.+?)[.\s]*$/i);
  return hit?.[1]?.trim() ?? cleaned;
}

export interface DecideInput {
  apiKey: string;
  instruction: string;
  tiles: readonly DecideTile[];
  threshold?: number;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
  /** Số lượt gọi JEV. Mặc định 2 — lần hai chỉ để cứu một lượt 503. */
  attempts?: number;
  /** Số lần thử lại 5xx bên trong một lượt gọi. Mặc định 2. */
  maxRetries?: number;
}

const key = (index: number): string => `tile_${index}`;

const probabilityOf = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : null;

/** Dự phòng bằng phán đoán của tầng mắt. Xác suất ở đây là dựng lại, không phải của JEV. */
const fallback = (
  tiles: readonly DecideTile[],
  threshold: number,
  error: string,
  latencyMs: number,
): JevDecision => {
  const probabilities: Record<string, number> = {};
  const picked: number[] = [];

  for (const tile of tiles) {
    const verdict = tile.verdict ?? 'unknown';
    probabilities[key(tile.index)] = verdict === 'yes' ? 1 : verdict === 'no' ? 0 : 0.5;
    if (verdict === 'yes') picked.push(tile.index);
  }

  // Không ô nào được nói "yes" thì chọn nốt các ô chưa rõ. Bỏ trắng cả lượt là
  // chắc chắn Google trả lại "select more"; chọn thừa thì mới có cửa sửa.
  // Ngưỡng cao hơn 0.5 thì tôn trọng ngưỡng, không đoán.
  if (picked.length === 0 && threshold <= 0.5) {
    for (const tile of tiles) {
      if ((tile.verdict ?? 'unknown') !== 'no') picked.push(tile.index);
    }
  }

  return {
    tiles: picked.sort((a, b) => a - b),
    probabilities,
    source: 'vision-fallback',
    degraded: true,
    error,
    latencyMs,
    costUsd: null,
    raw: null,
  };
};

const sleep = (ms: number): Promise<void> => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
};

export async function decideTilesWithJev(input: DecideInput): Promise<JevDecision> {
  const threshold = input.threshold ?? 0.5;
  const instruction = cleanInstruction(input.instruction);
  const target = extractTarget(input.instruction);
  const t0 = Date.now();

  if (input.tiles.length === 0) {
    return {
      tiles: [],
      probabilities: {},
      source: 'jev',
      degraded: false,
      error: null,
      latencyMs: 0,
      costUsd: null,
      raw: null,
    };
  }

  const questions: EvaluateQuestionSet = {};
  for (const tile of input.tiles) {
    const description = tile.description.trim();
    questions[key(tile.index)] = {
      type: 'boolean',
      // Hỏi bằng tiếng Anh và dùng chính từ của đề. Mô tả cũng đã được yêu cầu
      // viết bằng tiếng Anh (xem buildPrompt), nên hai bên cùng ngôn ngữ — không
      // còn ca JEV phải tự dịch "xe buýt" thành "bus" rồi dịch hụt.
      instructions:
        `The task asks to select every tile that CONTAINS "${target}". ` +
        `Description of tile ${tile.index}: "${description || '(no description)'}". ` +
        `Does this tile contain "${target}"?`,
      // Luật của đề là "chứa", không phải "có làm chủ thể chính". Một vật thể
      // nhỏ, ở xa, bị che một phần, hay nằm lệch về mép ô vẫn tính là có.
      criteria: {
        true: `the description mentions ${target}, even as a small, distant, partially hidden, or edge-cropped object`,
        false: `the description does not mention ${target} at all, not even partially`,
      },
    };
  }

  const state = {
    instruction,
    target,
    grid: { count: input.tiles.length },
    tiles: input.tiles.map((tile) => ({ index: tile.index, desc: tile.description })),
  };

  const attempts = Math.max(1, input.attempts ?? 2);
  let lastError = 'JEV không trả lời';

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (attempt > 1) await sleep(300 * attempt);
    try {
      const result = await evaluateJev({
        apiKey: input.apiKey,
        state,
        questions,
        ...(input.model ? { model: input.model } : {}),
        ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
        ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
        ...(input.maxRetries === undefined ? {} : { maxRetries: input.maxRetries }),
      });

      const probabilities: Record<string, number> = {};
      const picked: number[] = [];
      let answered = 0;

      for (const tile of input.tiles) {
        const answer = result.answers[key(tile.index)];
        const p = answer?.type === 'boolean' ? probabilityOf(answer.probability) : null;
        if (p !== null) answered += 1;

        // Ô không được trả lời thì lấy phán đoán của tầng mắt cho riêng ô đó —
        // bỏ trắng là chắc chắn bỏ sót ô.
        const value = p ?? (tile.verdict === 'yes' ? 1 : tile.verdict === 'no' ? 0 : 0.5);
        probabilities[key(tile.index)] = value;
        if (value >= threshold) picked.push(tile.index);
      }

      if (answered === 0) {
        lastError = 'JEV không trả lời ô nào';
        continue;
      }

      return {
        tiles: picked.sort((a, b) => a - b),
        probabilities,
        source: 'jev',
        degraded: answered < input.tiles.length,
        error: answered < input.tiles.length ? `thiếu answer cho ${input.tiles.length - answered} ô` : null,
        latencyMs: Date.now() - t0,
        costUsd: result.costUsd ?? null,
        raw: result,
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  return fallback(input.tiles, threshold, lastError, Date.now() - t0);
}
