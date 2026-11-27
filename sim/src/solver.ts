// ClickSolver — mô phỏng đúng interface của harness trong openspec:
// solver nhận ảnh + instruction, trả danh sách tile nó tin là đáp án.
// Toạ độ hoá (tile -> tâm ô tuyệt đối) là việc của recaptcha.ts (coordSource: 'derived').

export interface SolverInput {
  imageBase64: string; // JPEG base64 (không có prefix data:)
  instruction: string;
  cols: number;
  rows: number;
}

export interface SolverOutput {
  tiles: number[]; // indices 0..cols*rows-1, đã sort, dedupe
  latencyMs: number;
  detail: string; // ghi vào log: model trả gì thô
}

export interface ClickSolver {
  name: string;
  solve(input: SolverInput): Promise<SolverOutput>;
}

const delay = (ms: number): Promise<void> => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
};

const cleanTiles = (raw: unknown, size: number): number[] => {
  const set = new Set<number>();
  if (Array.isArray(raw)) {
    for (const v of raw) {
      const n = typeof v === 'number' ? v : Number.parseInt(String(v), 10);
      if (Number.isInteger(n) && n >= 0 && n < size) set.add(n);
    }
  }
  return [...set].sort((a, b) => a - b);
};

/** Sàn nhiễu — baseline bắt buộc theo openspec (random solver). */
export function randomSolver(): ClickSolver {
  return {
    name: 'random',
    async solve({ cols, rows }) {
      const size = cols * rows;
      // đếm ô chọn ngẫu nhiên 2..4, kiểu người chơi đoán mò
      const k = 2 + Math.floor(Math.random() * 3);
      const tiles: number[] = [];
      while (tiles.length < Math.min(k, size)) {
        const t = Math.floor(Math.random() * size);
        if (!tiles.includes(t)) tiles.push(t);
      }
      const t0 = Date.now();
      await delay(300 + Math.random() * 400);
      return {
        tiles: tiles.sort((a, b) => a - b),
        latencyMs: Date.now() - t0,
        detail: `random pick [${tiles.join(',')}]`,
      };
    },
  };
}

/**
 * Vision solver qua Vercel AI Gateway (chat/completions, multimodal).
 * Chỉ dùng khi có AI_GATEWAY_API_KEY — model nhìn ảnh thật và chọn ô.
 * Host đúng của gateway là ai-gateway.vercel.sh.
 */
export function visionSolver(model = 'anthropic/claude-sonnet-4.5'): ClickSolver {
  return {
    name: `vision:${model}`,
    async solve({ imageBase64, instruction, cols, rows }) {
      const key = process.env.AI_GATEWAY_API_KEY;
      if (!key) throw new Error('AI_GATEWAY_API_KEY chưa set');
      const t0 = Date.now();
      const size = cols * rows;
      const systemPrompt =
        'You solve image-grid CAPTCHAs. You receive the challenge image and the instruction. ' +
        `The grid has ${rows} rows x ${cols} columns, tiles indexed 0..${size - 1} left-to-right, top-to-bottom. ` +
        'Return ONLY JSON: {"tiles": [indices of ALL tiles matching the instruction]}. No prose, no markdown.';
      const res = await fetch('https://ai-gateway.vercel.sh/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model,
          max_tokens: 1024,
          messages: [
            { role: 'system', content: systemPrompt },
            {
              role: 'user',
              content: [
                { type: 'text', text: instruction },
                {
                  type: 'image_url',
                  image_url: { url: `data:image/jpeg;base64,${imageBase64}` },
                },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(45_000),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`gateway ${res.status}: ${body.slice(0, 300)}`);
      }
      const json = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
        usage?: unknown;
      };
      const text = json.choices?.[0]?.message?.content ?? '';
      // parse JSON từ text (chấp nhận bọc trong code fence)
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) throw new Error(`no JSON in model output: ${text.slice(0, 200)}`);
      const parsed = JSON.parse(m[0]) as { tiles?: unknown };
      return {
        tiles: cleanTiles(parsed.tiles, size),
        latencyMs: Date.now() - t0,
        detail: `vision -> ${JSON.stringify(parsed)} usage=${JSON.stringify(json.usage ?? '')}`,
      };
    },
  };
}