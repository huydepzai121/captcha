# worker-pool

## ADDED Requirements

### Requirement: Chạy song song N worker

Hệ thống SHALL chạy tối đa N worker đồng thời, với N lấy từ tham số `--workers`.

Mỗi worker SHALL dùng một browser context riêng, không chia sẻ cookie hay storage
với worker khác.

#### Scenario: Giới hạn đồng thời được tôn trọng

- **WHEN** chạy với `--workers 8` và `--trials 200`
- **THEN** không quá 8 challenge ở trạng thái đang xử lý tại bất kỳ thời điểm nào
- **AND** đúng 200 attempt được ghi khi run kết thúc

### Requirement: Vòng đời worker có trạng thái quan sát được

Mỗi worker SHALL đi qua các trạng thái `SPAWNED`, `EXECUTING`, `VERIFYING`, rồi
kết thúc ở `COMPLETE` hoặc `FAILED`.

Mỗi lần chuyển trạng thái SHALL phát một event mang `workerId`, `challengeId`,
`state`, `ts`, và `detail` khi có.

#### Scenario: Chuỗi trạng thái đầy đủ

- **WHEN** một worker xử lý xong một challenge
- **THEN** event bus nhận được các trạng thái theo đúng thứ tự trên
- **AND** trạng thái cuối là `COMPLETE` hoặc `FAILED`, không phải cả hai

### Requirement: Không thử lại

Một challenge thất bại SHALL được ghi là `FAILED` và SHALL NOT được thử lại.

#### Scenario: Thất bại giữ nguyên

- **WHEN** một attempt trả `ok` là false
- **THEN** worker chuyển sang challenge kế tiếp
- **AND** không có attempt thứ hai nào cho challenge đó

### Requirement: Allowlist host cứng

Worker SHALL chỉ điều hướng tới host trong allowlist gồm `127.0.0.1` và
`localhost`.

Allowlist SHALL được viết cứng trong mã nguồn. Hệ thống SHALL NOT đọc allowlist từ
biến môi trường, file cấu hình, hay tham số dòng lệnh.

#### Scenario: Chặn host ngoài

- **WHEN** một worker cố điều hướng tới host không thuộc allowlist
- **THEN** request bị huỷ ở tầng route
- **AND** worker ném lỗi và kết thúc ở `FAILED`

#### Scenario: Không có đường mở rộng allowlist

- **WHEN** một biến môi trường hay tham số dòng lệnh đặt tên một host khác
- **THEN** allowlist không đổi

### Requirement: Cưỡng chế ranh giới ở CI

Hệ thống SHALL cung cấp một lệnh kiểm tra ranh giới, quét mã nguồn và
`package.json`, và SHALL thoát với mã khác 0 khi thấy tham chiếu tới dịch vụ
chống bot production hay công cụ né phát hiện bot.

Danh sách chặn SHALL gồm `recaptcha`, `hcaptcha`, `turnstile`, `funcaptcha`,
`proxy-chain`, `puppeteer-extra-plugin-stealth`, `playwright-extra`.

#### Scenario: Phụ thuộc vi phạm bị chặn

- **WHEN** một gói trong danh sách chặn được thêm vào `package.json`
- **AND** lệnh kiểm tra ranh giới chạy
- **THEN** lệnh thoát khác 0 và nêu tên gói vi phạm

### Requirement: Dọn tiến trình khi kết thúc

Pool SHALL bắt `SIGINT` và `SIGTERM`, đóng mọi browser context, rồi mới thoát.

CLI SHALL in PID và port đang giữ khi khởi động.

#### Scenario: Ngắt giữa chừng không để lại tiến trình mồ côi

- **WHEN** run đang chạy với 8 worker và nhận `SIGINT`
- **THEN** mọi browser context được đóng trước khi tiến trình thoát
- **AND** không còn tiến trình chromium nào của run đó tồn tại

### Requirement: Giao diện dòng lệnh chạy benchmark

Hệ thống SHALL cung cấp lệnh benchmark nhận `--workers`, `--trials`, `--solver`,
`--difficulty`, `--run-id`, và `--judge`.

`--judge` SHALL nhận `off`, `after`, hoặc `rerun <runId>`.

#### Scenario: Chạy không tốn chi phí judge

- **WHEN** chạy với `--judge off`
- **THEN** không có lời gọi nào tới model đánh giá
- **AND** run vẫn sinh đủ số liệu pass/fail
