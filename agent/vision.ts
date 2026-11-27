// language: TypeScript, file: agent/vision.ts, runtime: Node 22
// Tầng mắt: gọi model vision qua AI Gateway để mô tả từng ô trong ảnh lưới.
//
// Model: google/gemini-3.5-flash-lite — rẻ, hỗ trợ image input, context 1M.
//
// LOAD-BEARING: phải tắt reasoning. Đo trên lưới 3x3 thật:
//   reasoning bật  → 60s, $0.019,  15.6k reasoning token, content rỗng vì chạm trần
//   reasoning tắt  → 2.5s, $0.00018, 0 reasoning token, 9/9 ô có mô tả
// Tắt reasoning là điều kiện để agent chạy được trong ngân sách thời gian.

import { DEFAULT_VISION_MODEL, GATEWAY_BASE } from './config.js';

/** Mặc định đọc từ config (deepseek/deepseek-v4.1-flash) — cùng nguồn với config.ts. */
export const VISION_MODEL = DEFAULT_VISION_MODEL;

/**
 * Phán đoán RIÊNG của tầng mắt, tách khỏi mô tả.
 *
 * Lý do tách: JEV là bên phải quyết định. Nếu mô tả còn dính chữ "yes —" thì JEV
 * chỉ việc gật theo model, và ta không còn biết tầng não có tác dụng gì. Tách ra
 * thì JEV đọc mô tả thuần, còn phán đoán của vision chỉ dùng làm dự phòng khi
 * JEV hỏng, hoặc để đối chiếu khi phân tích sau.
 */
export type TileVerdict = 'yes' | 'no' | 'unknown';

export interface VisionResult {
  /** Mô tả thuần, đã bỏ tiền tố yes/no. Rỗng nghĩa là model không mô tả được ô đó. */
  descriptions: string[];
  /** Song song với `descriptions`, cùng độ dài. */
  verdicts: TileVerdict[];
  latencyMs: number;
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  costUsd?: number | undefined;
  raw: string;
}

interface ChatResponse {
  choices?: Array<{ message?: { content?: string; reasoning?: string } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    cost?: number;
  };
}

/**
 * Prompt yêu cầu định dạng `<số ô>|<mô tả>`.
 *
 * Load-bearing: mô tả phải bằng TIẾNG ANH, cùng ngôn ngữ với đề của Google.
 * Đo thực tế: đề "Select all squares with a bus" nhưng mô tả trả về "xe buýt
 * vàng" — JEV bị hỏi "ô này có chứa bus không" và phải tự dịch mới trả lời được.
 * Chỗ dịch hụt là chỗ ô đúng bị bỏ sót.
 */
const buildPrompt = (cols: number, rows: number, instruction: string): string => {
  const total = cols * rows;
  return [
    `The image is a grid of ${rows} rows x ${cols} columns, ${total} tiles total, numbered row-major from 0 to ${total - 1}.`,
    `Task: "${instruction}".`,
    '',
    'For EVERY tile, print exactly one line in this format:',
    '<tile number>|<every object and context visible in that tile>',
    '',
    'RULES:',
    `- Exactly ${total} lines, in order from 0 to ${total - 1}.`,
    '- Write every description in ENGLISH only. Never use any other language.',
    '- List EVERYTHING: person, vehicle, object, tree, building, road, pole, sign, sky.',
    '- Do NOT skip small objects, edge-cropped objects, or partially hidden ones.',
    '- For an empty tile write "empty" plus context (e.g. "empty, grass only").',
    '- Max 16 words per line.',
    '- No headers, no markdown tables, no extra explanation.',
  ].join('\n');
};

/**
 * Prompt hẹp cho lượt kiểm tra: hỏi thẳng từng ô có chứa target không.
 * Dùng khi lượt đầu trả về 0 ô — dấu hiệu model bỏ sót.
 */
