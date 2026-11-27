// language: TypeScript, file: scripts/bench-models.ts, runtime: Node 22
// So các model vision trên CÙNG một ảnh lưới reCAPTCHA thật, cùng prompt.
// Chạy: pnpm exec tsx scripts/bench-models.ts <ảnh> <target>
// Ví dụ: pnpm exec tsx scripts/bench-models.ts runs/miss/miss-2-2.jpg bus

import { readFileSync } from 'node:fs';
import { GATEWAY_BASE } from '../agent/config.js';

const sleep = (ms: number): Promise<void> => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
};

for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
  if (match?.[1] && !(match[1] in process.env)) {
    process.env[match[1]] = match[2]!.replace(/^["']|["']$/g, '');
  }
}

const imagePath = process.argv[2] ?? 'runs/miss/miss-2-2.jpg';
const target = process.argv[3] ?? 'bus';
const cols = Number.parseInt(process.argv[4] ?? '3', 10);
const rows = Number.parseInt(process.argv[5] ?? '3', 10);

const buf = readFileSync(imagePath);
const total = cols * rows;

const MODELS = [
  'deepseek/deepseek-v4.1-flash',
  'google/gemini-3.1-flash-lite',
  'google/gemini-3.5-flash-lite',
  'alibaba/qwen3.8-flash',
  'anthropic/claude-haiku-4.5',
  'openai/gpt-4.1-nano',
];

const PROMPT = [
  `Ảnh là một lưới ${rows} hàng x ${cols} cột, tổng ${total} ô, đánh số row-major 0..${total - 1}.`,
  '',
  `Which tiles contain "${target}"? Include small, distant, partially hidden, or edge-cropped ones.`,
  '',
  'Output one line per tile, in English:',
  '<tile number>|<yes or no> - <short description>',
  '',
  `Exactly ${total} lines, in order 0 to ${total - 1}. No header, no markdown table.`,
].join('\n');

interface Row {
  model: string;
  ms: number;
  costUsd: number;
  yes: number[];
  text: string;
  err?: string;
}

const results: Row[] = [];

for (const model of MODELS) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${GATEWAY_BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${process.env.AI_GATEWAY_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 2000,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: PROMPT },
              {
                type: 'image_url',
                image_url: { url: `data:image/jpeg;base64,${buf.toString('base64')}` },
              },
            ],
          },
        ],
      }),
    });

    const text = await res.text();
    const ms = Date.now() - t0;

    if (!res.ok) {
      results.push({ model, ms, costUsd: 0, yes: [], text: '', err: `HTTP ${res.status}: ${text.slice(0, 120)}` });
      continue;
    }

    const json = JSON.parse(text) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { cost?: number };
    };
    const content = json.choices?.[0]?.message?.content ?? '';

    // Parse các dòng "N|yes - ..." hoặc "N|no - ..."
    const yes: number[] = [];
    for (const line of content.split(/\r?\n/)) {
      const m = line.match(/^\s*\**\s*(\d{1,2})\s*\**\s*[|:：]\s*\**\s*(yes|no|y|n|có|không)\b/i);
      if (!m) continue;
      const idx = Number.parseInt(m[1] ?? '', 10);
      const verdict = (m[2] ?? '').toLowerCase();
      if (Number.isInteger(idx) && idx >= 0 && idx < total) {
        if (verdict.startsWith('y') || verdict === 'có') yes.push(idx);
      }
    }

    results.push({
      model,
      ms,
      costUsd: json.usage?.cost ?? 0,
      yes: yes.sort((a, b) => a - b),
      text: content,
    });
  } catch (err) {
    results.push({
      model,
      ms: Date.now() - t0,
      costUsd: 0,
      yes: [],
      text: '',
      err: err instanceof Error ? err.message : String(err),
    });
  }
  await sleep(300);
}

console.log(`\nảnh: ${imagePath}`);
console.log(`target: "${target}" · lưới ${rows}x${cols}\n`);
console.log('model                          | ms    | $         | chọn ô');
console.log('-------------------------------|-------|-----------|--------');
for (const r of results) {
  const cells = r.err ? `LỖI ${r.err.slice(0, 40)}` : `[${r.yes.join(', ')}]`;
  console.log(`${r.model.padEnd(30)} | ${String(r.ms).padStart(5)} | $${r.costUsd.toFixed(6)} | ${cells}`);
}

console.log('\n════════ CHI TIẾT ════════');
for (const r of results) {
  console.log(`\n── ${r.model} `);
  console.log(r.err ?? r.text.slice(0, 900));
}
