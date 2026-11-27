// language: TypeScript, file: scripts/gen-assets.ts, runtime: Node 22
// Sinh image set có nhãn bằng hình học tất định. Mỗi ảnh là một scene SVG
// rasterize bằng sharp. Nhãn là ground truth tuyệt đối vì chính script này vẽ ra.
//
// License: CC0-1.0 — tác phẩm sinh tự động, không phái sinh từ ảnh bên ngoài.
// Chạy: pnpm gen:assets

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { CATEGORIES, type ImageEntry, type Manifest } from '../src/domain/challenge.js';
import { CANVAS, renderScene } from '../src/assets/shapes.js';
import { mulberry32 } from '../src/generator/prng.js';

const ROOT = process.cwd();
const IMAGES_DIR = path.join(ROOT, 'assets', 'images');

/** Số ảnh mỗi category. Ngưỡng verify là 40; sinh dư để distractor không lặp. */
const PER_CATEGORY = 48;

const SEED_BASE = 0x5eed_0000;

const main = async (): Promise<void> => {
  rmSync(IMAGES_DIR, { recursive: true, force: true });
  mkdirSync(IMAGES_DIR, { recursive: true });

  const images: ImageEntry[] = [];

  for (const [ci, category] of CATEGORIES.entries()) {
    const dir = path.join(IMAGES_DIR, category);
    mkdirSync(dir, { recursive: true });

    for (let i = 0; i < PER_CATEGORY; i += 1) {
      const seed = SEED_BASE + ci * 1000 + i;
      const rng = mulberry32(seed);
      const svg = renderScene(category, rng);
      const file = `${category}-${String(i).padStart(3, '0')}.png`;

      await sharp(Buffer.from(svg), { density: 144 })
        .resize(CANVAS, CANVAS)
        .png({ compressionLevel: 9, palette: false })
        .toFile(path.join(dir, file));

      images.push({
        file,
        category,
        license: 'CC0-1.0',
        source: `procedurally generated (scripts/gen-assets.ts, seed=${seed})`,
      });
    }
    console.log(`  ${category}: ${PER_CATEGORY} ảnh`);
  }

  const manifest: Manifest = { images };
  writeFileSync(
    path.join(IMAGES_DIR, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );

  console.log(`gen:assets OK — ${images.length} ảnh → assets/images/`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
