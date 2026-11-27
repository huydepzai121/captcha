// language: TypeScript, file: test/solvers.spec.ts
// pointToTile, baseline oracle/random, adapter vision parse qua fetch giả.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { pointToTile } from '../src/domain/solver.js';
import { gatewayVisionSolver, oracleSolver, randomSolver } from '../src/solvers/index.js';
import type { Tile } from '../src/domain/challenge.js';

const gridBox = { x: 100, y: 200, w: 400, h: 400 };
const grid = { cols: 4, rows: 4 };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('pointToTile', () => {
  it('ánh xạ tâm ô về đúng chỉ số', () => {
    for (let row = 0; row < 4; row += 1) {
      for (let col = 0; col < 4; col += 1) {
        const x = gridBox.x + (col + 0.5) * 100;
        const y = gridBox.y + (row + 0.5) * 100;
        expect(pointToTile({ x, y }, gridBox, grid)).toBe(row * 4 + col);
      }
    }
  });

  it('điểm ngoài gridBox trả null', () => {
    expect(pointToTile({ x: 99, y: 300 }, gridBox, grid)).toBeNull();
    expect(pointToTile({ x: 300, y: 199 }, gridBox, grid)).toBeNull();
    expect(pointToTile({ x: 500, y: 300 }, gridBox, grid)).toBeNull();
    expect(pointToTile({ x: 300, y: 600 }, gridBox, grid)).toBeNull();
  });

  it('góc trên-trái thuộc ô 0, góc dưới-phải thuộc ô cuối', () => {
    expect(pointToTile({ x: 100, y: 200 }, gridBox, grid)).toBe(0);
    expect(pointToTile({ x: 499.9, y: 599.9 }, gridBox, grid)).toBe(15);
  });
});

describe('oracle', () => {
  const tiles: Tile[] = [
    { index: 0, source: 'a.png', category: 'bridge', isTarget: true },
    { index: 1, source: 'b.png', category: 'bus', isTarget: false },
    { index: 5, source: 'c.png', category: 'bridge', isTarget: true },
  ];

  it('click đúng tâm mọi ô target và quy đổi ngược lại đúng chỉ số', async () => {
    const result = await oracleSolver(tiles).solve({
      screenshot: Buffer.alloc(0),
      instruction: 'Select all images with bridges',
      grid,
      gridBox,
      challengeId: 'c1',
    });
    const back = result.clicks.map((c) => pointToTile(c, gridBox, grid));
    expect(back).toEqual([0, 5]);
    expect(result.coordSource).toBe('derived');
  });

  it('không đọc store — chạy được khi không có store nào', async () => {
    const solver = oracleSolver(tiles);
    await expect(
      solver.solve({
        screenshot: Buffer.alloc(0),
        instruction: 'x',
        grid,
        gridBox,
        challengeId: 'không-tồn-tại',
      }),
    ).resolves.toBeDefined();
  });
});

describe('random', () => {
  it('luôn trả toạ độ nằm trong lưới', async () => {
    const solver = randomSolver(4);
    for (let i = 0; i < 30; i += 1) {
      const result = await solver.solve({
        screenshot: Buffer.alloc(0),
        instruction: 'x',
        grid,
        gridBox,
        challengeId: 'c1',
      });
      const tiles = result.clicks.map((c) => pointToTile(c, gridBox, grid));
      expect(tiles).toHaveLength(4);
      for (const tile of tiles) expect(tile).not.toBeNull();
    }
  });
});

describe('gateway vision adapter', () => {
  const stubFetch = (payload: unknown, status = 200) => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url: String(url), body: JSON.parse(String(init.body)) as Record<string, unknown> });
        return new Response(JSON.stringify(payload), {
          status,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );
    return calls;
  };

  const solveWith = (apiKey = 'k') =>
    gatewayVisionSolver({ apiKey }).solve({
      screenshot: Buffer.from('fake-png'),
      instruction: 'Select all images with bridges',
      grid,
      gridBox,
      challengeId: 'c1',
    });

  it('gọi host ai-gateway.vercel.sh và parse tiles', async () => {
    const calls = stubFetch({
      choices: [{ message: { content: '{"tiles":[0,5]}' } }],
      usage: { prompt_tokens: 10, completion_tokens: 4 },
    });
    const result = await solveWith();
    expect(calls[0]?.url).toBe('https://ai-gateway.vercel.sh/v1/chat/completions');
    expect(result.clicks.map((c) => pointToTile(c, gridBox, grid))).toEqual([0, 5]);
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 4 });
  });

  it('lọc chỉ số ngoài lưới và trùng lặp', async () => {
    stubFetch({ choices: [{ message: { content: '{"tiles":[0,0,99,-3,5]}' } }] });
    const result = await solveWith();
    expect(result.clicks).toHaveLength(2);
  });

  it('dạng liệt kê từng ô: chỉ click ô có match=true', async () => {
    const cells = Array.from({ length: 16 }, (_, i) => ({ i, what: 'x', match: i === 3 || i === 12 }));
    const calls = stubFetch({ choices: [{ message: { content: JSON.stringify({ cells }) } }] });
    const result = await solveWith();
    expect(result.clicks.map((c) => pointToTile(c, gridBox, grid))).toEqual([3, 12]);
    const messages = calls[0]?.body.messages as Array<{ role: string; content: string }>;
    expect(messages[0]?.content).toContain('"cells"');
  });

  it('output không có JSON → 0 click, giữ rawResponse', async () => {
    stubFetch({ choices: [{ message: { content: 'xin lỗi, tôi không chắc' } }] });
    const result = await solveWith();
    expect(result.clicks).toEqual([]);
    expect(result.rawResponse).toContain('không chắc');
  });

  it('HTTP lỗi thì ném ra ngoài (không retry tại adapter)', async () => {
    stubFetch({ error: 'unauthorized' }, 401);
    await expect(solveWith()).rejects.toThrow(/gateway 401/);
  });
});
