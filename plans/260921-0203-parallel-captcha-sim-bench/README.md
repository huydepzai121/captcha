# Parallel CAPTCHA Simulation Benchmark

Status: SPEC — chưa implement
Created: 2026-09-21
Branch: master

## Outcome

Một harness chạy local để đo năng lực của **vision click model** trên bài toán
image-grid CAPTCHA, với **N worker chạy song song**. Harness tự sinh challenge,
tự giữ ground truth, tự verify. Kết quả là một bộ số liệu so sánh được giữa các
model và giữa các mức độ khó.

Reference UI: lưới panel challenge bên trái + terminal log worker bên phải
(trạng thái SPAWNED / EXECUTING / VERIFYING / COMPLETE / FAILED).

## Ranh giới (bắt buộc, không thương lượng)

Harness này chỉ hợp lệ khi nó đóng **cả hai đầu**: bên ra đề và bên chấm đều là
code của dự án.

MUST:
- Challenge sinh cục bộ từ image set có nhãn sẵn. Ground truth nằm server-side.
- Verify bằng chính `POST /challenges/:id/verify` của dự án.
- Adapter model chỉ nhận ảnh + instruction, trả toạ độ click.

MUST NOT — nếu một mục xuất hiện trong code, spec này bị vi phạm:
- Adapter, client, hay config trỏ tới reCAPTCHA / hCaptcha / Turnstile / FunCaptcha
  hoặc bất kỳ endpoint CAPTCHA production nào.
- Proxy pool, IP rotation, residential proxy, fingerprint spoofing, TLS/JA3
  masking, stealth plugin, hay bất kỳ tính năng nào mục đích là né phát hiện bot.
- Chế độ "attach vào trang có sẵn" / userscript / extension chạy trên site ngoài.
- Export lời giải ra dạng service (HTTP API nhận ảnh lạ, trả đáp án).

Worker dùng Playwright nhưng chỉ điều hướng tới `localhost` của challenge server.
Allowlist host này hard-code trong worker, không đọc từ env.

## Non-goals

- Không xây CAPTCHA production-grade (không chống replay ở mức adversarial thật).
- Không tối ưu chi phí inference. Đo là đủ.
- Không multi-tenant, không auth người dùng. Single-operator, chạy local.

## Giả định đã chốt

1. **Mô hình JEV AI (Typesafe AI)** — **ĐÃ XÁC MINH**, xem câu hỏi mở #2. JEV là
   evaluation model: nhận `state` chữ, trả `boolean`/`choice`/`score`. Nó **không**
   là `ClickSolver` và không nằm trong `src/solvers/`. Vai của nó là judge.
2. Baseline so sánh: adapter `oracle` (đọc ground truth, 100% — kiểm tra pipeline)
   và `random` (sàn nhiễu). Mọi con số của model thật đọc giữa hai mốc đó.
3. Chạy trên Windows 11, Node 22, không cần GPU.

## Acceptance criteria (toàn dự án)

- [ ] `pnpm bench --workers 8 --trials 200 --solver oracle` → solve rate 100%,
      không có worker treo, log đủ 200 dòng COMPLETE.
- [ ] Cùng lệnh với `--solver random` → solve rate nằm trong khoảng nhị thức kỳ
      vọng của cấu hình grid (sanity check bộ chấm không rò đáp án).
- [ ] Dashboard hiển thị đồng thời ≥ 6 challenge panel live + log stream, không
      drop event khi 16 worker chạy.
- [ ] Report xuất ra `runs/<id>/report.json` + `report.md`: solve rate tổng, theo
      category, theo độ khó, p50/p95 latency, concurrency scaling curve.
- [ ] `pnpm lint:boundaries` fail nếu có import/URL vi phạm mục MUST NOT ở trên.

## Stack

| Layer | Chọn | Lý do |
|---|---|---|
| Runtime | Node 22 + TypeScript strict | 1 ngôn ngữ cho server/worker/dashboard |
| Server | Fastify + `@fastify/websocket` | nhẹ, ws sẵn |
| Store | SQLite (`better-sqlite3`) | run history, không cần service ngoài |
| Worker browser | Playwright (chromium) | screenshot + click thật, đo được đúng |
| Dashboard | Vite + React | live grid + log |
| Test | Vitest + Playwright test | unit + e2e |

## Phases

| # | Phase | Phụ thuộc | File |
|---|---|---|---|
| 1 | Scaffold + challenge generator | — | [phase-1-generator.md](phase-1-generator.md) |
| 2 | Challenge server + verify API | 1 | [phase-2-server.md](phase-2-server.md) |
| 3 | Worker pool + solver interface | 2 | [phase-3-workers.md](phase-3-workers.md) |
| 4 | Real vision solver adapter (Claude, qua AI Gateway) | 3 | [phase-4-solvers.md](phase-4-solvers.md) |
| 5 | Dashboard + metrics report | 3 | [phase-5-dashboard.md](phase-5-dashboard.md) |

Phase 4 và 5 độc lập với nhau, chạy song song được.

## Câu hỏi còn mở

1. Image set lấy từ đâu? Cần nguồn có license cho phép (gợi ý: Open Images
   subset, hoặc tự chụp). Chưa chốt — Phase 1 block ở đây.
2. ~~JEV AI có doc công khai chưa?~~ **ĐÃ CHỐT** (2026-09-21). Doc:
   `vercel.com/docs/ai-gateway/sdks-and-apis/typesafe` và
   `vercel.com/docs/ai-gateway/modalities/evaluation`. Kết luận: JEV **không nhận
   ảnh** và **không trả toạ độ** — nó là evaluation model, không thể là
   `ClickSolver`. Vai của nó là judge (`src/judge/`). Contract đầy đủ trong
   `openspec/project.md`.
3. Có cần so sánh cross-model không? **Diễn đạt lại**: JEV không nhìn ảnh nên
   không nằm trong phép so này. Câu hỏi thật là *model vision nào* (Claude / GPT /
   Gemini) đạt click-grounding cao nhất, và *JEV có đáng làm judge* so với một
   LLM tự báo confidence hay không. Vế thứ hai thuộc
   `add-jev-calibration-benchmark`.
