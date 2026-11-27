# Design — add-click-grounding-harness

## Quyết định 1: solver trả toạ độ, không trả tile index

Interface `ClickSolver` nhận screenshot + instruction, trả `{x, y}` tuyệt đối.
Việc map toạ độ sang ô là của worker (`pointToTile`).

Lý do: nếu solver tự trả index, ta đo "model đoán ô nào" chứ không phải "model
click đúng chỗ không". Trả toạ độ giữ được lớp sai số grounding thật — click
trượt ra biên, click vào khe giữa hai ô — vốn là phần phân biệt model computer-use
thật với model chỉ suy luận về ảnh. `click_outside_grid` là một loại thất bại
riêng trong report vì lý do này.

Đánh đổi: solver nào chỉ trả index phải tự quy đổi ra tâm ô trong adapter của nó,
và mất phần sai số đó. Chấp nhận — ghi `coordSource: 'derived'` vào attempt để
report không trộn hai loại.

## Quyết định 2: JEV là judge, không phải solver

Bắt buộc bởi năng lực model (`project.md`). Cụ thể JEV nhận `state` là **mô tả
bằng chữ** của một trial đã chạy xong — không phải ảnh:

```ts
state = {
  instruction: 'Select all images with bridges',
  grid: { cols: 4, rows: 4 },
  groundTruthTiles: [2, 6, 7],
  modelSelectedTiles: [2, 6, 11],
  tileDescriptions: {           // nhãn từ manifest, không phải ảnh
    2: 'bridge, daytime, full object',
    6: 'bridge, partial — object cắt qua ô 6 và 7',
    11: 'bus, street scene',
  },
  clickPoints: [{ x: 312, y: 198 }, ...],
  gridBox: { x: 40, y: 120, w: 600, h: 600 },
}
```

Ba câu hỏi, một round trip:

| key | type | dùng để |
|---|---|---|
| `ambiguous` | `boolean` | đề có mơ hồ không — `criteria.true/false` mô tả rõ |
| `failureCause` | `choice` | `correct` / `object_split_across_tiles` / `distractor_confusion` / `click_precision` / `instruction_misread` |
| `severity` | `score` | `['trivial', 'minor', 'major', 'disqualifying']` |

JEV **không** quyết định pass/fail. Pass/fail do `challenge-server` chấm cơ học.
JEV chỉ giải thích. Tách bạch việc này giữ cho metric chính không phụ thuộc một
model thứ hai.

## Quyết định 3: judge chạy sau run, không chạy trong vòng lặp worker

Judge đọc bảng `attempts` sau khi run kết thúc, batch qua. Lý do: giữ đường đo
latency của worker sạch (thêm một lời gọi mạng vào vòng lặp sẽ làm bẩn p95), và
cho phép chạy lại judge trên run cũ khi đổi câu hỏi mà không phải chạy lại cả
benchmark.

`--judge off | after | rerun <runId>`.

## Quyết định 4: hai baseline bắt buộc

`oracle` (đọc ground truth → 100%) và `random` (sàn nhiễu). Số của model thật chỉ
đọc được giữa hai mốc. `oracle` cũng là test pipeline: nếu nó không đạt 100%, lỗi
nằm ở harness chứ không ở model.

`random` còn là **leak test sống**: solve rate của nó phải nằm trong khoảng nhị
thức kỳ vọng. Cao hơn nghĩa là ground truth đang rò ra client.

## Quyết định 5: ranh giới cưỡng chế bằng code, không bằng văn bản

Hai lớp:

1. `src/worker/guard.ts` — allowlist `['127.0.0.1', 'localhost']` hard-code, không
   đọc env. Cắm qua `context.route('**')`, host ngoài thì `route.abort()` + throw.
2. `pnpm lint:boundaries` — grep source + `package.json`, fail khi thấy
   `recaptcha`, `hcaptcha`, `turnstile`, `funcaptcha`, `proxy-chain`,
   `puppeteer-extra-plugin-stealth`, `playwright-extra`. Chạy trong CI.

Văn bản mô tả ý định; hai lớp này mới là thứ giữ ý định.

## Quyết định 6: xác định tile bị cắt ở khâu sinh đề

`compose.ts` biết nó đặt ảnh nào vào ô nào, nên nó cũng biết khi nào một vật thể
bị cắt qua hai ô liền kề (chế độ `hard`). Ghi thẳng vào `Challenge.splitObjects`.

Lý do: nếu để judge tự suy ra từ mô tả, ta đo khả năng suy luận của JEV chứ không
đo model click. Có ground truth cho việc cắt ô thì `failureCause` của JEV kiểm
chứng được — đó là cầu nối sang benchmark calibration (`add-jev-calibration-benchmark`).

## Rủi ro đã biết

| Rủi ro | Xử lý |
|---|---|
| Orphan chromium khi run bị ngắt | `pool.ts` bắt SIGINT/SIGTERM, đóng context trước exit; CLI in PID + port |
| Dashboard làm chậm worker | event bus fire-and-forget; đo wall time có/không dashboard, chênh < 5% |
| Ground truth rò qua response | leak test assert trên chuỗi thô, giữ trong CI |
| Toạ độ chuẩn hoá `[0,1]` bị hiểu là pixel | `coordSpace` khai báo trong config adapter, clamp + cảnh báo khi > 95% click rơi vào góc trên trái |
| Judge tự tin sai | JEV không quyết pass/fail; `probability` là P(true) và bị làm tròn 2 chữ số, ghi vào report để đánh giá riêng; `confidence` của Choice/Score đọc ở `providerMetadata.typesafe.confidence` |