const buildFocusPrompt = (cols: number, rows: number, target: string): string => {
  const total = cols * rows;
  return [
    `The image is a grid of ${rows} rows x ${cols} columns, ${total} tiles total, numbered 0 to ${total - 1}.`,
    '',
    `Look carefully at each tile. Which tiles contain "${target}"?`,
    'Count small, partially hidden, edge-cropped, or oddly colored objects too.',
    '',
    'Print exactly one line for EVERY tile, written in ENGLISH only:',
    `<tile number>|<yes/no> - <short description, clearly stating whether that tile contains "${target}">`,
    '',
    `Exactly ${total} lines, in order from 0 to ${total - 1}. No headers, no markdown.`,
  ].join('\n');
};

/**
 * Parse `<số>|<mô tả>` hoặc `<số>: <mô tả>` — kèm phán đoán yes/no nếu dòng có.
 *
 * Quét mọi dòng có dạng đó thay vì khớp cứng một tiền tố, vì model có thể thêm
 * gạch đầu dòng, in đậm quanh số, hoặc (khi dùng prompt hẹp) mở đầu bằng yes/no.
 * Tiền tố yes/no bị CẮT khỏi mô tả để tầng não không bị neo sẵn đáp án.
 */
const LINE = /^\s*[-*\s]*\**\s*(\d{1,2})\s*\**\s*[|:：]\s*(.*)$/;
const VERDICT = /^(yes|no|y|n|có|không)\b\s*(?:[-–—:]\s*)?(.*)$/i;

export function parseFocusLines(
  text: string,
  cols: number,
  rows: number,
): { descriptions: string[]; verdicts: TileVerdict[] } {
  const total = cols * rows;
  const descriptions: string[] = new Array<string>(total).fill('');
  const verdicts: TileVerdict[] = new Array<TileVerdict>(total).fill('unknown');

  for (const line of text.split(/\r?\n/)) {
    const match = line.match(LINE);
    if (!match) continue;
    const index = Number.parseInt(match[1] ?? '', 10);
    if (!Number.isInteger(index) || index < 0 || index >= total) continue;

    let rest = (match[2] ?? '').replace(/\*+/g, '').trim();
    const verdict = rest.match(VERDICT);
    if (verdict) {
      verdicts[index] = /^(yes|y|có)$/i.test(verdict[1]!) ? 'yes' : 'no';
      rest = (verdict[2] ?? '').trim();
    }
    if (rest.length > 0) descriptions[index] = rest;
  }

  return { descriptions, verdicts };
}

/** Chỉ lấy mô tả, bỏ phán đoán — dùng cho prompt mô tả chung. */
export function parseTileDescriptions(text: string, cols: number, rows: number): string[] {
  return parseFocusLines(text, cols, rows).descriptions;
}

export interface DescribeInput {
  apiKey: string;
  imageBase64: string;
  cols: number;
  rows: number;
  instruction: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
  /**
   * Tắt reasoning của model. Mặc định theo model: true cho `deepseek/*`
   * (reasoning bật: 60s/$0.019 — tắt: 2.5s/$0.00018), false cho phần còn lại
   * (gemini nhận trường này và bị chậm 2.2s → 7.8s).
   */
  disableReasoning?: boolean;
  /**
   * Lượt kiểm tra: hỏi thẳng từng ô có chứa target không, thay vì mô tả
   * chung rồi để JEV suy.
   */
  focusTarget?: string;
}

