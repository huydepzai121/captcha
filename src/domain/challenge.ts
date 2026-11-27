// language: TypeScript, file: src/domain/challenge.ts, runtime: Node 22
// Chỉ type, không logic (theo tasks.md 1.2).

export type Category =
  | 'bridge'
  | 'fire_hydrant'
  | 'bicycle'
  | 'bus'
  | 'traffic_light'
  | 'crosswalk';

export type Difficulty = 'easy' | 'medium' | 'hard';

export const CATEGORIES: readonly Category[] = [
  'bridge',
  'fire_hydrant',
  'bicycle',
  'bus',
  'traffic_light',
  'crosswalk',
];

export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard'];

/**
 * Category dễ nhầm với target — dùng để chọn distractor có chủ đích thay vì
 * rải đều ngẫu nhiên (spec challenge-generation: "Distractor gây nhầm có chủ đích").
 */
export const CONFUSION_TABLE: Readonly<Record<Category, readonly Category[]>> = {
  bridge: ['crosswalk', 'bus'],
  fire_hydrant: ['traffic_light', 'bicycle'],
  bicycle: ['bus', 'fire_hydrant'],
  bus: ['bicycle', 'traffic_light', 'crosswalk'],
  traffic_light: ['fire_hydrant', 'bus'],
  crosswalk: ['bridge', 'bus'],
};

export interface Grid {
  cols: number;
  rows: number;
}

export interface Tile {
  index: number;
  /** Tên file trong assets/images/<category>/. Ground truth — không bao giờ rời server. */
  source: string;
  category: Category;
  isTarget: boolean;
}

/** Vật thể bị cắt qua hai ô liền kề. Chỉ sinh ở difficulty `hard`. */
export interface SplitObject {
  tileIndexA: number;
  tileIndexB: number;
  category: Category;
}

/** Nhãn người/asset cho một ảnh nguồn. */
export interface ImageEntry {
  file: string;
  category: Category;
  license: string;
  source: string;
}

export interface Manifest {
  images: ImageEntry[];
}

export interface Challenge {
  id: string;
  seed: number;
  /** "Select all images with bridges" */
  instruction: string;
  target: Category;
  grid: Grid;
  /** length = cols*rows, thứ tự row-major. */
  tiles: Tile[];
  /** Đường dẫn ảnh grid đã ghép (PNG). */
  imagePath: string;
  difficulty: Difficulty;
  splitObjects: SplitObject[];
}

export const GRID_BY_DIFFICULTY: Readonly<Record<Difficulty, Grid>> = {
  easy: { cols: 3, rows: 3 },
  medium: { cols: 4, rows: 4 },
  hard: { cols: 4, rows: 4 },
};

/** Số tile đúng nằm trong biên của difficulty. Không bao giờ 0, không bao giờ toàn bộ. */
export const TARGET_COUNT_BY_DIFFICULTY: Readonly<Record<Difficulty, readonly [number, number]>> = {
  easy: [2, 5],
  medium: [1, 6],
  hard: [1, 6],
};

/** Nhãn hiển thị cho instruction, giữ đúng dạng "Select all images with X". */
export const CATEGORY_LABEL: Readonly<Record<Category, string>> = {
  bridge: 'bridges',
  fire_hydrant: 'fire hydrants',
  bicycle: 'bicycles',
  bus: 'buses',
  traffic_light: 'traffic lights',
  crosswalk: 'crosswalks',
};

export const isCategory = (value: string): value is Category =>
  (CATEGORIES as readonly string[]).includes(value);

export const isDifficulty = (value: string): value is Difficulty =>
  (DIFFICULTIES as readonly string[]).includes(value);