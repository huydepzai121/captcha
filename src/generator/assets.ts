// language: TypeScript, file: src/generator/assets.ts, runtime: Node 22
// Nạp manifest và resolve đường dẫn file ảnh. Tách khỏi generate để đường sinh
// đề không phải biết gì về filesystem.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Manifest } from '../domain/challenge.js';

export const IMAGES_DIRNAME = path.join('assets', 'images');

export function loadManifest(rootDir: string): Manifest {
  const manifestPath = path.join(rootDir, IMAGES_DIRNAME, 'manifest.json');
  const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
  if (!Array.isArray(parsed.images)) throw new Error('manifest.images không phải mảng');
  if (parsed.images.length === 0) throw new Error('manifest rỗng — chạy "pnpm gen:assets"');
  return parsed;
}