export async function describeTiles(input: DescribeInput): Promise<VisionResult> {
  const model = input.model ?? VISION_MODEL;
  const baseUrl = input.baseUrl ?? GATEWAY_BASE;
  // Mặc định theo model: deepseek là reasoning model (60s/$0.019 khi bật,
  // 2.5s/$0.00018 khi tắt), còn gemini nhận tham số này thành chậm hơn.
  const disableReasoning = input.disableReasoning ?? model.startsWith('deepseek/');
  const prompt = input.focusTarget
    ? buildFocusPrompt(input.cols, input.rows, input.focusTarget)
    : buildPrompt(input.cols, input.rows, input.instruction);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 45_000);
  const t0 = Date.now();

  try {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 2500,
        ...(disableReasoning ? { reasoning: { enabled: false } } : {}),
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              {
                type: 'image_url',
                image_url: { url: `data:image/jpeg;base64,${input.imageBase64}` },
              },
            ],
          },
        ],
      }),
      signal: controller.signal,
    });

    const text = await res.text();
    if (!res.ok) {
      throw new Error(`vision HTTP ${res.status}: ${text.slice(0, 300)}`);
    }

    const json = JSON.parse(text) as ChatResponse;
    const content = json.choices?.[0]?.message?.content ?? '';
    const parsed = parseFocusLines(content, input.cols, input.rows);

    return {
      descriptions: parsed.descriptions,
      verdicts: parsed.verdicts,
      latencyMs: Date.now() - t0,
      inputTokens: json.usage?.prompt_tokens,
      outputTokens: json.usage?.completion_tokens,
      costUsd: json.usage?.cost,
      raw: content,
    };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('vision: quá thời gian chờ');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export interface VerifyTilesInput {
  apiKey: string;
  target: string;
  /** Các ô nghi vấn: chỉ số ô trong lưới + ảnh ô đã crop (base64 JPEG). */
  tiles: { index: number; imageBase64: string }[];
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export interface VerifyTilesResult {
  /** Chỉ số ô (theo `tiles[].index`) được trả lời "yes". */
  yes: Set<number>;
  latencyMs: number;
  costUsd?: number | undefined;
  raw: string;
}

/**
 * Lượt kiểm tra chót cho các ô nằm vùng chắn (JEV trả xác suất giữa 0.2 và
 * 0.8): crop đúng ô đó, gửi kèm câu hỏi có/không — MỘT lượt gọi cho mọi ô.
 * Ảnh ô riêng lẻ cho tín hiệu trực tiếp hơn là mô tả chung cả lưới.
 */
export async function verifyTiles(input: VerifyTilesInput): Promise<VerifyTilesResult> {
  if (input.tiles.length === 0) {
    return { yes: new Set<number>(), latencyMs: 0, raw: '' };
  }

  const model = input.model ?? VISION_MODEL;
  const prompt = [
    `You are given ${input.tiles.length} numbered tile images, each cropped from one cell of a larger grid.`,
    `Task: for each tile, decide whether it contains "${input.target}".`,
    'Count it as containing even if the object is small, distant, partially hidden, or cropped at the edge.',
    `Answer with exactly ${input.tiles.length} lines, one per image, in order, format: <image number>|<yes|no>`,
    'No other text.',
  ].join('\n');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 30_000);
  const t0 = Date.now();

  try {
    const res = await fetch(`${input.baseUrl ?? GATEWAY_BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 200,
        ...(model.startsWith('deepseek/') ? { reasoning: { enabled: false } } : {}),
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              ...input.tiles.map((t) => ({
                type: 'image_url',
                image_url: { url: `data:image/jpeg;base64,${t.imageBase64}` },
              })),
            ],
          },
        ],
      }),
      signal: controller.signal,
    });

    const text = await res.text();
    if (!res.ok) {
      throw new Error(`vision verify HTTP ${res.status}: ${text.slice(0, 300)}`);
    }

    const json = JSON.parse(text) as ChatResponse;
    const content = json.choices?.[0]?.message?.content ?? '';

    const yes = new Set<number>();
    for (const m of content.matchAll(/^\s*(\d+)\s*\|\s*(yes|no)\b/gim)) {
      if (m[2]!.toLowerCase() === 'yes') yes.add(Number.parseInt(m[1]!, 10));
    }

    return { yes, latencyMs: Date.now() - t0, costUsd: json.usage?.cost, raw: content };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('vision verify: quá thời gian chờ');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
