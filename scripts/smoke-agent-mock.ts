// language: TypeScript, file: scripts/smoke-agent-mock.ts, runtime: Node 22
// Chạy agent trên trang demo THẬT nhưng thay AI Gateway bằng gateway giả, để
// kiểm tra đường dây vision → JEV → click mà không cần key và không tốn tiền.
//
// Gateway giả trả lời theo BẤT KỲ mô tả nào có chứa target — nên nếu log hiện
// "nguồn: JEV" và có ô được click thì đường JEV đang thật sự chạy, chứ không
// phải vision tự quyết.
//
// Chạy: npx tsx scripts/smoke-agent-mock.ts [--headful] [--fail-jev]
//
// `--fail-jev` để gateway giả trả 503 cho mọi lượt evaluate — dùng kiểm tra
// đường dự phòng: trial phải đi tiếp bằng phán đoán của vision, không được chết.

const GATEWAY = 'https://ai-gateway.vercel.sh';

export {};

const fakeKey = 'fake-key-offline';
const headless = !process.argv.includes('--headful');
const failJev = process.argv.includes('--fail-jev');

const TYPESAFE = 'https://api.typesafe.ai';

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const targetOf = (prompt: string): string =>
  prompt.match(/Which tiles contain "([^"]+)"/)?.[1] ?? prompt.match(/Task: "([^"]+)"/)?.[1] ?? 'object';

/** Ô "có vật thể" theo mẫu cố định, đủ để có nhiều lượt click thật. */
const isMatch = (index: number): boolean => index % 5 === 1 || index === 12;

const realFetch = globalThis.fetch;

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;

  // Đường chính: JEV đọc ảnh lưới, hỏi noul từng ô theo row/col.
  if (url.startsWith(TYPESAFE) && url.endsWith('/v1/systemone')) {
    if (failJev) {
      return new Response(JSON.stringify({ message: 'Service temporarily unavailable' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      });
    }
    const questions = (body.questions ?? {}) as Record<string, { instructions: string }>;
    const answers: Record<string, unknown> = {};
    for (const [key, question] of Object.entries(questions)) {
      const row = Number(question.instructions.match(/row (\d+)/)?.[1] ?? 1) - 1;
      const col = Number(question.instructions.match(/column (\d+)/)?.[1] ?? 1) - 1;
      const cols = Number(String((body.state as { grid?: string })?.grid ?? '9').match(/x (\d+)/)?.[1] ?? 3);
      answers[key] = { type: 'noul', noul: isMatch(row * cols + col) ? 0.97 : 0.02 };
    }
    return json({
      model: 'jev-1.14.0',
      answers,
      usage: { input_tokens: 900, output_tokens: 40 },
    });
  }

  if (!url.startsWith(GATEWAY)) return realFetch(input, init);

  if (url.endsWith('/v1/chat/completions')) {
    const messages = body.messages as Array<{ content: Array<{ text?: string }> }>;
    const prompt = messages[0]?.content[0]?.text ?? '';
    const target = targetOf(prompt);
    const grid = prompt.match(/grid of (\d+) rows x (\d+) columns/);
    // Lượt recall gửi N ảnh ô đã crop, prompt không có kích thước lưới.
    const byCount = prompt.match(/given (\d+) numbered tile images/);
    const total = byCount
      ? Number(byCount[1])
      : Number(grid?.[1] ?? 4) * Number(grid?.[2] ?? 4);

    const lines: string[] = [];
    for (let i = 0; i < total; i += 1) {
      lines.push(
        isMatch(i)
          ? `${i}|yes - a ${target} on the road`
          : `${i}|no - asphalt, empty sky, distant fence`,
      );
    }

    return json({
      choices: [{ message: { content: lines.join('\n') } }],
      usage: { prompt_tokens: 800, completion_tokens: 120, cost: 0.00018 },
    });
  }

  if (url.endsWith('/v1/evaluate')) {
    if (failJev) {
      return new Response(JSON.stringify({ error: { message: 'Service temporarily unavailable' } }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      });
    }

    const questions = (body.questions ?? {}) as Record<string, { instructions: string }>;
    const answers: Record<string, unknown> = {};
    for (const [key, question] of Object.entries(questions)) {
      // Mô tả đã bị cắt tiền tố yes/no, nên phải so theo target — đúng như JEV thật.
      const target = question.instructions.match(/CONTAINS "([^"]+)"/)?.[1] ?? '';
      const desc = question.instructions.match(/Description of tile \d+: "([^"]*)"/)?.[1] ?? '';
      const match = target.length > 0 && desc.toLowerCase().includes(target.toLowerCase());
      answers[key] = { type: 'boolean', probability: match ? 0.93 : 0.02 };
    }
    return json({
      model: 'typesafe-ai/jev',
      answers,
      usage: { inputTokens: 400, outputTokens: 20 },
      providerMetadata: { gateway: { cost: '0.00001155' } },
    });
  }

  return realFetch(input, init);
};

const { runAgent } = await import('../agent/demo-agent.js');

const result = await runAgent({
  apiKey: fakeKey,
  headless,
  maxAttempts: 2,
  onLog: (msg) => console.log(`  ${msg}`),
});

console.log('');
console.log(`kết quả: ${result.passed ? 'PASS' : 'FAIL'} · ${result.reason}`);
console.log(`JEV: ${result.jevMs.length} lượt · lỗi ${result.jevFailures}`);
process.exit(result.passed ? 0 : 1);
