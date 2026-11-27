// language: TypeScript, file: scripts/bench-vision.ts, runtime: Node 22
// So sánh các cấu hình vision cho cùng một ảnh lưới thật:
// đo thời gian, token, chi phí, và chất lượng output.
// Chạy: pnpm exec tsx scripts/bench-vision.ts

import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { ANCHOR_FRAME, CHALLENGE_FRAME, DEMO_URL, GATEWAY_BASE } from '../agent/config.js';

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

const TABLE_SELECTORS =
  'table.rc-imageselect-table-33, table.rc-imageselect-table-44, table.rc-imageselect-table-42';

// ── bắt một ảnh lưới thật ────────────────────────────────────────────
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
await page.goto(DEMO_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });
const anchor = page.frameLocator(ANCHOR_FRAME).locator('#recaptcha-anchor');
await anchor.waitFor({ state: 'visible', timeout: 15_000 });
await anchor.click({ timeout: 10_000 });
await sleep(3000);

const bframe = page.frameLocator(CHALLENGE_FRAME);
await bframe.locator('#rc-imageselect').waitFor({ state: 'visible', timeout: 20_000 });
await sleep(3000);

const table = bframe.locator(TABLE_SELECTORS).first();
const instruction = (await bframe.locator('.rc-imageselect-instructions').innerText())
  .replace(/\s+/g, ' ')
  .trim();
const gridInfo = await table.evaluate((t: HTMLTableElement) => {
  const rows = t.querySelectorAll('tr').length;
  const cols = t.querySelector('tr')?.querySelectorAll('td').length ?? 0;
  return { cols, rows };
});
const buf: Buffer = await table.screenshot({ type: 'png' });
writeFileSync('runs/bench-grid.png', buf);
await browser.close();

const total = gridInfo.cols * gridInfo.rows;
console.log(`ảnh: ${gridInfo.rows}x${gridInfo.cols} (${total} ô) · ${buf.length} bytes`);
console.log(`instruction: ${instruction}\n`);

const PROMPT = [
  `Ảnh là lưới ${gridInfo.rows}x${gridInfo.cols}, ${total} ô, đánh số row-major 0..${total - 1}.`,
  `Đề: "${instruction}".`,
  '',
  'Với MỖI ô, in đúng một dòng theo định dạng:',
  '<số ô>|<mô tả tối đa 12 từ>',
  '',
  `Đúng ${total} dòng. Không header, không bảng markdown, không giải thích.`,
].join('\n');

interface Config {
  label: string;
  model: string;
  extra: Record<string, unknown>;
}

const CONFIGS: Config[] = [
  {
    label: 'deepseek + reasoning off',
    model: 'deepseek/deepseek-v4.1-flash',
    extra: { reasoning: { enabled: false } },
  },
  {
    label: 'deepseek + effort minimal',
    model: 'deepseek/deepseek-v4.1-flash',
    extra: { reasoning: { effort: 'minimal' } },
  },
  { label: 'gemini-2.5-flash-lite', model: 'google/gemini-2.5-flash-lite', extra: {} },
  { label: 'gpt-4.1-nano', model: 'openai/gpt-4.1-nano', extra: {} },
];

interface RunResult {
  label: string;
  status: number;
  ms: number;
  cost: number;
  reasoningTokens: number;
  completionTokens: number;
  content: string;
  lines: number;
}

const results: RunResult[] = [];

for (const cfg of CONFIGS) {
  const t0 = Date.now();
  const res = await fetch(`${GATEWAY_BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${process.env.AI_GATEWAY_API_KEY}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: 8192,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: PROMPT },
            {
              type: 'image_url',
              image_url: { url: `data:image/png;base64,${buf.toString('base64')}` },
            },
          ],
        },
      ],
      ...cfg.extra,
    }),
  });

  const text = await res.text();
  const ms = Date.now() - t0;

  if (!res.ok) {
    console.log(`── ${cfg.label} → HTTP ${res.status}`);
    console.log(`   ${text.slice(0, 200)}\n`);
    results.push({
      label: cfg.label,
      status: res.status,
      ms,
      cost: 0,
      reasoningTokens: 0,
      completionTokens: 0,
      content: '',
      lines: 0,
    });
    continue;
  }

  const json = JSON.parse(text) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: {
      cost?: number;
      completion_tokens?: number;
      completion_tokens_details?: { reasoning_tokens?: number };
    };
  };
  const content = json.choices?.[0]?.message?.content ?? '';
  const lines = content.split('\n').filter((l) => /\|/.test(l)).length;

  results.push({
    label: cfg.label,
    status: res.status,
    ms,
    cost: json.usage?.cost ?? 0,
    reasoningTokens: json.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
    completionTokens: json.usage?.completion_tokens ?? 0,
    content,
    lines,
  });

  console.log(`── ${cfg.label} · HTTP ${res.status} · ${ms}ms`);
  console.log(`   reasoning=${json.usage?.completion_tokens_details?.reasoning_tokens ?? 0} completion=${json.usage?.completion_tokens ?? 0} cost=$${(json.usage?.cost ?? 0).toFixed(6)}`);
  console.log(`   dòng có "|": ${lines}/${total}`);
  console.log(`   ${content.slice(0, 300).replace(/\n/g, ' ⏎ ')}\n`);
}

console.log('══════════ TỔNG KẾT ══════════');
console.log('model                          | ms    | cost     | reason | lines');
for (const r of results) {
  console.log(
    `${r.label.padEnd(30)} | ${String(r.ms).padStart(5)} | $${r.cost.toFixed(6)} | ${String(r.reasoningTokens).padStart(6)} | ${r.lines}/${total}`,
  );
}
