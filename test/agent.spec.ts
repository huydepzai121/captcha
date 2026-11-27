// language: TypeScript, file: test/agent.spec.ts
// Agent: cắt instruction của Google, tách mô tả khỏi phán đoán, và JEV là bên
// quyết định — kể cả khi JEV hỏng thì vẫn phải ra quyết định thay vì ném lỗi.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanInstruction, decideTilesWithJev, extractTarget } from '../agent/jev-decide.js';
import { parseFocusLines, parseTileDescriptions } from '../agent/vision.js';
import { solveGridWithJev } from '../agent/jev-solve.js';
import { tilesToClick } from '../agent/demo-agent.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const stubFetch = (payload: unknown, status = 200) => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init.body)) as Record<string, unknown> });
      return new Response(typeof payload === 'string' ? payload : JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return calls;
};

const answerSet = (probabilities: Record<string, number>) => ({
  model: 'typesafe-ai/jev',
  answers: Object.fromEntries(
    Object.entries(probabilities).map(([k, p]) => [k, { type: 'boolean', probability: p }]),
  ),
  usage: { inputTokens: 10, outputTokens: 2 },
  providerMetadata: { gateway: { cost: '0.00001' } },
});

const tiles = [
  { index: 0, description: 'a red fire hydrant on the corner', verdict: 'yes' as const },
  { index: 1, description: 'empty sky and a fence', verdict: 'no' as const },
  { index: 2, description: 'a fire hydrant far away', verdict: 'yes' as const },
];

describe('cắt instruction của Google', () => {
  it('bỏ đuôi "Click verify once there are none left"', () => {
    expect(cleanInstruction('Select all images with a fire hydrant Click verify once there are none left.')).toBe(
      'Select all images with a fire hydrant',
    );
    expect(cleanInstruction('Select all images with buses If there are none left, click verify.')).toBe(
      'Select all images with buses',
    );
  });

  it('trích được target, kể cả khi có mạo từ', () => {
    expect(extractTarget('Select all images with a fire hydrant Click verify once there are none left.')).toBe(
      'fire hydrant',
    );
    expect(extractTarget('Select all images with crosswalks')).toBe('crosswalks');
  });
});

describe('tách mô tả khỏi phán đoán', () => {
  it('cắt tiền tố yes/no, giữ mô tả', () => {
    const parsed = parseFocusLines('0|yes - a red hydrant\n1|no - empty sky', 2, 1);
    expect(parsed.verdicts).toEqual(['yes', 'no']);
    expect(parsed.descriptions).toEqual(['a red hydrant', 'empty sky']);
  });

  it('chịu được gạch đầu dòng, in đậm, thiếu dấu cách', () => {
    const parsed = parseFocusLines('- **3**|yes—a bus at the edge', 4, 1);
    expect(parsed.verdicts[3]).toBe('yes');
    expect(parsed.descriptions[3]).toBe('a bus at the edge');
  });

  it('dòng không có phán đoán → unknown, vẫn giữ mô tả', () => {
    const parsed = parseFocusLines('2: a yellow bus', 4, 1);
    expect(parsed.verdicts[2]).toBe('unknown');
    expect(parsed.descriptions[2]).toBe('a yellow bus');
  });

  it('bỏ qua chỉ số ngoài lưới và dòng rác', () => {
    const parsed = parseFocusLines('99|ngoài lưới\nrác\n1|yes - ok', 2, 1);
    expect(parsed.descriptions[1]).toBe('ok');
    expect(parsed.verdicts.filter((v) => v !== 'unknown')).toEqual(['yes']);
  });

  it('parseTileDescriptions chỉ trả mô tả', () => {
    expect(parseTileDescriptions('0|yes - a hydrant', 2, 1)).toEqual(['a hydrant', '']);
  });
});

