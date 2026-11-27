// language: TypeScript, file: src/generator/prng.ts, runtime: Node 22
// PRNG có seed. Cấm Math.random trong toàn bộ đường sinh đề (xem spec
// challenge-generation: "cùng seed + cùng opts → kết quả giống hệt, kể cả byte ảnh").

export type Rng = () => number;

/** mulberry32 — 32-bit state, đủ tốt cho việc chọn tile, không dùng cho crypto. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Số nguyên trong [min, max] inclusive. */
export const intBetween = (rng: Rng, min: number, max: number): number =>
  min + Math.floor(rng() * (max - min + 1));

/** Số thực trong [min, max). */
export const floatBetween = (rng: Rng, min: number, max: number): number =>
  min + rng() * (max - min);

/** Chọn một phần tử; ném lỗi nếu mảng rỗng thay vì trả undefined im lặng. */
export function pick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new Error('pick: mảng rỗng');
  const item = items[Math.floor(rng() * items.length)];
  if (item === undefined) throw new Error('pick: index ngoài mảng');
  return item;
}

/** Fisher-Yates có seed — trả mảng mới, không sửa mảng gốc. */
export function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const a = out[i];
    const b = out[j];
    if (a === undefined || b === undefined) throw new Error('shuffle: index ngoài mảng');
    out[i] = b;
    out[j] = a;
  }
  return out;
}

/** Lấy k phần tử phân biệt. */
export function sample<T>(rng: Rng, items: readonly T[], k: number): T[] {
  if (k > items.length) throw new Error(`sample: xin ${k} nhưng chỉ có ${items.length}`);
  return shuffle(rng, items).slice(0, k);
}