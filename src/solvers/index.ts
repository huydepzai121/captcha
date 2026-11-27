// language: TypeScript, file: src/solvers/index.ts, runtime: Node 22
// Baseline bắt buộc (oracle, random) + adapter vision qua AI Gateway.
// Solver KHÔNG đọc store, không đọc manifest, không tra cứu đáp án theo challengeId
// — ngoại lệ duy nhất là `oracle`, vốn tồn tại để kiểm tra pipeline.

import {
  SOLVER_TIMEOUT_MS,
  type ClickSolver,
  type SolveRequest,
  type SolveResult,
} from '../domain/solver.js';
import type { Tile } from '../domain/challenge.js';

export const GATEWAY_BASE = 'https://ai-gateway.vercel.sh';
export const DEFAULT_VISION_MODEL = 'anthropic/claude-sonnet-4.5';

const withTimeout = <T>(factory: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return factory(controller.signal).finally(() => clearTimeout(timer));
};

/**
 * Trần của harness: đọc ground truth và click tâm mọi ô đúng.
 * Không phải model — tồn tại để chứng minh pipeline chấm điểm đúng.
 * Đây là ngoại lệ duy nhất được phép chạm ground truth.
 */
export function oracleSolver(groundTruth: readonly Tile[]): ClickSolver {
  return {
    name: 'oracle',
    coordSpace: 'absolute',
    async solve(req: SolveRequest): Promise<SolveResult> {
      const t0 = Date.now();
      const targets = groundTruth.filter((t) => t.isTarget).map((t) => t.index);
      const cellW = req.gridBox.w / req.grid.cols;
      const cellH = req.gridBox.h / req.grid.rows;
      const clicks = targets.map((index) => {
        const col = index % req.grid.cols;
        const row = Math.floor(index / req.grid.cols);
        return {
          x: req.gridBox.x + (col + 0.5) * cellW,
          y: req.gridBox.y + (row + 0.5) * cellH,
        };
      });
      return {
        clicks,
        latencyMs: Date.now() - t0,
        coordSource: 'derived',
        rawResponse: `oracle -> tiles [${targets.join(',')}]`,
      };
    },
  };
}

/** Sàn nhiễu: chọn ngẫu nhiên k ô. Solve rate phải nằm trong khoảng nhị thức. */
export function randomSolver(k?: number): ClickSolver {
  return {
    name: 'random',
    coordSpace: 'absolute',
    async solve(req: SolveRequest): Promise<SolveResult> {
      const t0 = Date.now();
      const size = req.grid.cols * req.grid.rows;
      const want = Math.min(k ?? 2 + Math.floor(Math.random() * 3), size);
      const picked = new Set<number>();
      while (picked.size < want) picked.add(Math.floor(Math.random() * size));

      const cellW = req.gridBox.w / req.grid.cols;
      const cellH = req.gridBox.h / req.grid.rows;
      const clicks = [...picked].map((index) => {
        const col = index % req.grid.cols;
        const row = Math.floor(index / req.grid.cols);
        return {
          x: req.gridBox.x + (col + 0.5) * cellW,
          y: req.gridBox.y + (row + 0.5) * cellH,
        };
      });
      return {
        clicks,
        latencyMs: Date.now() - t0,
        coordSource: 'derived',
        rawResponse: `random -> ${want} ô`,
      };
    },
  };
}

interface VisionAnswer {
  tiles?: unknown;
  cells?: unknown;
}

/** Dạng liệt kê từng ô: lấy chỉ số của các ô có `match === true`. */
const tilesFromCells = (cells: unknown[]): unknown[] =>
  cells
    .filter((c): c is { i: unknown; match: unknown } => typeof c === 'object' && c !== null)
    .filter((c) => c.match === true)
    .map((c) => c.i);

export const parseTiles = (text: string, size: number): { tiles: number[]; raw: string } | null => {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let parsed: VisionAnswer;
  try {
    parsed = JSON.parse(match[0]) as VisionAnswer;
  } catch {
    return null;
  }
  const values = Array.isArray(parsed.cells)
    ? tilesFromCells(parsed.cells)
    : Array.isArray(parsed.tiles)
      ? parsed.tiles
      : null;
  if (!values) return null;
  const tiles = new Set<number>();
  for (const v of values) {
    const n = typeof v === 'number' ? v : Number.parseInt(String(v), 10);
    if (Number.isInteger(n) && n >= 0 && n < size) tiles.add(n);
  }
  return { tiles: [...tiles].sort((a, b) => a - b), raw: match[0] };
};

export type VisionPromptStyle = 'list' | 'enumerate';

export interface VisionSolverOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  /**
   * `list`: model trả thẳng mảng chỉ số — nhanh nhưng hay lệch vị trí và bỏ sót
   * vật thể nhỏ. `enumerate`: buộc model duyệt lần lượt từng ô theo hàng, ghi
   * vật thể thấy được rồi mới kết luận khớp hay không.
   */
  prompt?: VisionPromptStyle;
}

