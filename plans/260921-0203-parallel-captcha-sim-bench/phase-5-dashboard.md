# Phase 5 — Dashboard + Metrics Report

Phụ thuộc: Phase 3. Chạy song song được với Phase 4.

## Mục tiêu

Nhìn thấy run đang chạy (đúng layout reference), và xuất report sau run.

## Files

```
src/server/routes/events.ts      # WS /ws/events
src/metrics/collect.ts
src/metrics/report.ts            # -> runs/<id>/report.json + report.md
dashboard/
  src/App.tsx
  src/challenge-grid.tsx         # panel lưới bên trái
  src/worker-log.tsx             # terminal bên phải
  src/use-event-stream.ts
test/metrics.spec.ts
```

## Layout

Trái: lưới panel, mỗi panel là một challenge đang chạy — `instruction`, ảnh grid,
overlay checkmark theo click của worker, badge trạng thái. Panel COMPLETE viền
xanh, FAILED viền đỏ, giữ lại 3s rồi nhường chỗ cho challenge kế tiếp.

Phải: terminal nền tối, monospace, log stream:

```
click-grounding bench — parallel workers
  8 workers online · <run-id>
  --------------------------------
  012  EXECUTING   0x4a7b91c2
  013  VERIFYING   0x8810ff03
  012  COMPLETE    0x4a7b91c2  +182ms
```

Header run: workers online, solve rate chạy dần, trials done / total.

## Event stream

WS `/ws/events?runId=`. Server giữ ring buffer 500 event gần nhất; client mới kết
nối nhận replay rồi mới nhận live. Backpressure: client chậm thì gộp event cùng
`workerId` trong cửa sổ 100ms. Yêu cầu: 16 worker không drop event.

## Metrics

`report.json`:

- `solveRate` — tổng, theo `category`, theo `difficulty`
- `latency` — p50 / p95 / max, tách `solverMs` và `totalMs`
- `usage` — tokens + costUsd cộng dồn, và trung bình mỗi lời giải đúng
- `failures` — gom theo lý do: `timeout`, `bad_schema`, `click_outside_grid`,
  `wrong_tiles`, `expired`
- `scaling` — `[{workers, trials, wallMs, throughputPerMin}]`
- `config` — solver, seed range, commit sha

`report.md`: cùng số liệu, dạng bảng đọc được.

## Steps

1. `events.ts` + ring buffer, nối vào event bus Phase 3.
2. `collect.ts`: subscribe event bus, cộng dồn in-memory, flush vào SQLite.
3. Dashboard Vite, dev proxy tới server 3000. Port cố định 5173 (một port cho
   mỗi dịch vụ, không tự tăng khi bận — dừng tiến trình cũ).
4. `report.ts`, gọi tự động ở cuối `pnpm bench`.

## Validation

- Chạy `--workers 16 --trials 300 --solver oracle`, mở dashboard: số event client
  nhận bằng số event server phát (counter hai đầu).
- `report.json` khớp thủ công với `SELECT` từ bảng `attempts` cùng run.
- Scaling curve có đủ mọi mức workers đã chạy.
- Dashboard không crash khi run kết thúc giữa lúc đang mở.

## Risk / rollback

Risk: dashboard làm chậm worker nếu ws blocking. Mitigation: event bus
fire-and-forget, không await client. Đo lại wall time có và không có dashboard,
chênh phải dưới 5%. Rollback: `dashboard/` độc lập, harness chạy headless không
cần nó.
