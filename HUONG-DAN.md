# HƯỚNG DẪN — xem agent giải reCAPTCHA

Tài liệu này chỉ việc **chạy và xem** agent giải captcha. Cài đặt môi trường (Node,
npm, Playwright) làm theo [CAI-DAT.md](CAI-DAT.md) trước.

Có hai loại đích, đừng lẫn:

| Loại đích | Dùng khi nào | Có bắt giải không |
|---|---|---|
| **Trang mẫu** — testbed `http://127.0.0.1:3400/` | Muốn **thấy** agent vét lưới ảnh | **Luôn** bắt. Sitekey test chính thức của Google luôn thả challenge |
| Trang thật — vinades.vn, muasamcong… | Muốn biết trang thật xử ra sao | Thường **thả thẳng**, không có lưới để xem |

Trang thật mà Google tin (Chrome thật, profile đã dùng vài lần) thì tick là qua,
agent không có gì để giải. Muốn xem nó giải thì dùng trang mẫu.

---

## 1. Chuẩn bị

```bash
npm install
npx playwright install chromium
```

Cần `AI_GATEWAY_API_KEY` trong `.env` ở thư mục gốc (xem `.env.example`). Không có
key thì agent dừng ngay ở bước gọi model.

## 2. Dựng trang mẫu

```bash
npm run testbed
```

Log in ra hai địa chỉ:

```
[testbed] http://127.0.0.1:3400/ — reCAPTCHA luôn bắt giải
[testbed] http://127.0.0.1:3400/hcaptcha — hCaptcha luôn bắt giải
```

Để nguyên cửa sổ terminal đó. Mở http://127.0.0.1:3400/ bằng mắt thường cũng được:
panel trong trang in đúng những thứ Google soi (`navigator.webdriver`, UA, GPU qua
WebGL, timezone, kích thước cửa sổ).

> **Trang `/hcaptcha` hiện chưa dùng được** (đo 27/11): sitekey test trong trang bị
> hCaptcha từ chối — console báo `Is not a valid sitekey` và không có iframe nào
> được dựng, nên agent không có gì để tick. Cứ dùng trang reCAPTCHA `/`; chi tiết
> ở [agent/README.md](agent/README.md).


## 3. Chạy agent lên trang mẫu

Terminal thứ hai:

```bash
npx tsx scripts/live-target.ts "http://127.0.0.1:3400/" --headful --slowmo 250
```

`--headful` để thấy trình duyệt, `--slowmo 250` làm chậm mỗi thao tác 250ms cho dễ
theo dõi. Cửa sổ ở lại sau khi xong để xem trạng thái cuối; đóng cửa sổ để thoát.

Một lượt chạy trông như sau:

```
  [+5.3s] đã tick anchor
  [+5.4s] ── challenge #1 · 3x3 · "Select all images with cars"
  [+9.8s]    lượt 1: JEV(ảnh) 513ms → 3 ô [5,7,8]
  [+9.8s]    JEV: 0:2 1:11 2:7 3:3 4:4 5:98 6:9 7:99 8:92
  [+17.1s]    mất hết tick — chọn lại 3 ô
  [+21.5s]    verify → Google chấm
  [+22.9s]    challenge mới
  ...
  [+31.8s] PASS ✓
```

Kết quả cuối in ra `captcha: PASS` và trang hiện **ĐÃ GIẢI XONG**. Ảnh chụp lưu ở
`runs/live-target/sau-captcha.png`.

## 4. Chạy trên trang thật

Không cần tài khoản (chỉ đo captcha, server sẽ trả "tài khoản không tồn tại"):

```bash
npx tsx scripts/live-target.ts "https://muasamcong.mof.gov.vn/c/portal/login" --headful
```

Có tài khoản — trang chấm công vinades.vn (đi qua SSO iportal.vn):

```bash
npx tsx scripts/live-checkio.ts --headful --user <tên đăng nhập> --pass <mật khẩu>
```

