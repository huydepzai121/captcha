# Agent — JEV đọc ảnh lưới, quyết định, click

Agent chạy trên trang demo reCAPTCHA của Google. `typesafe-ai/jev` (Jev 1.14) đọc
được **ảnh**, nên nó là cả mắt lẫn não: gửi nguyên ảnh lưới, hỏi từng ô một câu
`noul`, lấy xác suất, click ô vượt ngưỡng.

```
ảnh lưới ──► JEV (ảnh + noul từng ô) ──► click ô có p ≥ ngưỡng
                                              │
                                              ▼
                                     Google swap ảnh mới
                                              │
                                 (lặp tới khi 0 ô khớp)
                                              │
                                              ▼
                                           verify

đường lùi (khi JEV ảnh hỏng): vision mô tả ô bằng chữ → JEV chấm chữ
```

Đường lùi vẫn giữ vì nó là thứ duy nhất còn chạy khi TypeSafe trả 4xx/503 hoặc
ảnh vượt giới hạn. Chạy bình thường thì vision không được gọi lần nào
(`visionCalls: 0` trong report).

## Ai quyết định cái gì

| Việc | Bên làm |
|---|---|
| Nhìn ô | **JEV** — nhận ảnh lưới qua `assets` |
| Ô nào để click | **JEV**, ngưỡng `--threshold` (mặc định 0.5) |
| Cứu lượt khi JEV ảnh hỏng | vision mô tả → JEV chấm chữ (`source: vision-fallback`) |

Một request, N câu `noul`, toạ độ ghi bằng lời: *"does the tile at row 2, column 3
contain it?"*. Không có model nào trả lời bằng chữ tự do nên không có bước parse
văn bản để hỏng.

## Chạy

```bash
npm run agent                                # headless, tự động
npm run agent -- --headful --slowmo 150      # xem từng bước
npm run agent -- --headful --keep-open       # giữ cửa sổ sau khi xong
npm run agent -- --max-attempts 12 --threshold 0.5
```

| Cờ | Việc |
|---|---|
| `--headful` | hiện trình duyệt |
| `--slowmo N` | làm chậm mỗi thao tác Playwright N ms |
| `--keep-open` | không đóng trình duyệt khi xong |
| `--max-attempts N` | số challenge tối đa (mặc định 35) |
| `--threshold P` | ngưỡng xác suất JEV để click (mặc định 0.5) |
| `--decision vision` | ép dùng đường lùi vision + JEV chữ |
| `--jev-model M` | đổi model decision (mặc định `jev-latest`) |
| `--vision-model M` | đổi model vision của đường lùi |
| `--browser firefox` | chạy Firefox thay vì Chrome |
| `--debug-dir D` | lưu ảnh từng lượt + raw khi bỏ sót |
| `--target <url>` | trang đích (mặc định là trang demo Google) |
| `--profile <tên>` | tách profile trình duyệt riêng |
| `--fresh` (chỉ `bench:demo`) | mỗi trial một profile mới |

Cần `AI_GATEWAY_API_KEY` trong `.env` (nạp qua `agent/env.ts`) hoặc trong shell.
Biến đã set trong shell được ưu tiên, `.env` chỉ là mặc định.

Key `apikey_…` là key **TypeSafe**: chỉ dùng được ở `api.typesafe.ai`. Gửi nó
lên `ai-gateway.vercel.sh` sẽ nhận 401 — hai surface khác nhau, đừng lẫn.

## Chạy trên trang thật

```bash
# trang đăng nhập thật (captcha nằm trong form Keycloak)
npm run agent -- --headful --target "https://muasamcong.mof.gov.vn/…" --profile lan1
```

Trang thật thường **pass thẳng** khi profile đã được Google tin. Ba lần đầu với
profile mới cũng có thể pass thẳng — đó là Google chấm nhẹ, không phải agent
hỏng. Muốn xem nó giải thì dùng testbed bên dưới. Giữ `--profile` giữa các lần
cho Google quen dần; xoá `runs/pw-profile-chrome-<tên>` khi muốn khó lại.

## Trang test luôn bắt giải

Sitekey demo thật không ép được challenge, nên có trang test riêng: sitekey test
chính thức của Google (luôn thả challenge) + panel in các dấu vết bị soi.

```bash
npm run testbed                       # http://127.0.0.1:3400/
npm run agent -- --headful --target http://127.0.0.1:3400/ --profile tb1
npm run bench:demo -- --trials 5 --workers 1 --fresh --headful --target http://127.0.0.1:3400/
```

