# Phase 2 — Challenge Server + Verify API

Phụ thuộc: Phase 1.

## Mục tiêu

Phục vụ challenge qua HTTP + trang HTML, và chấm bài. Ground truth **không bao
giờ** rời server.

## Files

```
src/server/app.ts            # Fastify instance
src/server/routes/challenges.ts
src/server/store.ts          # SQLite: runs, challenges, attempts
src/server/render.ts         # HTML page cho 1 challenge
src/server/public/challenge.css
test/server.spec.ts
```

## API

| Method | Path | Body / Query | Trả |
|---|---|---|---|
| POST | `/api/challenges` | `{runId, seed?, difficulty?}` | `{id, instruction, grid, imageUrl, expiresAt}` |
| GET | `/api/challenges/:id/image` | — | PNG |
| GET | `/c/:id` | — | HTML page (worker mở cái này) |
| POST | `/api/challenges/:id/verify` | `{selected: number[]}` | `{ok, correct, wrong, missed, latencyMs}` |
| GET | `/api/runs/:runId` | — | tổng hợp attempts |

## Bất biến

- Response của `POST /api/challenges` và HTML của `/c/:id` **không chứa**
  `isTarget`, `tiles[].source`, hay `target`. Chỉ có `instruction` + ảnh.
  Test phải assert điều này trên chuỗi response thô.
- Mỗi challenge verify được **đúng 1 lần**. Lần 2 → 409.
- Hết `expiresAt` (mặc định 120s) → 410, tính là FAILED.
- `POST /api/challenges` chỉ nhận request từ loopback. Bind `127.0.0.1`.

## HTML page `/c/:id`

Khớp reference: header xanh + `instruction` in đậm, ảnh grid chia
`cols*rows` vùng click trong suốt, tile được chọn có overlay checkmark, nút
VERIFY. Mỗi vùng click có `data-tile-index`. Trạng thái chọn giữ client-side,
submit một lần khi bấm VERIFY.

## Steps

1. `store.ts`: schema `runs(id, startedAt, config)`, `challenges(id, runId, seed,
   difficulty, target, tilesJson, createdAt, expiresAt)`, `attempts(challengeId,
   selectedJson, ok, latencyMs, solver, workerId, submittedAt)`.
2. Routes. Serialize thủ công — **không** spread cả `Challenge` vào response.
3. `render.ts` + CSS.
4. Tests: leak test, single-attempt, expiry, scoring đúng/sai/thiếu.

## Validation

- `pnpm test test/server.spec.ts`
- Leak test: `JSON.stringify(res)` và HTML body không chứa `isTarget`/`target`/tên file tile.
- Chấm: chọn đúng hết → `ok:true`; thừa 1 → `ok:false, wrong:1`.
- Bind: `netstat -ano | findstr :3000` thấy `127.0.0.1:3000`, không phải `0.0.0.0`.

## Risk / rollback

Risk chính là rò ground truth qua response — bắt bằng leak test, giữ test này
trong CI. Rollback: drop bảng, xoá `src/server/`.