Trang đăng nhập của NukeViet **không** dựng widget reCAPTCHA sẵn: `site.js` chặn
submit rồi mới bung modal chứa widget (`reCaptcha2Execute`). Vì vậy `live-checkio.ts`
điền form và bấm "Đăng nhập" trước — nếu bấm tay trước rồi mới chạy agent thì modal
đã mở, agent sẽ chờ anchor vô ích.

Ảnh từng bước nằm ở `runs/live-checkio/`: `01-da-dien`, `02-sau-khi-bam`,
`03-ket-qua`.

## 5. Cờ của hai script

| Cờ | Việc |
|---|---|
| `--headful` | hiện trình duyệt (không có thì headless) |
| `--slowmo N` | chậm mỗi thao tác N ms, mặc định 120–250 |
| `--user` / `--pass` | tài khoản cần đăng nhập (`live-checkio.ts`; `live-target.ts` nhận cùng cờ) |
| `--firefox` | chạy Firefox thay Chrome (`live-checkio.ts`) — cần `npx playwright install firefox` |
| `--min-side N` | phóng ảnh lưới tới sàn N px trước khi gửi model, mặc định 768 |
| `--no-ambiguity` | tắt bước hỏi lại từng ô mơ hồ — nhanh và rẻ hơn, hợp khi chỉ cần thử |

Script dùng profile riêng trong `runs/pw-profile-*`, nên cookie và lịch sử tích luỹ
giữa các lần chạy: Google càng tin thì càng ít challenge.

## 6. Xem agent giải trên trang thật khi Google có thả challenge

`npm run agent` là bản đầy đủ cờ (xem [agent/README.md](agent/README.md)):

```bash
npm run agent -- --headful --slowmo 150 --target "https://muasamcong.mof.gov.vn/c/portal/login" --profile lan1
```

## 7. Sự cố thường gặp

**`Profile ... is already in use`** — cửa sổ Chrome của lần chạy trước còn mở. Đóng
nó, hoặc:

```powershell
Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
  Where-Object { $_.CommandLine -like '*pw-profile-*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

**Muốn khó lại** — xoá profile để Google coi như máy lạ:

```powershell
Remove-Item -Recurse -Force runs\pw-profile-chrome-target
```

**Port 3400 bị chiếm** — sửa `PORT` trong `agent/testbed/server.ts`.

**`không thấy khung hCaptcha`** — trang `/hcaptcha` của testbed đang hỏng sitekey,
widget không render. Dùng trang reCAPTCHA `/`, hoặc thay sitekey trong
`agent/testbed/server.ts`.

**`không thấy widget reCAPTCHA`** — trang chưa bung widget. Trên trang NukeViet phải
bấm nút đăng nhập trước (dùng `live-checkio.ts`), và kiểm tra trang có thực sự là
form đăng nhập không.

**`AI_GATEWAY_API_KEY chưa set`** — thêm key vào `.env`, hoặc export biến trong shell.

## 8. Chi phí

Mỗi lượt gọi JEV vài trăm ms và tốn token ảnh, tính theo bảng giá của TypeSafe
($42/Btok input). Trang mẫu 2 challenge ≈ vài phần nghìn đô; một phiên dài trên
trang thật vài xu. Chạy headless và bỏ `--slowmo` thì nhanh hơn nhưng không xem được.

## 9. Bản đồ file

| File | Việc |
|---|---|
| `agent/demo-agent.ts` | vòng giải: tick anchor, chụp lưới, JEV quyết định, click, verify |
| `agent/jev-solve.ts` | gửi ảnh lưới cho JEV, lấy xác suất từng ô |
| `agent/testbed/server.ts` | trang mẫu dùng sitekey test của Google |
| `scripts/live-target.ts` | chạy agent lên một URL bất kỳ, lưu ảnh, đọc phản hồi |
| `scripts/live-checkio.ts` | flow đầy đủ cho trang đăng nhập NukeViet/SSO |
| `scripts/probe-checkio.ts` | soi form đăng nhập: field, iframe, vị trí widget |
| `scripts/check-session.ts` | mở lại profile đã đăng nhập để xem trang sau khi vào |
