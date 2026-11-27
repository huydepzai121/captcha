# challenge-generation

## ADDED Requirements

### Requirement: Deterministic challenge generation

Hệ thống SHALL sinh một challenge lưới ảnh từ một seed số nguyên, sao cho cùng
seed và cùng options luôn cho ra challenge giống hệt nhau, kể cả byte của file ảnh.

Hệ thống SHALL dùng PRNG có seed. Hệ thống SHALL NOT dùng `Math.random` trong
đường sinh đề.

#### Scenario: Cùng seed cho cùng kết quả

- **WHEN** `generate(42, { difficulty: 'medium' })` được gọi ba lần
- **THEN** ba `Challenge` trả về có cùng `target`, cùng `tiles`, cùng thứ tự
- **AND** sha256 của ba file `imagePath` bằng nhau

#### Scenario: Seed khác cho đề khác

- **WHEN** `generate(1)` và `generate(2)` được gọi với cùng options
- **THEN** ít nhất một trong `target` hoặc tập `tiles` khác nhau

### Requirement: Ground truth đầy đủ và hợp lệ

Mỗi `Challenge` SHALL mang ground truth đầy đủ: mỗi tile có `index`, `source`, và
`isTarget`.

Số tile đúng SHALL nằm trong 2–5 với `easy`, và 1–6 với `medium` và `hard`. Hệ
thống SHALL NOT sinh challenge có 0 tile đúng hoặc toàn bộ tile đúng.

#### Scenario: Số tile đúng nằm trong biên

- **WHEN** sinh 1000 challenge với seed ngẫu nhiên, đủ cả ba difficulty
- **THEN** mọi challenge có số tile đúng nằm trong biên của difficulty tương ứng
- **AND** mọi `Category` xuất hiện ít nhất một lần

### Requirement: Thang độ khó

Hệ thống SHALL hỗ trợ ba mức `easy`, `medium`, `hard`.

`easy` SHALL dùng lưới 3×3 và không biến dạng. `medium` SHALL dùng lưới 4×4.
`hard` SHALL dùng lưới 4×4, áp blur σ≈1.2, nén JPEG q=45, và đặt ít nhất một vật
thể bị cắt qua hai ô liền kề.

#### Scenario: Hard sinh vật thể bị cắt ô

- **WHEN** `generate(seed, { difficulty: 'hard' })`
- **THEN** `challenge.splitObjects` có ít nhất một phần tử
- **AND** mỗi phần tử đặt tên hai `tileIndex` liền kề nhau trên lưới

### Requirement: Distractor gây nhầm có chủ đích

Khi chọn tile sai, hệ thống SHALL ưu tiên category dễ nhầm với `target` theo bảng
nhầm lẫn khai báo sẵn, thay vì chọn đều ngẫu nhiên.

#### Scenario: Target bus kéo theo distractor cùng cảnh

- **WHEN** sinh challenge với `target: 'bus'`
- **THEN** tập tile sai chứa ít nhất một tile thuộc category cùng cảnh đường phố
      khi image set còn đủ ảnh chưa dùng

### Requirement: Image set có nhãn và có license

Mọi ảnh nguồn SHALL có một entry trong `assets/images/manifest.json` mang
`file`, `category`, `license`, và `source`.

Hệ thống SHALL cung cấp một script kiểm tra manifest, chạy trước test suite, và
script này SHALL fail khi có file thiếu entry, entry thiếu file, hoặc entry thiếu
`license`.

#### Scenario: Thiếu license thì chặn

- **WHEN** một entry trong manifest không có `license`
- **AND** script kiểm tra assets chạy
- **THEN** script thoát với mã khác 0 và nêu tên file vi phạm

#### Scenario: Đủ ảnh để không lặp distractor

- **WHEN** script kiểm tra assets chạy
- **THEN** script fail nếu có category nào dưới 40 ảnh