export const buildVisionPrompt = (
  grid: { rows: number; cols: number },
  style: VisionPromptStyle,
): string => {
  const size = grid.rows * grid.cols;
  const layout =
    'You solve image-grid tasks. You receive the challenge image and the instruction. ' +
    `The grid has ${grid.rows} rows x ${grid.cols} columns, tiles indexed 0..${size - 1} ` +
    `left-to-right, top-to-bottom (index = row*${grid.cols} + col). `;
  if (style === 'list') {
    return (
      layout +
      'Return ONLY JSON: {"tiles": [indices of ALL tiles matching the instruction]}. ' +
      'No prose, no markdown.'
    );
  }
  return (
    layout +
    'Inspect EVERY tile in order, row by row. Objects may be small or thin — ' +
    'look at the whole tile, not only its center. ' +
    'Return ONLY JSON with exactly one entry per tile, in index order: ' +
    '{"cells": [{"i": 0, "what": "<main object, 1-4 words>", "match": true|false}, ...]}. ' +
    'No prose, no markdown.'
  );
};

/**
 * Model vision qua chat/completions của AI Gateway. Trả chỉ số ô; adapter tự
 * quy đổi ra tâm ô nên `coordSource` là `derived` (spec click-solver).
 * Timeout 30s, không retry — vượt là FAILED.
 */
export function gatewayVisionSolver(opts: VisionSolverOptions): ClickSolver {
  const model = opts.model ?? DEFAULT_VISION_MODEL;
  const baseUrl = opts.baseUrl ?? GATEWAY_BASE;

  return {
    name: `vision:${model}`,
    coordSpace: 'absolute',
    async solve(req: SolveRequest): Promise<SolveResult> {
      const t0 = Date.now();
      const size = req.grid.cols * req.grid.rows;
      const systemPrompt = buildVisionPrompt(req.grid, opts.prompt ?? 'enumerate');

      const res = await withTimeout(
        (signal) =>
          fetch(`${baseUrl}/v1/chat/completions`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${opts.apiKey}`,
            },
            body: JSON.stringify({
              model,
              max_tokens: 1024,
              messages: [
                { role: 'system', content: systemPrompt },
                {
                  role: 'user',
                  content: [
                    { type: 'text', text: req.instruction },
                    {
                      type: 'image_url',
                      image_url: {
                        url: `data:image/png;base64,${req.screenshot.toString('base64')}`,
                      },
                    },
                  ],
                },
              ],
            }),
            signal,
          }),
        SOLVER_TIMEOUT_MS,
      );

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        const err = new Error(`gateway ${res.status}: ${body.slice(0, 300)}`);
        (err as Error & { status?: number }).status = res.status;
        throw err;
      }

      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const text = json.choices?.[0]?.message?.content ?? '';
      const parsed = parseTiles(text, size);

      const cellW = req.gridBox.w / req.grid.cols;
      const cellH = req.gridBox.h / req.grid.rows;
      const clicks = (parsed?.tiles ?? []).map((index) => {
        const col = index % req.grid.cols;
        const row = Math.floor(index / req.grid.cols);
        return {
          x: req.gridBox.x + (col + 0.5) * cellW,
          y: req.gridBox.y + (row + 0.5) * cellH,
        };
      });

      return {
        clicks,
        latencyMs: Date.now() - t0,
        coordSource: 'derived',
        rawResponse: text.slice(0, 2000),
        ...(json.usage
          ? {
              usage: {
                inputTokens: json.usage.prompt_tokens,
                outputTokens: json.usage.completion_tokens,
              },
            }
          : {}),
      };
    },
  };
}

export interface SolverRegistry {
  readonly names: readonly string[];
  resolve(name: string): ClickSolver;
}

export function createRegistry(input: {
  rootDir: string;
  groundTruthFor?: (challengeId: string) => readonly Tile[] | null;
}): SolverRegistry {
  const names = ['oracle', 'random', 'vision'];
  return {
    names,
    resolve(name: string): ClickSolver {
      if (name === 'oracle') {
        const { groundTruthFor } = input;
        if (!groundTruthFor) throw new Error('oracle cần nguồn ground truth');
        return {
          name: 'oracle',
          coordSpace: 'absolute',
          async solve(req) {
            const truth = groundTruthFor(req.challengeId);
            if (!truth) throw new Error(`oracle: không có ground truth cho ${req.challengeId}`);
            return oracleSolver(truth).solve(req);
          },
        };
      }
      if (name === 'random') return randomSolver();
      if (name === 'vision' || name.startsWith('vision:')) {
        const key = process.env.AI_GATEWAY_API_KEY;
        if (!key) throw new Error('AI_GATEWAY_API_KEY chưa set — solver vision cần key');
        const model = name.includes(':') ? name.slice('vision:'.length) : undefined;
        return gatewayVisionSolver({ apiKey: key, ...(model ? { model } : {}) });
      }
      throw new Error(`solver không rõ: ${name}`);
    },
  };
}
