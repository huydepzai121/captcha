# evaluation-judge

## ADDED Requirements

### Requirement: Judge dùng evaluation model qua AI Gateway

Hệ thống SHALL gọi `typesafe-ai/jev` qua Vercel AI Gateway để phân tích attempt
đã hoàn tất, dùng API evaluation.

Hệ thống SHALL xác thực bằng `AI_GATEWAY_API_KEY` đọc từ biến môi trường.

Hệ thống SHALL NOT gọi evaluation model qua endpoint tương thích OpenAI,
Anthropic, hay Cohere, vì các endpoint đó không hỗ trợ evaluation.

Đích SHALL là `POST https://ai-gateway.vercel.sh/v1/evaluate` — host
`ai-gateway.vercel.sh`, không phải `.ai`. Hệ thống SHALL dùng chung host này với
adapter vision (`/v1/chat/completions`), nhưng qua hai đường khác nhau.

#### Scenario: Gọi qua đường evaluation

- **WHEN** judge chạy trên một attempt
- **THEN** lời gọi đi tới `https://ai-gateway.vercel.sh/v1/evaluate` với model
      `typesafe-ai/jev`
- **AND** request mang `state` và `questions`

### Requirement: State của judge là mô tả có cấu trúc, không phải ảnh

`state` gửi cho judge SHALL là một object mô tả trial, gồm `instruction`, `grid`,
`groundTruthTiles`, `modelSelectedTiles`, `tileDescriptions`, `clickPoints`, và
`gridBox`.

Hệ thống SHALL NOT gửi ảnh cho evaluation model.

#### Scenario: Không gửi ảnh

- **WHEN** judge xây `state` cho một attempt
- **THEN** `state` không chứa dữ liệu ảnh, đường dẫn ảnh, hay chuỗi base64
- **AND** mô tả tile lấy từ nhãn trong manifest

### Requirement: Ba câu hỏi trong một round trip

Judge SHALL hỏi ba câu trên cùng một `state` trong một request:

- `ambiguous` kiểu `boolean`, kèm `criteria` mô tả rõ trường hợp đúng và sai
- `failureCause` kiểu `choice`, với các lựa chọn `correct`,
  `object_split_across_tiles`, `distractor_confusion`, `click_precision`,
  `instruction_misread`
- `severity` kiểu `score`, với thang `['trivial', 'minor', 'major', 'disqualifying']`

#### Scenario: Một request cho ba câu hỏi

- **WHEN** judge chạy trên một attempt
- **THEN** đúng một request được gửi
- **AND** response mang cả ba key trong `answers`

#### Scenario: Lưu đủ dạng answer

- **WHEN** response trở về
- **THEN** hệ thống lưu `probability` của `ambiguous`
- **AND** lưu `choice` cùng toàn bộ `probabilities` của `failureCause`
- **AND** lưu `score` cùng toàn bộ `probabilities` của `severity`

### Requirement: Judge không quyết định pass hay fail

Kết quả pass/fail của một attempt SHALL do challenge-server chấm cơ học.

Output của judge SHALL NOT thay đổi `ok` của attempt hay solve rate trong report.

#### Scenario: Judge mâu thuẫn với kết quả chấm

- **WHEN** judge trả `failureCause` là `correct` cho một attempt có `ok` là false
- **THEN** `ok` giữ nguyên false
- **AND** solve rate không đổi
- **AND** mâu thuẫn được gắn cờ để người xem lại

### Requirement: Judge chạy tách khỏi vòng lặp worker

Judge SHALL chạy sau khi run kết thúc, đọc attempt từ store theo lô.

Judge SHALL NOT được gọi bên trong vòng lặp xử lý của worker.

#### Scenario: Latency của worker không dính lời gọi judge

- **WHEN** chạy cùng một benchmark với `--judge off` và với `--judge after`
- **THEN** `solverMs` và `totalMs` của các attempt tương đương giữa hai lần chạy

#### Scenario: Chạy lại judge trên run cũ

- **WHEN** lệnh benchmark chạy với `--judge rerun <runId>` của một run đã xong
- **THEN** judge chạy lại trên attempt của run đó
- **AND** không có challenge mới nào được sinh
- **AND** kết quả judge cũ bị thay thế, còn pass/fail giữ nguyên

### Requirement: Judge chịu lỗi không làm hỏng run

Khi lời gọi judge thất bại hoặc trả dữ liệu không hợp lệ, hệ thống SHALL giữ
nguyên attempt và ghi nhận judge không có kết quả cho attempt đó.

#### Scenario: Judge lỗi mạng

- **WHEN** lời gọi judge thất bại sau khi hết số lần thử
- **THEN** attempt giữ nguyên pass/fail và số liệu latency
- **AND** report ghi số attempt không được judge

### Requirement: Quyền riêng tư và chi phí của lời gọi judge

Hệ thống SHALL cho phép đặt `providerOptions.gateway.zeroDataRetention` và
`providerOptions.gateway.only` qua cấu hình.

Hệ thống SHALL ghi log `usage` và chi phí từ metadata của gateway cho mỗi lời gọi
judge.

#### Scenario: Chi phí judge tách khỏi chi phí solver

- **WHEN** report được sinh cho một run có judge
- **THEN** chi phí của judge và của solver được báo cáo thành hai dòng riêng