Mở http://127.0.0.1:3400/ bằng mắt thường cũng được: panel hiện
`navigator.webdriver`, UA, GPU qua WebGL, timezone, kích thước cửa sổ — đúng
những thứ Google đọc.

## hCaptcha — hoãn, ưu tiên reCAPTCHA

Trang test: http://127.0.0.1:3400/hcaptcha. Agent tự nhận ra hCaptcha (`iframe`
chứa `hcaptcha.com`) và đi flow riêng trong `agent/hcaptcha.ts`.

**Chặn hiện tại (đo 27/11): trang test không render widget.** Trình duyệt tải
được `https://js.hcaptcha.com/1/api.js` (HTTP 200) nhưng console báo:

```
[hCaptcha] Invalid render configuration
[hCaptcha] sitekey | Is not a valid sitekey.
```

Sitekey test `10000000-ffff-ffff-ffff-000000000002` trong `agent/testbed/server.ts`
bị hCaptcha từ chối, nên không có iframe nào — không phải lỗi flow. Muốn thử
hCaptcha phải thay sitekey thật (hoặc sitekey test còn hiệu lực) trước, rồi mới
đo được. Chừng nào chưa thay thì mọi phép đo hCaptcha đều vô nghĩa.

Khác reCAPTCHA ở chỗ load-bearing: hCaptcha vẽ cả lưới lên **một `<canvas>`**,
không có DOM từng ô — nên phải chụp canvas, click theo toạ độ, đọc prompt từ
`.prompt-text`, gửi bằng `.button-submit`.

Ba chỗ code đã biết còn sai (giữ nguyên, chưa sửa):

1. `.error-text` nằm sẵn trong DOM và hiện từ trước khi gửi, nên không dùng được
   làm dấu hiệu "sai"; hiện chỉ còn hai tín hiệu (checkbox tick, đổi đề) và
   trường hợp sai-rồi-giữ-nguyên-đề đang rơi vào timeout 6s.
2. Đề hCaptcha không phải dạng "select all with X" mà là câu tự do
   ("Find drinks that can be hot or cold") — cần prompt riêng cho JEV.
3. Lưới canvas có thể có padding/viền nên toạ độ tâm ô cần đo lại, chưa xác minh
   là click rơi đúng ô.

Đừng dùng hCaptcha làm mốc so sánh cho tới khi sửa xong ba điểm trên. Đường
reCAPTCHA bên trên không bị ảnh hưởng: auto-detect chỉ rẽ nhánh khi trang có
hCaptcha.

## Đo trên reCAPTCHA của trang thật

Hai script dựng sẵn cho việc này — chúng là thứ đã chạy đúng, dùng thay vì tự
viết lại vòng lặp:

| Script | Việc |
|---|---|
| `npx tsx scripts/live-target.ts "<url>" --headful` | mở một URL bất kỳ, tick/solve, đọc phản hồi, lưu ảnh |
| `npx tsx scripts/live-checkio.ts --headful --user U --pass P` | flow đầy đủ cho trang đăng nhập NukeViet/SSO (điền form trước, captcha nằm trong modal) |

Cả hai dùng chung `runAgent` và hai hook `beforeSolve`/`afterSolve`. Trang thật
thường **pass thẳng** vì Chrome thật + profile tích luỹ; muốn thấy lưới thì dùng
testbed, đừng kết luận từ trang thật.


## Vì sao không bị chặn

reCAPTCHA v2 không chặn, nó **chấm điểm** rồi nâng độ khó (challenge dài hơn,
nhiều ảnh động hơn). Vài thứ giữ điểm đủ cao:

- Chrome thật qua `channel: 'chrome'` — không phải Chromium của Playwright, nên
  JA3/JA4, canvas, WebGL, GPU, font đều là Chrome thật.
- `--disable-blink-features=AutomationControlled` → `navigator.webdriver` là
  `false`. Không patch JS, không stealth plugin.
- `launchPersistentContext` + profile riêng: cookie và lịch sử tích luỹ, Google
  coi là người quay lại. Đây là yếu tố mạnh nhất, mạnh hơn mọi cờ.
- Chuột "người": nhiều chặng di chuyển, dừng ngắn trước khi nhấn, jitter trong
  ô, click bằng toạ độ. Với một số trang, `element.click()` **không** mở được
  challenge — phải chuột thật.
- Headful, một cửa sổ, không proxy, không đổi UA.

Còn máy móc: cửa sổ 1280×800 trùng đúng kích thước màn hình, một tab, không gõ
phím, không scroll, click cách nhau đều. Đó là những chỗ còn có thể siết.

