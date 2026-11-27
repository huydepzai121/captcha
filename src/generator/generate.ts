// language: TypeScript, file: src/generator/generate.ts, runtime: Node 22
// Sinh challenge lưới ảnh từ seed (spec challenge-generation).
// Toàn bộ đường sinh đề dùng PRNG có seed — không có Math.random trong file này.

import {
  CATEGORY_LABEL,
  CONFUSION_TABLE,
  GRID_BY_DIFFICULTY,
  TARGET_COUNT_BY_DIFFICULTY,
  type Category,
  type Challenge,
  type Difficulty,
  type ImageEntry,
  type SplitObject,
  type Tile,
} from '../domain/challenge.js';
import { intBetween, pick, sample, shuffle, type Rng } from './prng.js';

export interface ImagePool {
  byCategory: ReadonlyMap<Category, readonly ImageEntry[]>;
}

export interface GenerateOptions {
  difficulty?: Difficulty;
  target?: Category;
  /** Đường dẫn ảnh grid đã ghép. generate không tự ghi file. */
  imagePath?: string;
}

/** Gom manifest thành pool theo category. */
export function buildPool(images: readonly ImageEntry[]): ImagePool {
  const byCategory = new Map<Category, ImageEntry[]>();
  for (const entry of images) {
    const list = byCategory.get(entry.category);
    if (list) list.push(entry);
    else byCategory.set(entry.category, [entry]);
  }
  return { byCategory };
}

const categoriesOf = (pool: ImagePool): Category[] => [...pool.byCategory.keys()];

const requireEntries = (pool: ImagePool, category: Category): readonly ImageEntry[] => {
  const list = pool.byCategory.get(category);
  if (!list || list.length === 0) {
    throw new Error(`image pool rỗng cho category "${category}"`);
  }
  return list;
};

/**
 * Chọn category cho các ô sai. Ưu tiên bảng nhầm lẫn trước, nhưng giới hạn nửa
 * số ô để ảnh dễ nhầm không át hết lưới (spec: "Distractor gây nhầm có chủ đích").
 */
const chooseDistractors = (
  rng: Rng,
  pool: ImagePool,
  target: Category,
  count: number,
): Category[] => {
  const all = categoriesOf(pool);
  if (all.length === 0) throw new Error('image pool không có category nào');

  const confusable = CONFUSION_TABLE[target].filter((c) => pool.byCategory.has(c));
  const others = all.filter((c) => c !== target && !confusable.includes(c));

  const out: Category[] = [];
  const confusableQuota = Math.min(confusable.length, Math.ceil(count / 2));
  for (const c of sample(rng, confusable, confusableQuota)) out.push(c);

  const rest = shuffle(rng, [...confusable.filter((c) => !out.includes(c)), ...others]);
  for (const c of rest) {
    if (out.length >= count) break;
    out.push(c);
  }

  // Pool nghèo: lặp lại category nhiễu đã có. Ảnh vẫn khác nhau nhờ takeEntry.
  // Không bao giờ lặp target — ô đó sẽ chứa vật thể đúng nhưng bị gắn isTarget=false.
  const nonTarget = all.filter((c) => c !== target);
  if (nonTarget.length === 0) throw new Error('image pool không có category nhiễu nào');
  while (out.length < count) out.push(pick(rng, nonTarget));

  return out.slice(0, count);
};

/**
 * Cặp ô liền kề cho vật thể bị cắt. Chỉ trả cặp thật sự kề nhau trên lưới —
 * cặp chéo hoặc cách xa sẽ làm splitObjects vô nghĩa ở bước kiểm chứng.
 */
export function chooseSplitPairs(
  rng: Rng,
  cols: number,
  rows: number,
  count: number,
): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const i = r * cols + c;
      if (c + 1 < cols) pairs.push([i, i + 1]);
      if (r + 1 < rows) pairs.push([i, i + cols]);
    }
  }
  return sample(rng, pairs, Math.min(count, pairs.length));
}

export interface GenerateInput {
  seed: number;
  pool: ImagePool;
  rng: Rng;
  options?: GenerateOptions;
}

export function generate({ seed, pool, rng, options = {} }: GenerateInput): Challenge {
  const difficulty: Difficulty = options.difficulty ?? 'medium';
  const grid = GRID_BY_DIFFICULTY[difficulty];
  const size = grid.cols * grid.rows;

  const target = options.target ?? pick(rng, categoriesOf(pool));
  const [minT, maxT] = TARGET_COUNT_BY_DIFFICULTY[difficulty];
  const targetCount = intBetween(rng, minT, maxT);

  const indices = [...Array(size).keys()];
  const targetIndices = new Set(sample(rng, indices, targetCount));

  const distractorCategories = chooseDistractors(rng, pool, target, size - targetCount);

  // Không dùng lại cùng một ảnh trong một challenge, trừ khi pool quá nhỏ.
  const used = new Set<string>();
  const takeEntry = (category: Category): ImageEntry => {
    const list = requireEntries(pool, category);
    const fresh = list.filter((e) => !used.has(`${category}/${e.file}`));
    const chosen = fresh.length > 0 ? pick(rng, fresh) : pick(rng, list);
    used.add(`${category}/${chosen.file}`);
    return chosen;
  };

  const tiles: Tile[] = [];
  let d = 0;
  for (const index of indices) {
    const isTarget = targetIndices.has(index);
    const category = isTarget ? target : (distractorCategories[d++] ?? target);
    const entry = takeEntry(category);
    tiles.push({ index, source: entry.file, category, isTarget });
  }

  const splitObjects: SplitObject[] = [];
  if (difficulty === 'hard') {
    for (const [a, b] of chooseSplitPairs(rng, grid.cols, grid.rows, intBetween(rng, 1, 2))) {
      splitObjects.push({ tileIndexA: a, tileIndexB: b, category: target });
    }
  }

  return {
    id: `c${seed.toString(36)}`,
    seed,
    instruction: `Select all images with ${CATEGORY_LABEL[target]}`,
    target,
    grid,
    tiles,
    imagePath: options.imagePath ?? '',
    difficulty,
    splitObjects,
  };
}
