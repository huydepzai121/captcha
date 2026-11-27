# Phase 3 — Worker Pool + Solver Interface

Phụ thuộc: Phase 2.

## Mục tiêu

N worker chạy song song, mỗi worker lái một browser context riêng, giải challenge
qua một `ClickSolver` cắm ngoài. Phase này chỉ ship solver giả lập — model thật ở
Phase 4.

## Files

```
src/solvers/types.ts         # interface ClickSolver
src/solvers/oracle.ts        # đọc ground truth từ store — baseline trần
src/solvers/random.ts        # baseline sàn
src/solvers/registry.ts      # name -> factory
src/worker/worker.ts         # vòng đời 1 worker
src/worker/pool.ts           # điều phối N worker
src/worker/guard.ts          # allowlist host
src/bench/cli.ts             # `pnpm bench`
test/pool.spec.ts, test/guard.spec.ts
```

## Contract

```ts
interface SolveRequest {
  screenshot: Buffer;          // PNG của viewport
  instruction: string;
  grid: { cols: number; rows: number };
  gridBox: { x: number; y: number; w: number; h: number };  // vị trí lưới trong screenshot
  challengeId: string;
}

interface SolveResult {
  clicks: { x: number; y: number }[];   // toạ độ tuyệt đối trong screenshot
  rawResponse?: unknown;
  usage?: { inputTokens?: number; outputTokens?: number; costUsd?: number };
  latencyMs: number;
}

interface ClickSolver {
  readonly name: string;
  solve(req: SolveRequest): Promise<SolveResult>;
}
```

Solver trả **toạ độ click**, không trả tile index. Việc map toạ độ sang tile là
của worker (`pointToTile`), nên mọi solver được chấm trên cùng một luật.

## Vòng đời worker

```
SPAWNED   -> acquire challenge (POST /api/challenges)
EXECUTING -> mở /c/:id, screenshot, solver.solve(), click từng điểm
VERIFYING -> bấm VERIFY, đọc response
COMPLETE | FAILED
```

Mỗi chuyển trạng thái emit event `{workerId, challengeId, state, ts, detail}` lên
event bus (Phase 5 tiêu thụ). Log stdout đúng format reference:
`012  EXECUTING  0x<challengeId8>`.

## Guard

`src/worker/guard.ts` chặn navigation ngoài allowlist:

```ts
const ALLOWED = ['127.0.0.1', 'localhost'];   // hard-code, không đọc env
```

Cắm qua `context.route('**', ...)`: request tới host ngoài thì `route.abort()` và
throw. Test phải chứng minh điều này.

Thêm `pnpm lint:boundaries` — script grep source tree, fail nếu thấy:
`recaptcha`, `hcaptcha`, `turnstile`, `funcaptcha`, `proxy-chain`,
`puppeteer-extra-plugin-stealth`, `playwright-extra`.

## Steps

1. `types.ts` + `registry.ts`.
2. `oracle.ts`: query store lấy tile đúng, đổi ra toạ độ tâm tile. Đây là test
   fixture cho pipeline, không phải model.
3. `random.ts`: chọn ngẫu nhiên k tile, k lấy từ phân bố của generator.
4. `pointToTile(point, gridBox, grid)`: điểm ngoài `gridBox` trả `null`, tính là
   click hỏng, ghi vào `detail`.
5. `worker.ts`, `pool.ts` (semaphore theo `--workers`, retry 0 — fail là fail).
6. `cli.ts`: `--workers --trials --solver --difficulty --run-id`.
7. Tests.

## Validation

- `pnpm bench --workers 8 --trials 200 --solver oracle` cho 200/200 COMPLETE,
  không worker nào treo, tiến trình thoát sạch (không orphan chromium).
- `--solver random` cho solve rate thấp, nằm trong khoảng nhị thức kỳ vọng.
- `pnpm test test/guard.spec.ts`: navigation tới host ngoài bị abort + throw.
- `pnpm lint:boundaries` pass.
- Scaling: `--workers 1|4|8|16` cùng `--trials 200`, ghi wall time từng mức.

## Risk / rollback

Risk: orphan chromium khi run bị ngắt giữa chừng. Mitigation: `pool.ts` bắt
SIGINT/SIGTERM, đóng mọi context trước khi exit; `cli.ts` in PID + port đang giữ.
Rollback: xoá `src/worker/`, `src/bench/`.
