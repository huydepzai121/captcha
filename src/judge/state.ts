// language: TypeScript, file: src/judge/state.ts, runtime: Node 22
// Dựng `state` cho judge: mô tả CÓ CẤU TRÚC của một attempt đã chạy xong.
// Tuyệt đối không có ảnh, đường dẫn ảnh, hay base64 trong state
// (spec evaluation-judge: "State của judge là mô tả có cấu trúc, không phải ảnh").

import type { ChallengeRow } from '../server/store.js';
import { SHAPE_DESCRIPTION } from './descriptions.js';

export interface JudgeState {
  instruction: string;
  grid: { cols: number; rows: number };
  groundTruthTiles: number[];
  modelSelectedTiles: number[];
  tileDescriptions: Record<string, string>;
  splitObjects: Array<{ tileIndexA: number; tileIndexB: number }>;
  outcome: { ok: boolean; correct: number; wrong: number; missed: number };
}

export interface BuildStateInput {
  challenge: ChallengeRow;
  selected: number[];
  outcome: { ok: boolean; correct: number; wrong: number; missed: number };
}

/** Chặn cứng: state gửi cho evaluation model không được chứa ảnh. */
const FORBIDDEN = ['base64', 'data:image', '.png', '.jpg', '.jpeg', 'imagePath', 'screenshot'];

export function assertNoImageData(state: unknown): void {
  const serialized = JSON.stringify(state);
  const lower = serialized.toLowerCase();
  for (const needle of FORBIDDEN) {
    if (lower.includes(needle.toLowerCase())) {
      throw new Error(`judge state chứa dữ liệu ảnh: "${needle}"`);
    }
  }
}

export function buildJudgeState(input: BuildStateInput): JudgeState {
  const { challenge, selected, outcome } = input;

  const tileDescriptions: Record<string, string> = {};
  for (const tile of challenge.tiles) {
    const role = tile.isTarget ? 'khớp instruction' : 'không khớp';
    const shape = SHAPE_DESCRIPTION[tile.category];
    tileDescriptions[String(tile.index)] = `${tile.category} — ${shape} (${role})`;
  }

  const state: JudgeState = {
    instruction: `Select all images with ${challenge.target.replace(/_/g, ' ')}`,
    grid: { cols: challenge.grid.cols, rows: challenge.grid.rows },
    groundTruthTiles: challenge.tiles.filter((t) => t.isTarget).map((t) => t.index),
    modelSelectedTiles: [...selected].sort((a, b) => a - b),
    tileDescriptions,
    splitObjects: challenge.splitObjects.map((s) => ({
      tileIndexA: s.tileIndexA,
      tileIndexB: s.tileIndexB,
    })),
    outcome: { ok: outcome.ok, correct: outcome.correct, wrong: outcome.wrong, missed: outcome.missed },
  };

  assertNoImageData(state);
  return state;
}
