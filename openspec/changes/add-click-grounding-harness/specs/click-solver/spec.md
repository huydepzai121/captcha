# click-solver

## ADDED Requirements

### Requirement: Interface solver thống nhất

Hệ thống SHALL định nghĩa một interface `ClickSolver` với `name` và
`solve(req: SolveRequest): Promise<SolveResult>`.

`SolveRequest` SHALL mang `screenshot` (PNG buffer), `instruction`, `grid`,
`gridBox`, và `challengeId`.

`SolveResult` SHALL mang `clicks` là mảng toạ độ tuyệt đối trong screenshot,
`latencyMs`, và tuỳ chọn `rawResponse` cùng `usage`.

#### Scenario: Mọi solver dùng chung một chữ ký

- **WHEN** một solver được đăng ký trong registry
- **THEN** nó nhận được `SolveRequest` và trả `SolveResult` mà không cần worker
      biết nó là solver nào

### Requirement: Solver không truy cập ground truth

Solver SHALL NOT đọc store, đọc manifest, hay dùng `challengeId` để tra cứu đáp
án. Ngoại lệ duy nhất là baseline `oracle`, vốn tồn tại để kiểm tra pipeline.

#### Scenario: Solver chạy khi store đã đóng

- **WHEN** store bị đóng
- **AND** một solver không phải `oracle` được gọi với `SolveRequest` hợp lệ
- **THEN** nó trả `SolveResult` bình thường

### Requirement: Baseline trần và sàn

Hệ thống SHALL cung cấp solver `oracle` đọc ground truth và click vào tâm mọi
tile đúng.

Hệ thống SHALL cung cấp solver `random` chọn ngẫu nhiên k tile, với k lấy từ phân
bố của bộ sinh đề.

#### Scenario: Oracle đạt trần

- **WHEN** chạy 200 trial với solver `oracle`
- **THEN** solve rate là 100%

#### Scenario: Random giữ ở mức sàn

- **WHEN** chạy 200 trial với solver `random`
- **THEN** solve rate nằm trong khoảng tin cậy nhị thức 99% của cấu hình lưới
- **AND** solve rate vượt biên trên bị coi là dấu hiệu rò ground truth

### Requirement: Adapter model qua AI Gateway

Hệ thống SHALL cung cấp một adapter gọi model vision qua Vercel AI Gateway, xác
thực bằng `AI_GATEWAY_API_KEY` đọc từ biến môi trường.

Adapter SHALL yêu cầu model trả JSON đúng schema `{ clicks: [{ x, y }] }` và
SHALL parse strict.

#### Scenario: Response sai schema tính là thất bại

- **WHEN** model trả nội dung không khớp schema
- **THEN** adapter trả `SolveResult` với `clicks` rỗng
- **AND** `rawResponse` giữ nguyên nội dung gốc để soi lại
- **AND** attempt được ghi với lý do thất bại `bad_schema`

#### Scenario: Timeout

- **WHEN** lời gọi model vượt 30 giây
- **THEN** adapter huỷ lời gọi và trả thất bại với lý do `timeout`
- **AND** adapter SHALL NOT thử lại

### Requirement: Khai báo không gian toạ độ

Mỗi adapter SHALL khai báo `coordSpace` là `absolute` hoặc `normalized`.

Khi `normalized`, hệ thống SHALL nhân toạ độ theo kích thước screenshot trước khi
dùng. Hệ thống SHALL clamp toạ độ về trong biên ảnh.

#### Scenario: Toạ độ chuẩn hoá được quy đổi

- **WHEN** adapter khai báo `normalized` và model trả `{ x: 0.5, y: 0.5 }`
- **AND** screenshot rộng 800 cao 600
- **THEN** toạ độ dùng để click là `{ x: 400, y: 300 }`

#### Scenario: Cảnh báo khi nghi cấu hình sai

- **WHEN** quá 95% click trong một run rơi vào góc phần tư trên trái
- **THEN** hệ thống ghi cảnh báo nêu khả năng `coordSpace` bị khai báo sai

### Requirement: Map toạ độ sang ô theo luật chung

Hệ thống SHALL quy đổi mỗi toạ độ click sang chỉ số ô bằng một hàm dùng chung cho
mọi solver, dựa trên `gridBox` và `grid`.

Toạ độ nằm ngoài `gridBox` SHALL trả `null` và tính là click hỏng.

#### Scenario: Click ngoài lưới

- **WHEN** một toạ độ nằm ngoài `gridBox`
- **THEN** nó không chọn ô nào
- **AND** attempt ghi lý do thất bại `click_outside_grid`

#### Scenario: Solver chỉ trả index phải khai báo

- **WHEN** một adapter tự suy ra toạ độ từ chỉ số ô thay vì nhận từ model
- **THEN** attempt ghi `coordSource` là `derived`
- **AND** report tách nhóm này khỏi nhóm toạ độ gốc
