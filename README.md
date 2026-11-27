# click-grounding benchmark harness

Harness local đo khả năng **click-grounding** của model vision trên bài toán lưới ảnh,
kèm lớp **judge có kiểu** dùng `typesafe-ai/jev`.

Đề bài do dự án tự sinh. Đáp án nằm server-side. Không chạm dịch vụ bên ngoài nào
ngoài AI Gateway để gọi model.

Cài đặt: [CAI-DAT.md](CAI-DAT.md). **Chạy và xem agent giải captcha: [HUONG-DAN.md](HUONG-DAN.md)**.

## Chạy nhanh

```bash
pnpm install
pnpm gen:assets          # sinh image set có nhãn (288 ảnh, license CC0-1.0)
pnpm test                # verify-assets + lint:boundaries + 55 test
pnpm bench --workers 4 --trials 12 --solver oracle --difficulty easy
```

Kết quả ra `runs/<run-id>/report.json` và `report.md`.

## Lệnh

| Lệnh | Việc |
|---|---|
| `pnpm test` | `verify-assets` → `lint:boundaries` → vitest |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm gen:assets` | sinh lại image set + manifest |
| `pnpm verify-assets` | manifest khớp file, đủ license, ≥40 ảnh/category |
| `pnpm lint:boundaries` | chặn tham chiếu tới dịch vụ chống bot / công cụ né phát hiện |
| `pnpm bench` | chạy benchmark trọn vòng, ghi report |
| `pnpm serve` | dựng challenge server để mở dashboard live |
| `pnpm judge --run-id <id>` | chấm lại một run bằng JEV |

### Cờ của `pnpm bench`

```
--workers N        số worker song song          (mặc định 8)
--trials N         số lượt                     (mặc định 50)
--solver NAME      oracle | random | vision[:model]
--difficulty LVL   easy | medium | hard         (mặc định medium)
--run-id ID        tên run                     (mặc định theo timestamp)
--judge off|after  chạy judge sau khi xong      (mặc định off)
--headful          tắt headless để xem mắt
```

## Trang mẫu và trang thật

Testbed dựng sẵn hai trang luôn bắt giải (sitekey test của Google), để xem agent
vét lưới thật sự thay vì tick suông:

```bash
npm run testbed                                   # http://127.0.0.1:3400/
npx tsx scripts/live-target.ts "http://127.0.0.1:3400/" --headful --slowmo 250
```

Trang thật thì thường **pass thẳng** (Chrome thật + profile tích luỹ), nên chỉ
dùng để biết trang có chặn hay không:

```bash
npx tsx scripts/live-target.ts "https://muasamcong.mof.gov.vn/c/portal/login" --headful
npx tsx scripts/live-checkio.ts --headful --user <tên> --pass <mật khẩu>
```

`live-checkio.ts` dành cho trang đăng nhập NukeViet/SSO: widget reCAPTCHA ở đó
chỉ được dựng trong modal **sau** cú bấm Đăng nhập, nên script điền form và bấm
nút trước rồi mới để agent tìm anchor. Cách chạy đầy đủ, cờ và sự cố:
[HUONG-DAN.md](HUONG-DAN.md).

## Kiến trúc

```
assets/images/        image set tổng hợp + manifest.json (ground truth nhãn)
src/domain/           type dùng chung: challenge, solver contract
src/generator/        PRNG có seed → challenge → ghép lưới (sharp) → méo theo độ khó
src/server/           Fastify: cấp đề, phục vụ ảnh, chấm bài, event bus WS
src/solvers/          oracle (trần) · random (sàn) · vision qua AI Gateway
src/worker/           guard allowlist + vòng đời worker + pool song song
src/judge/            client JEV (/v1/evaluate), state, questions, runner
src/metrics/          report.json + report.md
scripts/              verify-assets · lint-boundaries · gen-assets
public/               dashboard live (WS)
sim/                  prototype cũ, tách riêng, không thuộc harness
```

## Bất biến

- **Ground truth không rời server.** Response của `POST /api/challenges` và HTML của
  `/c/:id` chỉ chứa `instruction`, ảnh, và `data-tile-index`. Test `test/server.spec.ts`
  assert điều này trên chuỗi thô.
- **Một lần thử cho mỗi challenge.** Verify lần hai → 409. Hết hạn → 410, ghi `expired`.
- **Solver không đọc đáp án.** Trừ `oracle` (tồn tại để kiểm tra pipeline), solver chỉ
  nhận ảnh + instruction. Test chạy solver khi store đóng.
- **Worker chỉ đi tới loopback.** Allowlist `['127.0.0.1','localhost']` hard-code trong
  `src/worker/guard.ts`, không đọc env. Vi phạm bị abort ở tầng route.
- **Pass/fail do server chấm cơ học.** Judge không đổi `ok` hay solve rate.

## JEV — sự thật đã xác minh

`typesafe-ai/jev` là **evaluation model**: nhận `state` (string/object/array), trả
`boolean` / `choice` / `score` kèm xác suất. **Không nhận ảnh, không trả toạ độ.**

Vì vậy JEV **không thể** là bên giải challenge ảnh. Vai của nó ở đây là judge: đọc mô tả
bằng chữ của một lượt đã chạy xong và phân loại nguyên nhân sai.

```
POST https://ai-gateway.vercel.sh/v1/evaluate
Authorization: Bearer $AI_GATEWAY_API_KEY
{
  "model": "typesafe-ai/jev",
  "state": { "instruction": ..., "groundTruthTiles": [...], "modelSelectedTiles": [...] },
  "questions": {
    "ambiguous":    { "type": "boolean", "instructions": ... },
    "failureCause": { "type": "choice",  "criteria": { ... } },
    "severity":     { "type": "score",   "criteria": [ ... ] }
  }
}
```

Chi tiết đầy đủ (giới hạn choice 1–255, score 2–10, làm tròn 2 chữ số, `confidence` nằm
riêng ở `providerMetadata.typesafe.confidence`) ở `openspec/project.md`.

Model vision đi đường khác: `POST https://ai-gateway.vercel.sh/v1/chat/completions`.

## Biến môi trường

| Biến | Dùng cho |
|---|---|
| `AI_GATEWAY_API_KEY` | solver `vision`, và judge |

Không có key thì `oracle` và `random` vẫn chạy đủ, và `--judge after` tự bỏ qua.

## Ranh giới

Harness chỉ hợp lệ khi đóng cả hai đầu: bên ra đề và bên chấm đều là code của dự án.

Cấm — `pnpm lint:boundaries` chặn ở CI: adapter trỏ tới dịch vụ chống bot production,
proxy pool, fingerprint spoofing, stealth plugin, hay chế độ attach vào trang ngoài.
