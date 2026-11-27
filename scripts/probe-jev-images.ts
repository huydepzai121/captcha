// language: TypeScript, file: scripts/probe-jev-images.ts, runtime: Node 22
// Thử JEV với ẢNH THẬT: endpoint TypeSafe + header danger-zone + `assets`.
// Kiểm tra ba thứ: (1) noul trên một ảnh, (2) box trên một ảnh, (3) noul theo
// toạ độ ô trên một lưới ghép — đúng dạng bài captcha cần.
//
// Chạy: node --env-file=.env --import tsx scripts/probe-jev-images.ts

import { readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { compose } from '../src/generator/compose.js';
import { loadManifest } from '../src/generator/assets.js';
import { CATEGORIES, type Category, type Challenge, type Tile } from '../src/domain/challenge.js';

const BASE = 'https://api.typesafe.ai';
const MODEL = 'jev-latest';
const apiKey = process.env.AI_GATEWAY_API_KEY;
if (!apiKey) throw new Error('thiếu AI_GATEWAY_API_KEY');

const headers = {
  'content-type': 'application/json',
  authorization: `Bearer ${apiKey}`,
  'TypeSafe-Danger-Zone-Images': 'true',
};

interface Asset {
  type: 'image';
  format: 'jpg';
  data_base64: string;
}

/** Ảnh gửi đi phải ≥280px mỗi cạnh (giới hạn của TypeSafe). */
const encode = async (file: string): Promise<Asset> => {
  const buf = await sharp(file).resize(448, 448, { fit: 'inside' }).jpeg({ quality: 82 }).toBuffer();
  return { type: 'image', format: 'jpg', data_base64: buf.toString('base64') };
};

const call = async (label: string, body: unknown): Promise<void> => {
  const r = await fetch(`${BASE}/v1/systemone`, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await r.text();
  console.log(`\n${label} -> ${r.status}`);
  console.log(text.replace(/\s+/g, ' ').slice(0, 900));
};

const busFile = path.join('assets', 'images', 'bus', 'bus-000.png');
const bus = await encode(busFile);
const busKey = 'a1-bus';

await call('noul trên một ảnh', {
  model: MODEL,
  state: { photo: busKey },
  assets: { [busKey]: bus },
  questions: { has_bus: { type: 'noul', instructions: 'Does `photo` contain a bus?' } },
});

await call('box trên một ảnh', {
  model: MODEL,
  state: { photo: busKey },
  assets: { [busKey]: bus },
  questions: { where: { type: 'box', instructions: 'Where is the bus in `photo`?' } },
});

// ── lưới 3x3, hỏi từng ô theo toạ độ ────────────────────────────────
const manifest = loadManifest(process.cwd());
const byCategory = new Map<Category, string[]>();
for (const entry of manifest.images) {
  const list = byCategory.get(entry.category) ?? [];
  list.push(String(entry.file));
  byCategory.set(entry.category, list);
}

const target: Category = 'bus';
const order: Category[] = [target, 'crosswalk', target, 'traffic_light', 'bus', 'bridge', 'bicycle', target, 'fire_hydrant'];
const tiles: Tile[] = order.map((category, index) => ({
  index,
  category,
  isTarget: category === target,
  source: (byCategory.get(category) ?? [])[index % 5] ?? `${category}-000.png`,
}));

const challenge: Challenge = {
  id: 'probe',
  seed: 1,
  instruction: `Select all images with ${target}`,
  target,
  grid: { cols: 3, rows: 3 },
  tiles,
  imagePath: '',
  difficulty: 'medium',
  splitObjects: [],
};

const composed = await compose(
  challenge,
  tiles.map((t) => ({ index: t.index, absPath: path.join('assets', 'images', t.category, t.source) })),
);
const gridAsset: Asset = {
  type: 'image',
  format: 'jpg',
  data_base64: (await sharp(composed.buffer).jpeg({ quality: 85 }).toBuffer()).toString('base64'),
};
const gridKey = 'b2-grid';

const questions: Record<string, unknown> = {};
for (let row = 0; row < 3; row += 1) {
  for (let col = 0; col < 3; col += 1) {
    questions[`r${row}c${col}`] = {
      type: 'noul',
      instructions: `In \`grid\`, does the tile at row ${row + 1}, column ${col + 1} (counting from the top-left) contain a bus?`,
    };
  }
}

await call('noul từng ô trên lưới (đáp án đúng: 0,2,4,7)', {
  model: MODEL,
  state: { grid: gridKey, gridSize: '3 rows x 3 columns' },
  assets: { [gridKey]: gridAsset },
  questions,
});

console.log('\nthứ tự ô:', order.map((c, i) => `${i}:${c}`).join(' '));