## Kiểm tra đường dây khi không có key

`scripts/smoke-agent-mock.ts` chạy trên trang Google thật nhưng thay cả hai
surface bằng gateway giả (xác suất dựng sẵn). Không tốn tiền, không cần key:

```bash
npx tsx scripts/smoke-agent-mock.ts                 # JEV quyết định bình thường
npx tsx scripts/smoke-agent-mock.ts --fail-jev      # JEV 503 → kiểm tra dự phòng
npx tsx scripts/smoke-agent-mock.ts --headful       # xem tận mắt
```

Nếu chạy mà log hiện `vision(fallback)` khi không truyền `--fail-jev` thì đường
JEV đang gãy.

## Số đo thật

Sáu trial liên tiếp, cùng cấu hình (headless, Chrome, `--threshold 0.5`):

| | JEV đọc ảnh | Vision + JEV chữ (bản cũ) |
|---|---|---|
| Pass | **5/6 (83%)** | 4/6 (67%) |
| Challenge trung bình | 23,0 | 24,2 |
| Chi phí trung bình / trial | **$0,0190** | $0,0091 |
| Lượt cần vision | **0** | mỗi lượt |

Trên testbed (luôn bắt giải, profile mới mỗi trial): **5/5**, 2,0 challenge/trial,
29 giây, $0,0025/trial. Không có trial nào phải dùng đường lùi vision.

Một lần pass điển hình: 6 challenge, 70 giây, $0,0041. Hai đầu cực: 6 challenge
(36s) và 34 challenge (189s) — Google leo thang rất khác nhau giữa các session.

Hai bên đều 6 trial nên chênh lệch 83% với 67% chưa nói được gì chắc chắn; điều
đo được chắc chắn là **JEV ảnh không cần vision** và rẻ hơn về số lượt gọi, đắt
hơn về token.

## Giới hạn của API ảnh (đã gặp, đừng đoán lại)

- Ảnh phải 280–1568px mỗi cạnh; nhỏ hơn 280 bị 400. Vì vậy ảnh lưới được encode
  lại: co về tối đa 1024, giãn lên tối thiểu 280.
- Bắt buộc header `TypeSafe-Danger-Zone-Images: true`, không thì 400.
- `data_base64` **không** có tiền tố `data:`; `format` là `png` hoặc `jpg`.
- Ảnh phải nằm trong `assets` và được tham chiếu bằng tên trong `state`/`instructions`.
- Câu hỏi `noul` trả `{ type, noul }` với `noul` là P(true), không phải confidence.
- 400 thì thử lại vô ích (ảnh sai cỡ, key sai); 503 mới thử lại.

## Ba điều load-bearing, rút ra từ chạy thật

### 1. Google swap ảnh mới vào ô vừa click, và tick thì GIỮ NGUYÊN

Đây là reCAPTCHA động. Chọn một ô → Google thay ảnh khác vào chỗ đó → phải
chọn tiếp. Instruction của Google nói rõ: *"Click verify once there are none left."*

Đo trên lưới thật (băm vùng giữa ô theo thời gian):

| Thời điểm | Tick | Ảnh trong ô |
|---|---|---|
| trước click | không | A |
| +300ms … +5000ms sau click | **còn** | đổi mỗi ~0,5s (B, C, D…) |
| click lần hai lên cùng ô | **mất** | hoàn lại ảnh A |

Ba hệ quả, đều đã làm agent sai trước khi sửa:

1. **Không được click lại ô đã click** — click lần hai là bỏ chọn và hoàn ảnh cũ.
   Không tin được class trong DOM (Google còn dựng lại bảng làm rơi tick), nên
   agent giữ một `Set` các ô đã click trong suốt challenge.
2. **"Tick còn nguyên" không suy ra được đề tĩnh.** Ô đã tick vẫn đổi ảnh liên
   tục, nên phép so ảnh cũng không kết luận được gì. Điều kiện verify là **vòng
   mới không còn ô nào chưa click mà JEV cho là khớp** — hết việc thì nộp.
3. **Chụp theo mốc thời gian cố định là sai** — bắt được ảnh cũ hoặc khung
   trắng. Cách đúng: chụp tới khi ảnh đứng yên, tức hai khung liên tiếp giống
   hệt nhau (ảnh giữa các lần swap cũng đứng yên trong khoảng ngắn).

```ts
let prev = await table.screenshot();
while (Date.now() < deadline) {
  await sleep(350);
  const next = await table.screenshot();
  if (prev.equals(next)) return next;   // ảnh đã đứng yên
  prev = next;
}
```

