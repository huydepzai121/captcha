# CÀI ĐẶT — Captcha Benchmark Harness

Hướng dẫn cài đặt và chạy dự án bằng **npm** (không dùng pnpm nữa).

## Yêu cầu

- **Node.js >= 22** (kiểm tra: `node -v`)
- **npm >= 10** (kiểm tra: `npm -v`)
- Windows / macOS / Linux đều chạy được.

## Cài đặt

Mở terminal tại thư mục gốc dự án, chạy:

```bash
npm install
```

Lần đầu cài có thể mất vài phút do `sharp`, `better-sqlite3` (module native) và `playwright` cần tải/biên dịch.

> **Lưu ý (npm mới):** nếu npm in cảnh báo `allow-scripts` về `sharp` hoặc `esbuild`, hãy phê duyệt để đảm bảo module native hoạt động:
>
> ```bash
> npm approve-scripts sharp esbuild
> npm rebuild sharp esbuild
> ```

## Tải trình duyệt cho Playwright (lần đầu)

Dự án dùng Playwright để mô phỏng click. Cần tải trình duyệt một lần duy nhất:

```bash
npx playwright install chromium
```

## Chạy dự án

```bash
npm start
```

Server khởi động tại **http://127.0.0.1:3000**. Log khởi động trông như sau:
```
[harness] pid=12345 · http://127.0.0.1:3000
```

## Các lệnh khác

| Lệnh | Chức năng |
|---|---|
| `npm start` | Chạy server chính (port 3000) |
| `npm run serve` | Giống `npm start` |
| `npm test` | Chạy toàn bộ test (vitest) |
| `npm run typecheck` | Kiểm tra kiểu TypeScript |
| `npm run gen:assets` | Sinh ảnh captcha mẫu |
| `npm run verify-assets` | Kiểm tra tính hợp lệ của ảnh |
| `npm run bench` | Chạy benchmark |
| `npm run agent` | Chạy agent giải captcha |
| `npm run dev -w sim` | Chạy server mô phỏng (`sim/`) |

## Khắc phục sự cố

**Lỗi `sharp` / `better-sqlite3` không load được (module native):**

```bash
npm approve-scripts sharp esbuild better-sqlite3
npm rebuild
```

**Port 3000 bị chiếm:** đổi port trong `src/server/index.ts` (hằng số `PORT`) hoặc tắt tiến trình đang giữ port.

**Cài từ đầu hoàn toàn:**

```bash
rm -rf node_modules package-lock.json
npm install
npm start
```
