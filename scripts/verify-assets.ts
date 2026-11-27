// language: TypeScript, file: scripts/verify-assets.ts, runtime: Node 22
// Kiểm tra image set khớp manifest (spec challenge-generation).
// Fail khi: file thiếu entry, entry thiếu file, entry thiếu license,
// hoặc category nào dưới ngưỡng ảnh tối thiểu.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { CATEGORIES, type Category, type Manifest } from '../src/domain/challenge.js';

const ROOT = process.cwd();
const IMAGES_DIR = path.join(ROOT, 'assets', 'images');
const MANIFEST_PATH = path.join(IMAGES_DIR, 'manifest.json');

/** Ngưỡng tối thiểu mỗi category (spec: "script fail nếu có category nào dưới 40 ảnh"). */
const MIN_PER_CATEGORY = 40;

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);

const fail = (msg: string): never => {
  console.error(`verify-assets FAIL: ${msg}`);
  process.exit(1);
};

const readManifest = (): Manifest => {
  let raw: string;
  try {
    raw = readFileSync(MANIFEST_PATH, 'utf8');
  } catch {
    return fail(`không đọc được ${path.relative(ROOT, MANIFEST_PATH)} — chạy "pnpm gen:assets" trước`);
  }
  const parsed = JSON.parse(raw) as Manifest;
  if (!Array.isArray(parsed.images)) fail('manifest.images không phải mảng');
  return parsed;
};

/** Mọi file ảnh có thật trên đĩa, theo category. */
const listOnDisk = (): Map<Category, string[]> => {
  const out = new Map<Category, string[]>();
  for (const category of CATEGORIES) {
    const dir = path.join(IMAGES_DIR, category);
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      names = [];
    }
    out.set(
      category,
      names
        .filter((n) => IMAGE_EXT.has(path.extname(n).toLowerCase()))
        .sort((a, b) => a.localeCompare(b)),
    );
  }
  return out;
};

const manifest = readManifest();
const onDisk = listOnDisk();

const problems: string[] = [];
const seen = new Set<string>();

for (const [i, entry] of manifest.images.entries()) {
  const where = `images[${i}]`;

  if (typeof entry.file !== 'string' || entry.file.length === 0) {
    problems.push(`${where}: thiếu "file"`);
    continue;
  }
  if (typeof entry.category !== 'string') {
    problems.push(`${where}: thiếu "category"`);
    continue;
  }
  if (!(CATEGORIES as readonly string[]).includes(entry.category)) {
    problems.push(`${where}: category lạ "${entry.category}"`);
    continue;
  }
  if (typeof entry.license !== 'string' || entry.license.trim().length === 0) {
    problems.push(`${where}: entry thiếu "license" (${entry.file})`);
  }
  if (typeof entry.source !== 'string' || entry.source.trim().length === 0) {
    problems.push(`${where}: entry thiếu "source" (${entry.file})`);
  }

  const rel = `${entry.category}/${entry.file}`;
  if (seen.has(rel)) problems.push(`${where}: entry trùng cho ${rel}`);
  seen.add(rel);

  const full = path.join(IMAGES_DIR, entry.category, entry.file);
  try {
    if (!statSync(full).isFile()) problems.push(`${where}: không phải file — ${rel}`);
  } catch {
    problems.push(`${where}: entry trỏ tới file không tồn tại — ${rel}`);
  }
}

// File có thật nhưng không có entry
for (const [category, files] of onDisk) {
  for (const name of files) {
    if (!seen.has(`${category}/${name}`)) {
      problems.push(`file thiếu entry trong manifest: ${category}/${name}`);
    }
  }
}

// Đủ ảnh mỗi category
for (const [category, files] of onDisk) {
  if (files.length < MIN_PER_CATEGORY) {
    problems.push(`category "${category}" chỉ có ${files.length} ảnh, cần >= ${MIN_PER_CATEGORY}`);
  }
}

if (problems.length > 0) {
  console.error(`verify-assets FAIL — ${problems.length} vấn đề:`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

const counts = [...onDisk].map(([c, f]) => `${c}=${f.length}`).join(' ');
console.log(`verify-assets OK — ${manifest.images.length} entry · ${counts}`);
