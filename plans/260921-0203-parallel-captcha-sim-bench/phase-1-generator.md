# Phase 1 — Scaffold + Challenge Generator

Phụ thuộc: không. Blocker: chốt nguồn image set (câu hỏi mở #1).

## Mục tiêu

Sinh được challenge image-grid có ground truth xác định, tái lập được từ seed.

## Files

```
package.json, tsconfig.json, .eslintrc.cjs
src/domain/challenge.ts        # type Challenge, Tile, Category, Difficulty
src/generator/generate.ts      # seed -> Challenge
src/generator/compose.ts       # ghép tile thành 1 ảnh grid (sharp)
src/generator/distort.ts       # noise / blur / occlusion / jpeg artifact
assets/images/<category>/*.jpg # image set có nhãn
assets/images/manifest.json    # {file, category, license, source}
scripts/verify-assets.ts       # check manifest khớp file + có license
test/generator.spec.ts
```

## Contract

```ts
type Category = 'bridge' | 'fire_hydrant' | 'bicycle' | 'bus' | 'traffic_light' | 'crosswalk';
type Difficulty = 'easy' | 'medium' | 'hard';

interface Challenge {
  id: string;
  seed: number;
  instruction: string;        // "Select all images with bridges"
  target: Category;
  grid: { cols: number; rows: number };   // 3x3 easy, 4x4 medium/hard
  tiles: Tile[];              // length = cols*rows, theo thứ tự row-major
  imagePath: string;          // ảnh grid đã ghép, PNG
  difficulty: Difficulty;
}

interface Tile { index: number; source: string; isTarget: boolean; }

generate(seed: number, opts?: { difficulty?: Difficulty; target?: Category }): Challenge
```

## Quy tắc sinh

- Số tile đúng: 2–5 (easy), 1–6 (medium/hard). Không bao giờ 0, không bao giờ toàn bộ.
- Distractor ưu tiên category dễ nhầm (bus ↔ traffic_light cùng cảnh đường phố).
- `hard` thêm: một object bị cắt qua 2 tile liền kề; blur σ≈1.2; JPEG q=45.
- Cùng `seed` + cùng `opts` → `Challenge` giống hệt, kể cả byte của `imagePath`.
  Test bằng sha256 của file ảnh.

## Steps

1. Scaffold TS strict, eslint, vitest. `pnpm` làm package manager.
2. Định nghĩa `src/domain/challenge.ts`. Không có logic ở đây, chỉ type.
3. Thu thập image set. Mỗi entry trong `manifest.json` bắt buộc có `license` và
   `source`. `scripts/verify-assets.ts` chạy trong `pretest`, fail nếu thiếu.
   Tối thiểu 40 ảnh/category để distractor không lặp trong 1 run 200 trial.
4. `generate.ts`: PRNG có seed (`mulberry32`, không dùng `Math.random`).
5. `compose.ts` (sharp): resize tile về 150x150, ghép, viền 2px.
6. `distort.ts`: áp theo `difficulty`, sau khi ghép.
7. Tests.

## Validation

- `pnpm test test/generator.spec.ts`
- Determinism: `generate(42)` chạy 3 lần → 3 sha256 bằng nhau.
- Phân bố: 1000 lần generate → mọi category xuất hiện, số tile đúng nằm trong range.
- `pnpm verify-assets` pass.

## Risk / rollback

Risk: image set license không rõ → không dùng được. Mitigation: chốt nguồn TRƯỚC
khi code compose. Rollback: phase độc lập, xoá `src/generator/` là sạch.
