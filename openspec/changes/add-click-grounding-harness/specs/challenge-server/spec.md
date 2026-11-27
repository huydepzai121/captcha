# challenge-server

## ADDED Requirements

### Requirement: Cấp challenge qua HTTP

Hệ thống SHALL cung cấp `POST /api/challenges` nhận `{ runId, seed?, difficulty? }`
và trả `{ id, instruction, grid, imageUrl, expiresAt }`.

Hệ thống SHALL cung cấp `GET /api/challenges/:id/image` trả ảnh lưới dạng PNG.

#### Scenario: Tạo challenge

- **WHEN** `POST /api/challenges` với `runId` hợp lệ
- **THEN** trả 201 kèm `id` và `imageUrl`
- **AND** challenge được ghi vào store với `expiresAt` cách hiện tại 120 giây

### Requirement: Ground truth không rời server

Response của `POST /api/challenges`, nội dung `GET /c/:id`, và mọi tài nguyên
client tải được SHALL NOT chứa `isTarget`, `target`, `tiles[].source`, hay
`splitObjects`.

#### Scenario: Response không rò đáp án

- **WHEN** `POST /api/challenges` trả về
- **AND** body thô được chuyển thành chuỗi
- **THEN** chuỗi không chứa `isTarget`, `target`, `splitObjects`
- **AND** chuỗi không chứa tên file nào có trong manifest

#### Scenario: HTML không rò đáp án

- **WHEN** `GET /c/:id` trả về
- **THEN** HTML body không chứa `isTarget`, `target`, hay tên file tile
- **AND** mỗi vùng click chỉ mang `data-tile-index`

### Requirement: Chấm bài server-side

Hệ thống SHALL cung cấp `POST /api/challenges/:id/verify` nhận `{ selected: number[] }`
và trả `{ ok, correct, wrong, missed, latencyMs }`.

`ok` SHALL là true khi và chỉ khi tập `selected` bằng đúng tập tile có `isTarget`.

#### Scenario: Chọn đúng hết

- **WHEN** `selected` bằng đúng tập tile đúng
- **THEN** `ok` là true, `wrong` là 0, `missed` là 0

#### Scenario: Chọn thừa một ô

- **WHEN** `selected` chứa đủ tile đúng cộng thêm một tile sai
- **THEN** `ok` là false và `wrong` là 1

#### Scenario: Thiếu một ô

- **WHEN** `selected` thiếu một tile đúng
- **THEN** `ok` là false và `missed` là 1

### Requirement: Một lần thử cho mỗi challenge

Mỗi challenge SHALL verify được đúng một lần.

#### Scenario: Verify lần hai bị chặn

- **WHEN** `POST /api/challenges/:id/verify` được gọi lần thứ hai trên cùng id
- **THEN** trả 409 và không ghi attempt mới

#### Scenario: Hết hạn

- **WHEN** verify được gọi sau `expiresAt`
- **THEN** trả 410
- **AND** attempt được ghi với lý do thất bại `expired`

### Requirement: Chỉ phục vụ loopback

Server SHALL bind `127.0.0.1`. Server SHALL NOT bind `0.0.0.0` hay địa chỉ ngoài.

#### Scenario: Bind loopback

- **WHEN** server khởi động
- **THEN** socket đang lắng nghe ở `127.0.0.1` trên port cấu hình
- **AND** không có socket nào của tiến trình lắng nghe trên địa chỉ ngoài

### Requirement: Trang challenge cho worker

Hệ thống SHALL cung cấp `GET /c/:id` trả trang HTML hiển thị `instruction` và ảnh
lưới, chia thành `cols × rows` vùng click, mỗi vùng mang `data-tile-index`.

Trang SHALL giữ trạng thái chọn phía client và gửi một lần khi người dùng kích
hoạt nút xác nhận.

#### Scenario: Chọn rồi xác nhận

- **WHEN** hai vùng click được kích hoạt rồi nút xác nhận được bấm
- **THEN** đúng một request `POST /api/challenges/:id/verify` được gửi
- **AND** `selected` chứa đúng hai index đã chọn

### Requirement: Lưu trữ run và attempt

Hệ thống SHALL lưu `runs`, `challenges`, và `attempts` vào SQLite.

Mỗi attempt SHALL ghi `challengeId`, `selected`, `ok`, `latencyMs`, `solver`,
`workerId`, `submittedAt`, và lý do thất bại khi có.

#### Scenario: Tổng hợp theo run

- **WHEN** `GET /api/runs/:runId` được gọi sau khi run kết thúc
- **THEN** trả tổng số attempt, số `ok`, và phân rã theo lý do thất bại