describe('JEV quyết định', () => {
  it('gửi một câu boolean cho mỗi ô, mô tả không dính "yes -"', async () => {
    const calls = stubFetch(answerSet({ tile_0: 0.98, tile_1: 0.02, tile_2: 0.91 }));
    const decision = await decideTilesWithJev({ apiKey: 'k', instruction: 'Select all images with a fire hydrant', tiles });

    const body = calls[0]?.body as {
      questions: Record<string, { type: string; instructions: string; criteria: unknown }>;
      state: { tiles: Array<{ desc: string }> };
    };
    expect(calls[0]?.url).toBe('https://ai-gateway.vercel.sh/v1/evaluate');
    expect(Object.keys(body.questions)).toEqual(['tile_0', 'tile_1', 'tile_2']);
    expect(body.questions.tile_0?.type).toBe('boolean');
    expect(body.questions.tile_0?.criteria).toBeTruthy();
    expect(body.questions.tile_0?.instructions).toContain('a red fire hydrant');
    expect(body.questions.tile_0?.instructions).not.toContain('yes -');
    expect(body.state.tiles[0]?.desc).toContain('a red fire hydrant');
    expect(body.state.tiles[0]?.desc).not.toContain('yes');

    expect(decision.source).toBe('jev');
    expect(decision.degraded).toBe(false);
    expect(decision.tiles).toEqual([0, 2]);
    expect(decision.probabilities.tile_1).toBeCloseTo(0.02);
  });

  it('ngưỡng đổi được kết quả, kể cả ngưỡng 0', async () => {
    stubFetch(answerSet({ tile_0: 0.4, tile_1: 0.4, tile_2: 0.4 }));
    const low = await decideTilesWithJev({
      apiKey: 'k',
      instruction: 'Select all images with a fire hydrant',
      tiles,
      threshold: 0,
    });
    expect(low.tiles).toEqual([0, 1, 2]);

    stubFetch(answerSet({ tile_0: 0.4, tile_1: 0.4, tile_2: 0.4 }));
    const high = await decideTilesWithJev({
      apiKey: 'k',
      instruction: 'Select all images with a fire hydrant',
      tiles,
      threshold: 0.9,
    });
    expect(high.tiles).toEqual([]);
  });

  it('5xx hết lượt → không ném lỗi, rơi về phán đoán của vision', async () => {
    const calls = stubFetch({ error: 'x' }, 503);
    const decision = await decideTilesWithJev({
      apiKey: 'k',
      instruction: 'Select all images with a fire hydrant',
      tiles,
      attempts: 1,
      maxRetries: 0,
    });
    expect(calls).toHaveLength(1);
    expect(decision.source).toBe('vision-fallback');
    expect(decision.degraded).toBe(true);
    expect(decision.error).toMatch(/503/);
    expect(decision.tiles).toEqual([0, 2]);
  });

  it('vision không nói gì → vẫn chọn ô chưa rõ thay vì bỏ trắng', async () => {
    stubFetch({ error: 'x' }, 500);
    const decision = await decideTilesWithJev({
      apiKey: 'k',
      instruction: 'Select all images with a bus',
      tiles: [
        { index: 0, description: '', verdict: 'unknown' },
        { index: 1, description: 'sky', verdict: 'no' },
      ],
      attempts: 1,
      maxRetries: 0,
    });
    expect(decision.tiles).toEqual([0]);
  });

  it('thiếu answer cho một ô → JEV coi như hỏng, dùng dự phòng', async () => {
    stubFetch(answerSet({ tile_0: 0.9 }));
    const decision = await decideTilesWithJev({
      apiKey: 'k',
      instruction: 'Select all images with a fire hydrant',
      tiles,
      attempts: 1,
      maxRetries: 0,
    });
    expect(decision.degraded).toBe(true);
    expect(decision.source).toBe('vision-fallback');
  });

  it('không có ô nào thì không gọi mạng', async () => {
    const calls = stubFetch(answerSet({}));
    const decision = await decideTilesWithJev({ apiKey: 'k', instruction: 'x', tiles: [] });
    expect(calls).toHaveLength(0);
    expect(decision.tiles).toEqual([]);
    expect(decision.degraded).toBe(false);
  });

  it('lấy được chi phí từ providerMetadata', async () => {
    stubFetch(answerSet({ tile_0: 0.9, tile_1: 0.1, tile_2: 0.9 }));
    const decision = await decideTilesWithJev({ apiKey: 'k', instruction: 'Select all images with a fire hydrant', tiles });
    expect(decision.costUsd).toBeCloseTo(0.00001);
  });
});

