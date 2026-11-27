// language: TypeScript, file: test/generator.spec.ts
// Determinism, biên số tile đúng, phủ category, splitObjects ở `hard`.

import { describe, expect, it } from 'vitest';
import { CATEGORIES, TARGET_COUNT_BY_DIFFICULTY, type Difficulty } from '../src/domain/challenge.js';
import { buildPool, generate } from '../src/generator/generate.js';
import { mulberry32 } from '../src/generator/prng.js';
import { loadManifest } from '../src/generator/assets.js';
import { compose } from '../src/generator/compose.js';
import path from 'node:path';

const ROOT = process.cwd();
const manifest = loadManifest(ROOT);
const pool = buildPool(manifest.images);

const tilesFor = (challenge: ReturnType<typeof generate>) =>
  challenge.tiles.map((t) => ({
    index: t.index,
    absPath: path.join(ROOT, 'assets', 'images', t.category, t.source),
  }));

describe('generate', () => {
  it('cùng seed + cùng opts cho cùng challenge', () => {
    const run = () =>
      generate({
        seed: 42,
        pool,
        rng: mulberry32(42),
        options: { difficulty: 'medium' },
      });

    const a = run();
    const b = run();
    const c = run();

    expect(a.target).toBe(b.target);
    expect(b.target).toBe(c.target);
    expect(a.tiles).toEqual(b.tiles);
    expect(b.tiles).toEqual(c.tiles);
    expect(a.splitObjects).toEqual(c.splitObjects);
  });

  it('seed khác cho đề khác', () => {
    const a = generate({ seed: 1, pool, rng: mulberry32(1) });
    const b = generate({ seed: 2, pool, rng: mulberry32(2) });
    const sameTarget = a.target === b.target;
    const sameTiles = JSON.stringify(a.tiles) === JSON.stringify(b.tiles);
    expect(sameTarget && sameTiles).toBe(false);
  });

  it('sha256 của ảnh ghép bằng nhau khi cùng seed', async () => {
    const build = () => generate({ seed: 7, pool, rng: mulberry32(7), options: { difficulty: 'medium' } });
    const first = await compose(build(), tilesFor(build()));
    const second = await compose(build(), tilesFor(build()));
    expect(first.sha256).toBe(second.sha256);
  });

  it('số tile đúng nằm trong biên của từng difficulty', () => {
    for (const difficulty of ['easy', 'medium', 'hard'] as Difficulty[]) {
      const [min, max] = TARGET_COUNT_BY_DIFFICULTY[difficulty];
      for (let seed = 0; seed < 120; seed += 1) {
        const challenge = generate({ seed, pool, rng: mulberry32(seed), options: { difficulty } });
        const count = challenge.tiles.filter((t) => t.isTarget).length;
        expect(count).toBeGreaterThanOrEqual(min);
        expect(count).toBeLessThanOrEqual(max);
        expect(count).toBeGreaterThan(0);
        expect(count).toBeLessThan(challenge.tiles.length);
      }
    }
  });

  it('1000 lần sinh phủ đủ mọi category', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 1000; seed += 1) {
      seen.add(generate({ seed, pool, rng: mulberry32(seed) }).target);
    }
    for (const category of CATEGORIES) expect(seen.has(category)).toBe(true);
  });

  it('hard sinh vật thể bị cắt, và cặp phải liền kề trên lưới', () => {
    for (let seed = 0; seed < 60; seed += 1) {
      const challenge = generate({ seed, pool, rng: mulberry32(seed), options: { difficulty: 'hard' } });
      expect(challenge.splitObjects.length).toBeGreaterThan(0);
      for (const split of challenge.splitObjects) {
        const { cols } = challenge.grid;
        const a = split.tileIndexA;
        const b = split.tileIndexB;
        const adjacent = Math.abs(a - b) === 1 || Math.abs(a - b) === cols;
        expect(adjacent).toBe(true);
      }
    }
  });

  it('easy không sinh splitObjects', () => {
    for (let seed = 0; seed < 30; seed += 1) {
      const challenge = generate({ seed, pool, rng: mulberry32(seed), options: { difficulty: 'easy' } });
      expect(challenge.splitObjects).toEqual([]);
      expect(challenge.grid.cols).toBe(3);
    }
  });

  it('ô nhiễu không bao giờ mang category của target', () => {
    for (const difficulty of ['easy', 'medium', 'hard'] as Difficulty[]) {
      for (let seed = 0; seed < 200; seed += 1) {
        const challenge = generate({ seed, pool, rng: mulberry32(seed), options: { difficulty } });
        for (const tile of challenge.tiles) {
          expect(tile.isTarget).toBe(tile.category === challenge.target);
        }
      }
    }
  });

  it('không dùng lại cùng ảnh trong một challenge', () => {
    for (let seed = 0; seed < 50; seed += 1) {
      const challenge = generate({ seed, pool, rng: mulberry32(seed) });
      const keys = challenge.tiles.map((t) => `${t.category}/${t.source}`);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});
