// language: TypeScript, file: src/generator/distort.ts, runtime: Node 22
// Áp méo ảnh theo difficulty, chạy SAU khi ghép lưới (spec challenge-generation).
// `hard` cần blur σ≈1.2 và nén JPEG q=45 để đúng thềm nhiễu đã khai.

import sharp from 'sharp';
import type { Difficulty } from '../domain/challenge.js';

export interface DistortOptions {
  blurSigma: number;
  jpegQuality: number | null;
}

export const DISTORT_BY_DIFFICULTY: Readonly<Record<Difficulty, DistortOptions>> = {
  easy: { blurSigma: 0, jpegQuality: null },
  medium: { blurSigma: 0.6, jpegQuality: null },
  hard: { blurSigma: 1.2, jpegQuality: 45 },
};

/**
 * Trả PNG đã méo. `jpegQuality` khác null nghĩa là ép qua một vòng JPEG rồi
 * bọc lại PNG — giữ artifact nén mà đầu ra vẫn nhất quán một định dạng.
 */
export async function distort(input: Buffer, difficulty: Difficulty): Promise<Buffer> {
  const opts = DISTORT_BY_DIFFICULTY[difficulty];

  let pipeline = sharp(input);
  if (opts.blurSigma > 0) pipeline = pipeline.blur(opts.blurSigma);

  if (opts.jpegQuality === null) return pipeline.png({ compressionLevel: 9 }).toBuffer();

  const jpeg = await pipeline.jpeg({ quality: opts.jpegQuality, mozjpeg: true }).toBuffer();
  return sharp(jpeg).png({ compressionLevel: 9 }).toBuffer();
}
