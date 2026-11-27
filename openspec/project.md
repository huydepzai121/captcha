# Project Context

## Purpose

Hai việc đo lường, dùng chung một hạ tầng:

1. **Click-grounding harness** — đo khả năng một vision model định vị và click đúng
   ô trên lưới ảnh, chạy song song nhiều worker. Đề bài do dự án tự sinh, đáp án
   giữ server-side. `typesafe-ai/jev` đóng vai **trọng tài có kiểu**, không phải
   bên giải đề.
2. **JEV calibration benchmark** — đo chất lượng của JEV ở đúng năng lực của nó:
   độ chuẩn của xác suất (calibration), độ chính xác `choice`, độ ổn định `score`,
   so với LLM-as-judge thông thường.

## Ranh giới (bất biến của dự án)

Harness chỉ hợp lệ khi dự án đóng **cả hai đầu**: bên ra đề và bên chấm đều là code
của dự án.

MUST:
- Challenge sinh cục bộ từ image set có nhãn. Ground truth nằm server-side.
- Chấm bằng chính endpoint verify của dự án.
- Worker chỉ điều hướng tới host trong allowlist loopback.

MUST NOT — xuất hiện trong code là vi phạm, CI phải chặn:
- Client, adapter, hay config trỏ tới reCAPTCHA, hCaptcha, Turnstile, FunCaptcha,
  hay bất kỳ dịch vụ chống bot production nào.
- Proxy pool, IP rotation, fingerprint spoofing, TLS/JA3 masking, stealth plugin.
- Chế độ attach vào trang web bên ngoài (userscript, extension, remote CDP).
- Bất kỳ endpoint nào nhận ảnh từ bên ngoài rồi trả lời giải.

## Tech Stack

| Layer | Chọn |
|---|---|
| Runtime | Node 22, TypeScript strict, pnpm |
| AI | AI SDK 7+ (`ai`), `@ai-sdk/gateway`, Vercel AI Gateway |
| Server | Fastify + `@fastify/websocket` |
| Store | SQLite (`better-sqlite3`) |
| Browser | Playwright (chromium) |
| Ảnh | sharp |
| Dashboard | Vite + React |
| Test | Vitest |

## Sự thật đã xác minh về JEV

Nguồn: `vercel.com/docs/ai-gateway/modalities/evaluation` và `/sdks-and-apis/typesafe`
(đọc 2026-09-21). Mọi thiết kế phải tôn trọng các điểm sau — không suy diễn thêm:

- Model id: `typesafe-ai/jev`. Đây là **evaluation model**, không sinh văn bản tự do.
- Input `state`: string, object, hoặc array. **Không hỗ trợ ảnh.** Doc không ghi
  multimodal ở bất kỳ đâu. JEV do đó không thể là bên giải challenge ảnh.
- Output chỉ ba kiểu:
  - `boolean` → `{ type, probability }` (0–1). `criteria: { true, false }`.
  - `choice` → `{ type, choice, probabilities }`. `criteria: Record<name, mô tả>`.
  - `score` → `{ type, score, probabilities }`. `criteria: string[]`, thấp→cao, ≥2 phần tử.
- Nhiều câu hỏi chia sẻ một `state`, trả lời trong một round trip.
- Không có tool use, không có toạ độ, không có output dạng hành động.
- Truy cập — endpoint chính xác (đọc 2026-09-21):
  - `POST https://ai-gateway.vercel.sh/v1/evaluate` — API gốc. Body
    `{ model, state, questions, providerOptions? }`; response có `answers`,
    `usage`, `providerMetadata.gateway` (`routing`, `cost`, `generationId`).
  - `POST https://ai-gateway.vercel.sh/typesafe/v1/systemone` — shape TypeSafe gốc.
  - `GET https://ai-gateway.vercel.sh/typesafe/v1/models` — liệt kê model
    evaluation khả dụng cho tài khoản.
  - SDK TypeSafe: `@typesafe-ai/sdk`, `new TypeSafeClient({ apiKey, baseURL })`,
    `client.systemOne({ model, state, questions })`.
  - AI SDK 7+: `experimental_evaluate({ model: gateway.evaluationModel('typesafe-ai/jev'), ... })`.
  - **Không** chạy qua endpoint OpenAI/Anthropic/Cohere-compatible — các surface
    đó không hỗ trợ evaluation.
- Host gateway là `ai-gateway.vercel.sh`. Chat/completions dùng chung host:
  `https://ai-gateway.vercel.sh/v1/chat/completions`.
- Auth: `Authorization: Bearer $AI_GATEWAY_API_KEY` (hoặc Vercel OIDC token).
- `providerOptions.gateway` nhận `zeroDataRetention` và `only`.
- Giới hạn đã xác minh (nguồn: `ai-sdk.dev/providers/ai-sdk-providers/typesafe-ai`):
  - `choice`: 1–255 lựa chọn. `score`: 2–10 bậc. `boolean` (TypeSafe gọi là
    `noul`): `probability` là **P(true)**, không phải confidence.
  - Giá trị trả về **làm tròn 2 chữ số thập phân** → tổng `probabilities` có thể
    không bằng đúng 1. Chỉ số phải chịu được, KHÔNG assert tổng == 1.
  - `confidence` của Choice/Score là chỉ số riêng, nằm ở
    `providerMetadata.typesafe.confidence[questionId]`. Không trộn với `probability`.
  - `criteria` của `choice` nhận `Record<name, mô tả>`; mô tả có thể `null`.
    `criteria` của `boolean` là tuỳ chọn.
- `usage`:
  - `/v1/evaluate` → `{ inputTokens, outputTokens }`.
  - TypeSafe-compat → `{ input_tokens, output_tokens }`.
  - Một số evaluation model chỉ tính input token — kiểm tra trang Models trước khi
    báo cáo chi phí.
- Chi phí mẫu trong doc: `providerMetadata.gateway.cost` = `"0.00001155"` mỗi
  request một câu hỏi `boolean`.

## Quy ước

- File JS/TS: kebab-case.
- Mọi lời gọi mạng ra ngoài ghi log `{ provider, host, latencyMs, usage }`.
- Secrets qua env, `.env` trong `.gitignore`. Không commit key.
- Port cố định: server 3000, dashboard 5173. Bận thì dừng tiến trình cũ, không tăng port.
