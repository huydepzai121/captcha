// language: TypeScript, file: src/generator/compose.ts, runtime: Node 22
// Ghép lưới thành một ảnh PNG bằng sharp. Biết ô nào chứa ảnh nào, nên biết luôn
// vật thể nào bị cắt qua hai ô liền kề (chế độ `hard`) — ground truth cho
// `splitObjects`, không để judge tự suy diễn.

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp, { type OverlayOptions } from 'sharp';
import type { Challenge } from '../domain/challenge.js';

export const TILE_SIZE = 150;
export const TILE_GAP = 2;

/** Ảnh nguồn của một tile, đã resolve thành đường dẫn tuyệt đối. */
export interface TileImage {
  index: number;
  absPath: string;
}

export interface ComposeResult {
  width: number;
  height: number;
  /** sha256 của PNG — dùng cho test determinism. */
  sha256: string;
  buffer: Buffer;
}

export const gridPixelSize = (challenge: Challenge): { width: number; height: number } => ({
  width: challenge.grid.cols * TILE_SIZE + (challenge.grid.cols + 1) * TILE_GAP,
  height: challenge.grid.rows * TILE_SIZE + (challenge.grid.rows + 1) * TILE_GAP,
});

/** Vị trí pixel của một ô trong ảnh grid. */
export const tilePosition = (
  challenge: Challenge,
  index: number,
): { left: number; top: number } => {
  const col = index % challenge.grid.cols;
  const row = Math.floor(index / challenge.grid.cols);
  return {
    left: TILE_GAP + col * (TILE_SIZE + TILE_GAP),
    top: TILE_GAP + row * (TILE_SIZE + TILE_GAP),
  };
};

/**
 * Vật thể bị cắt: một khối SVG phủ qua ranh giới hai ô, canh giữa trên đường nối.
 * Chỉ dùng cho `hard`. Đây là thứ làm `splitObjects` thành sự thật nhìn thấy được
 * chứ không chỉ là một dòng trong store.
 */
const splitOverlay = (
  challenge: Challenge,
  a: number,
  b: number,
): { input: Buffer; left: number; top: number } => {
  const pa = tilePosition(challenge, a);
  const pb = tilePosition(challenge, b);
  const horizontal = pa.top === pb.top;

  const w = horizontal ? TILE_SIZE * 2 + TILE_GAP : TILE_SIZE;
  const h = horizontal ? TILE_SIZE : TILE_SIZE * 2 + TILE_GAP;
  const left = Math.min(pa.left, pb.left);
  const top = Math.min(pa.top, pb.top);
  const accent = '#d95f02';

  const shape = horizontal
    ? `<rect x="${w / 2 - 24}" y="${h * 0.28}" width="48" height="${h * 0.44}" rx="10" fill="${accent}"/>` +
      `<circle cx="${w / 2}" cy="${h * 0.28}" r="15" fill="${accent}"/>`
    : `<rect x="${w * 0.28}" y="${h / 2 - 24}" width="${w * 0.44}" height="48" rx="10" fill="${accent}"/>` +
      `<circle cx="${w * 0.28}" cy="${h / 2}" r="15" fill="${accent}"/>`;

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${shape}</svg>`;

  return { input: Buffer.from(svg), left, top };
};

const sha256 = (buf: Buffer): string => createHash('sha256').update(buf).digest('hex');

/**
 * Ghép lưới. Cùng challenge + cùng ảnh nguồn → cùng byte (test determinism so sha256).
 */
export async function compose(
  challenge: Challenge,
  tiles: readonly TileImage[],
): Promise<ComposeResult> {
  const { width, height } = gridPixelSize(challenge);

  const composites: OverlayOptions[] = [];
  for (const tile of tiles) {
    const { left, top } = tilePosition(challenge, tile.index);
    const buf = await sharp(tile.absPath).resize(TILE_SIZE, TILE_SIZE, { fit: 'fill' }).png().toBuffer();
    composites.push({ input: buf, left, top });
  }

  for (const split of challenge.splitObjects) {
    const overlay = splitOverlay(challenge, split.tileIndexA, split.tileIndexB);
    composites.push({ input: overlay.input, left: overlay.left, top: overlay.top });
  }

  const buffer = await sharp({
    create: { width, height, channels: 3, background: { r: 32, g: 33, b: 36 } },
  })
    .composite(composites)
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();

  return { width, height, sha256: sha256(buffer), buffer };
}

/** Ghép và ghi PNG xuống đĩa. */
export async function composeToFile(
  challenge: Challenge,
  tiles: readonly TileImage[],
  outPath: string,
): Promise<ComposeResult> {
  const result = await compose(challenge, tiles);
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, result.buffer);
  return result;
}
