# Tasks — add-click-grounding-harness

## 1. Nền móng

- [ ] 1.1 Scaffold: pnpm, TypeScript strict, eslint, vitest, cấu trúc thư mục
- [ ] 1.2 `src/domain/challenge.ts` — chỉ type, không logic
- [ ] 1.3 `scripts/verify-assets.ts` + chạy ở `pretest`
- [ ] 1.4 `scripts/lint-boundaries.ts` + script `lint:boundaries` + nối vào CI

## 2. Sinh challenge — BLOCKED cho tới khi chốt image set

- [ ] 2.1 Chốt nguồn image set, điền `assets/images/manifest.json` với license
- [ ] 2.2 PRNG có seed (`mulberry32`), cấm `Math.random` trong đường sinh đề
- [ ] 2.3 `src/generator/generate.ts` — chọn target, tile đúng, distractor theo
      bảng nhầm lẫn
- [ ] 2.4 `src/generator/compose.ts` — ghép lưới bằng sharp, ghi `splitObjects`
      cho chế độ `hard`
- [ ] 2.5 `src/generator/distort.ts` — blur, nén, áp sau khi ghép
- [ ] 2.6 Test: determinism theo sha256, biên số tile đúng, phủ category

## 3. Challenge server

- [ ] 3.1 `src/server/store.ts` — schema `runs`, `challenges`, `attempts`
- [ ] 3.2 `src/server/routes/challenges.ts` — cấp, ảnh, verify, tổng hợp run
- [ ] 3.3 Serialize thủ công cho mọi response; cấm spread nguyên `Challenge`
- [ ] 3.4 `src/server/render.ts` + CSS — trang `/c/:id`, vùng click trong suốt
- [ ] 3.5 Bind `127.0.0.1`
- [ ] 3.6 Test leak: response thô và HTML không chứa đáp án hay tên file tile
- [ ] 3.7 Test: một lần thử, hết hạn, ba trường hợp chấm điểm

## 4. Solver

- [ ] 4.1 `src/solvers/types.ts` + `registry.ts`
- [ ] 4.2 `oracle.ts`, `random.ts`
- [ ] 4.3 `pointToTile` dùng chung, trả `null` khi ngoài `gridBox`
- [ ] 4.4 `http-vision.ts` — timeout 30s, parse strict, `coordSpace`, clamp
- [ ] 4.5 Adapter vision qua AI Gateway; đọc skill `claude-api` trước khi chốt
      model id và tham số
- [ ] 4.6 Cảnh báo khi >95% click dồn vào góc trên trái
- [ ] 4.7 Test: solver chạy được khi store đã đóng; fixture replay offline

## 5. Worker pool

- [ ] 5.1 `src/worker/guard.ts` — allowlist cứng, chặn qua `context.route('**')`
- [ ] 5.2 `src/worker/worker.ts` — vòng đời, phát event mỗi lần chuyển trạng thái
- [ ] 5.3 `src/worker/pool.ts` — semaphore, không retry, bắt SIGINT/SIGTERM
- [ ] 5.4 `src/bench/cli.ts` — cờ dòng lệnh, in PID và port
- [ ] 5.5 Test guard: host ngoài bị abort; env không mở rộng được allowlist
- [ ] 5.6 Kiểm tra thủ công: ngắt giữa chừng không để lại chromium mồ côi

## 6. Judge

- [ ] 6.1 `src/judge/state.ts` — dựng `state` có cấu trúc; khẳng định không có ảnh
- [ ] 6.2 `src/judge/questions.ts` — ba câu hỏi `boolean` / `choice` / `score`
- [ ] 6.3 `src/judge/run.ts` — chạy theo lô sau run, `--judge off|after|rerun`
- [ ] 6.4 `providerOptions.gateway` cho `zeroDataRetention` và `only`
- [ ] 6.5 Chịu lỗi: judge hỏng không đụng pass/fail
- [ ] 6.6 Gắn cờ mâu thuẫn giữa judge và kết quả chấm
- [ ] 6.7 Test: `state` không chứa ảnh; `--judge off` không gọi mạng

## 7. Metrics và dashboard

- [ ] 7.1 `src/server/routes/events.ts` — WS + ring buffer 500, replay rồi live
- [ ] 7.2 `src/metrics/collect.ts` — cộng dồn, flush vào SQLite
- [ ] 7.3 `src/metrics/report.ts` — `report.json` + `report.md`
- [ ] 7.4 `dashboard/` — lưới challenge, log worker, tóm tắt run
- [ ] 7.5 Test: đếm event hai đầu ở 16 worker; report khớp truy vấn thô

## 8. Nghiệm thu

- [ ] 8.1 `--workers 8 --trials 200 --solver oracle` đạt 100%, thoát sạch
- [ ] 8.2 `--solver random` nằm trong khoảng nhị thức kỳ vọng
- [ ] 8.3 Chạy `--workers 1|4|8|16`, dựng đường cong scaling
- [ ] 8.4 Smoke có judge trên 20 trial; kiểm tra ba dạng answer được lưu đủ
- [ ] 8.5 Đo wall time có và không có dashboard, chênh dưới 5%
- [ ] 8.6 `pnpm lint:boundaries` xanh