Trước khi nộp, nếu DOM báo 0 ô chọn mà ta đã click thì agent chọn lại đúng những
ô đó (chỉ ô đang không tick), rồi mới verify.

### 2. "Please also check the new images" không phải challenge mới

Khi Google chấm sai vì bỏ sót ảnh mới, nó giữ nguyên lưới đó với ảnh mới đã
swap vào. Coi đó là challenge mới rồi reset sẽ mất hết tiến độ. Phải quay lại
vòng chọn **trên cùng challenge đó**.

### 3. Nếu dùng đường lùi: phải tắt reasoning của model vision

`google/gemini-3.5-flash-lite` là reasoning model. Đo trên cùng một lưới 3×3:

| Cấu hình | Thời gian | Chi phí | Reasoning token | Kết quả |
|---|---|---|---|---|
| reasoning bật (mặc định) | 60.2s | $0.0193 | 15 603 | content **rỗng** — chạm trần max_tokens |
| `reasoning: { effort: 'minimal' }` | 10.7s | $0.0025 | 1 853 | 9/9 ô |
| **`reasoning: { enabled: false }`** | **2.5s** | **$0.00018** | 0 | 9/9 ô |

Không tắt thì agent không chạy nổi trong ngân sách thời gian — model đốt hết
token vào suy nghĩ rồi không phát ra gì.

## Chất lượng tách tín hiệu của JEV

Một lượt thật trên lưới 4×4, đề "motorcycles":

```
0:1  1:1  2:1  3:1  4:97  5:1  6:1  7:1
8:95  9:3  10:2  11:2  12:44  13:2  14:1  15:1
```

97/95 cho ô khớp, 1–2 cho ô không, 44 cho ô nằm vùng mơ hồ. Ngưỡng 0.5 nằm giữa
hai cụm và ô 44 là thứ người chỉnh ngưỡng cần thấy. JEV trả xác suất đã hiệu
chuẩn, không phải một nhãn rời — nên ngưỡng chỉnh được bằng số liệu.

### Độ rõ của ảnh quyết định rất nhiều

Đo bằng `scripts/probe-jev-blur.ts` (cùng lưới, cùng đề, chỉ đổi độ rõ). Lưới
"bus" — vật nhỏ, nền rối — ô thật thứ ba rơi khỏi ngưỡng ngay khi mờ nhẹ, nhiễu
nền leo cùng lúc:

| Ảnh | Ô ≥ 0.5 | Xác suất 9 ô |
|---|---|---|
| gốc | 3 | 15 **98** 89 · 1 3 2 · 6 16 **95** |
| blur 1.2 | 2 | 11 **98** 79 · 2 3 2 · 5 17 **49** |
| blur 2.5 | 2 | 7 **96** 61 · 2 3 3 · 5 12 38 |
| blur 4 | 2 | 7 **89** 23 · 4 6 **20** · 10 **40** 64 |
| thu nhỏ 50% | 1 | 5 **98** 12 · 2 3 2 · 4 9 29 |

Lưới "crosswalks" — vật to, tương phản cao — thì bền: blur 4 mới mất 1 ô, thu nhỏ
50% vẫn đủ 3. Nên thứ phá là **tỷ lệ tín hiệu trên nhiễu**, không phải độ mờ nói
chung.

Hai phép phụ trên cùng lưới:

| Cấu hình | Tách tín hiệu | Chi phí / lượt |
|---|---|---|
| cỡ gốc 390px | nhiễu ≤ 16 | $0,00019 |
| phóng 1024px | nhiễu ≤ 4 | **$0,00118** (6×) |
| JPEG q60 | như gốc | $0,00019 |

Pipeline hiện gửi đúng cỡ gốc, chỉ co khi vượt 1024. Phóng lên là núm chỉnh có
thật cho lưới nhỏ, đổi lấy 6× token — chưa bật vì chưa đo được lợi ích trên tỉ
lệ pass.

## Chi phí

Jev tính **$42/Btok input** ($0,042/Mtok), output miễn phí; ảnh tính token như
chữ. Đo thực tế: **$0,0190/trial**, $0,11 cho 6 trial, ~1200 token input mỗi lượt
cho lưới 4×4.

## Đích

`https://www.google.com/recaptcha/api2/demo` — trang demo chính thức của Google
để kiểm thử tích hợp reCAPTCHA. Agent chạy đơn lẻ, thủ công, để đo năng lực
model. Không phải dịch vụ, không có endpoint, không chạy hàng loạt.