describe('JEV đọc ảnh lưới', () => {
  const gridAnswer = (probabilities: Record<string, number>) => ({
    model: 'jev-1.14.0',
    answers: Object.fromEntries(
      Object.entries(probabilities).map(([k, p]) => [k, { type: 'noul', noul: p }]),
    ),
    usage: { input_tokens: 900, output_tokens: 40 },
    providerMetadata: { gateway: { cost: '0.0000213' } },
  });

  const stubGrid = (payload: unknown, status = 200) => {
    const calls: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({
          url: String(url),
          headers: (init.headers ?? {}) as Record<string, string>,
          body: JSON.parse(String(init.body)) as Record<string, unknown>,
        });
        return new Response(typeof payload === 'string' ? payload : JSON.stringify(payload), {
          status,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );
    return calls;
  };

  const solve = (overrides: Partial<Parameters<typeof solveGridWithJev>[0]> = {}) =>
    solveGridWithJev({
      apiKey: 'k',
      imageBase64: 'QkFTRTY0',
      cols: 2,
      rows: 2,
      instruction: 'Select all images with a bus',
      attempts: 1,
      ...overrides,
    });

  it('gửi ảnh qua assets + header danger-zone, hỏi noul theo toạ độ', async () => {
    const calls = stubGrid(gridAnswer({ tile_0: 0.97, tile_1: 0.01, tile_2: 0.88, tile_3: 0.02 }));
    const decision = await solve();

    expect(calls[0]?.url).toBe('https://api.typesafe.ai/v1/systemone');
    expect(calls[0]?.headers['TypeSafe-Danger-Zone-Images']).toBe('true');
    expect(calls[0]?.headers.authorization).toBe('Bearer k');

    const body = calls[0]?.body as {
      assets: Record<string, { type: string; format: string; data_base64: string }>;
      questions: Record<string, { type: string; instructions: string }>;
      state: { instruction: string };
    };
    expect(body.assets['grid-image']).toEqual({ type: 'image', format: 'jpg', data_base64: 'QkFTRTY0' });
    expect(Object.keys(body.questions)).toEqual(['tile_0', 'tile_1', 'tile_2', 'tile_3']);
    expect(body.questions.tile_2?.type).toBe('noul');
    expect(body.questions.tile_2?.instructions).toContain('row 2, column 1');
    expect(body.state.instruction).toBe('Select all images with a bus');

    expect(decision.tiles).toEqual([0, 2]);
    expect(decision.probabilities.tile_1).toBeCloseTo(0.01);
    expect(decision.costUsd).toBeCloseTo(0.0000213);
    expect(decision.degraded).toBe(false);
    expect(decision.source).toBe('jev');
  });

  it('tôn trọng ngưỡng', async () => {
    stubGrid(gridAnswer({ tile_0: 0.6, tile_1: 0.6, tile_2: 0.3, tile_3: 0.3 }));
    expect((await solve({ threshold: 0.5 })).tiles).toEqual([0, 1]);
    stubGrid(gridAnswer({ tile_0: 0.6, tile_1: 0.6, tile_2: 0.3, tile_3: 0.3 }));
    expect((await solve({ threshold: 0.9 })).tiles).toEqual([]);
  });

  it('thiếu answer cho vài ô → degraded nhưng vẫn trả kết quả', async () => {
    stubGrid(gridAnswer({ tile_0: 0.9, tile_3: 0.9 }));
    const decision = await solve();
    expect(decision.degraded).toBe(true);
    expect(decision.error).toMatch(/thiếu answer/);
    expect(decision.tiles).toEqual([0, 3]);
  });

  it('không answer nào → ném lỗi để tầng gọi còn đường lùi', async () => {
    stubGrid(gridAnswer({}));
    await expect(solve()).rejects.toThrow(/không trả lời ô nào/);
  });

  it('5xx → ném lỗi sau khi hết lượt', async () => {
    const calls = stubGrid({ error: 'down' }, 503);
    await expect(solve({ attempts: 2 })).rejects.toThrow(/503/);
    expect(calls).toHaveLength(2);
  });

  it('4xx → không thử lại', async () => {
    const calls = stubGrid({ message: 'images not turned on' }, 400);
    await expect(solve({ attempts: 3 })).rejects.toThrow(/400/);
    expect(calls).toHaveLength(1);
  });
});
describe('không click lại ô đã click', () => {
  it('bỏ ô đã click, ô ngoài lưới, ô trùng', () => {
    expect(tilesToClick([0, 3, 3, 9, -1, 5], 9, new Set([3]))).toEqual([0, 5]);
  });

  it('đã click hết thì không còn gì để click', () => {
    expect(tilesToClick([1, 2], 9, new Set([1, 2]))).toEqual([]);
  });

  it('số lẻ/không nguyên bị loại', () => {
    expect(tilesToClick([1.5, 2, 8], 9, new Set())).toEqual([2, 8]);
  });
});