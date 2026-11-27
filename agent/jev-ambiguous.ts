// Ô nằm sát ngưỡng: cắt riêng ô đó, phóng to, rồi hỏi lại JEV chỉ về ô đó.
//
// Vì sao: trên lưới cảnh rối, ô thật có thể bị điểm thấp (37) trong khi ô nhiễu
// được điểm cao (56) — nhìn cả lưới thì click sai ô. Nhìn riêng một ô, JEV không
// còn phải phân xử giữa các ô với nhau, và ô được phóng lên 384px trước khi hỏi
// nên chi tiết không bị mất như ảnh lưới 390px.
//
// Chỉ đụng vào ô nằm trong dải mơ hồ. Ô đã click, ô quá rõ, đều không tốn lượt gọi.

import sharp from 'sharp';
import { solveGridWithJev } from './jev-solve.js';

/** Dải mơ hồ: dưới mức này là nhiễu, trên mức này là chắc chắn. */
const AMBIGUOUS_LOW = 0.3;
const AMBIGUOUS_HIGH = 0.72;
/** Ảnh một ô phải ≥ 280px (sàn API); 384 đủ chi tiết mà không phí token. */
const TILE_SIDE = 384;

export interface AmbiguousInput {
  apiKey: string;
  /** Ảnh lưới gốc, còn nguyên độ phân giải để cắt. */
  shot: Buffer;
  cols: number;
  rows: number;
  instruction: string;
  probabilities: Record<string, number>;
  threshold: number;
  /** Ô đã click trong challenge — không đụng tới, kể cả khi điểm thấp. */
  clicked: ReadonlySet<number>;
  jevModel?: string;
  maxTiles?: number;
  onLog: (msg: string) => void;
  onCost: (usd: number) => void;
}

export interface AmbiguousResult {
  probabilities: Record<string, number>;
  tiles: number[];
  checked: number;
}

const pct = (p: number): string => (p * 100).toFixed(0);

/** Cắt một ô rồi phóng lên TILE_SIDE, giữ đúng tỷ lệ ô. */
async function cropTileUp(shot: Buffer, index: number, cols: number, rows: number): Promise<Buffer | null> {
  const meta = await sharp(shot).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const tileW = Math.floor(width / cols);
  const tileH = Math.floor(height / rows);
  if (tileW < 8 || tileH < 8) return null;

  const col = index % cols;
  const row = Math.floor(index / cols);
  const w = col === cols - 1 ? width - col * tileW : tileW;
  const h = row === rows - 1 ? height - row * tileH : tileH;

  return sharp(shot)
    .extract({ left: col * tileW, top: row * tileH, width: w, height: h })
    .resize(TILE_SIDE, Math.max(280, Math.round((TILE_SIDE * h) / w)), { fit: 'fill' })
    .jpeg({ quality: 88 })
    .toBuffer();
}

/**
 * Hỏi lại JEV trên từng ô mơ hồ và trả về quyết định đã sửa.
 *
 * Không bao giờ trả ít hơn 0 ô khi có ứng viên: Google chấm thiếu ô là mềm, nộp
 * rỗng thì chắc chắn sai.
 */
export async function resolveAmbiguous(input: AmbiguousInput): Promise<AmbiguousResult> {
  const probabilities = { ...input.probabilities };
  const total = input.cols * input.rows;

  const candidates = Array.from({ length: total }, (_, i) => i)
    .filter((i) => !input.clicked.has(i))
    .map((i) => ({ tile: i, p: probabilities[`tile_${i}`] ?? 0 }))
    .filter((c) => c.p >= AMBIGUOUS_LOW && c.p <= AMBIGUOUS_HIGH)
    .sort((a, b) => b.p - a.p)
    .slice(0, input.maxTiles ?? 6);

  // Không ô nào qua ngưỡng, nhưng có ô khá: vẫn phải thử, đừng nộp rỗng.
  const above = Array.from({ length: total }, (_, i) => probabilities[`tile_${i}`] ?? 0).filter(
    (p) => p >= input.threshold,
  ).length;
  if (above === 0 && candidates.length === 0) {
    const best = Array.from({ length: total }, (_, i) => ({ tile: i, p: probabilities[`tile_${i}`] ?? 0 }))
      .filter((c) => !input.clicked.has(c.tile))
      .sort((a, b) => b.p - a.p)[0];
    if (best && best.p > 0.05) candidates.push(best);
  }

  let checked = 0;
  for (const candidate of candidates) {
    const crop = await cropTileUp(input.shot, candidate.tile, input.cols, input.rows);
    if (!crop) continue;
    try {
      const answer = await solveGridWithJev({
        apiKey: input.apiKey,
        imageBase64: crop.toString('base64'),
        cols: 1,
        rows: 1,
        threshold: input.threshold,
        instruction:
          `One tile cropped out of a ${input.rows}x${input.cols} captcha grid. ` +
          `Task: "${input.instruction}". Does this single tile show it?`,
        ...(input.jevModel ? { model: input.jevModel } : {}),
      });
      input.onCost(answer.costUsd ?? 0);
      const p2 = answer.probabilities.tile_0;
      if (typeof p2 !== 'number') continue;
      checked += 1;
      probabilities[`tile_${candidate.tile}`] = p2;
      input.onLog(`   ô mơ hồ ${candidate.tile}: ${pct(candidate.p)} → riêng ô ${pct(p2)}`);
    } catch (err) {
      input.onLog(`   ô mơ hồ ${candidate.tile}: hỏi lại lỗi (${err instanceof Error ? err.message.slice(0, 50) : 'không rõ'})`);
    }
  }

  const tiles = Array.from({ length: total }, (_, i) => i)
    .filter((i) => (probabilities[`tile_${i}`] ?? 0) >= input.threshold)
    .sort((a, b) => a - b);

  return { probabilities, tiles, checked };
}
