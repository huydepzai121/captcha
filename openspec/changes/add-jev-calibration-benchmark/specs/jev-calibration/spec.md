# jev-calibration

## ADDED Requirements

### Requirement: Dataset có nhãn cho cả ba kiểu câu hỏi

Hệ thống SHALL duy trì một dataset gồm tối thiểu 300 mẫu cho mỗi kiểu `boolean`,
`choice`, và `score`.

Mỗi mẫu SHALL mang `state`, định nghĩa câu hỏi, nhãn người, và `source` thuộc một
trong `synthetic`, `harness`, `adversarial`.

#### Scenario: Đủ kích thước và đủ nguồn

- **WHEN** script kiểm tra dataset chạy
- **THEN** script fail nếu kiểu câu hỏi nào dưới 300 mẫu
- **AND** script fail nếu nguồn `adversarial` dưới 10% tổng số mẫu

### Requirement: Đồng thuận giữa người gán nhãn

Mỗi mẫu SHALL có ít nhất hai nhãn người độc lập. Hệ thống SHALL tính Cohen's κ
cho mỗi kiểu câu hỏi.

Mẫu không đạt đồng thuận SHALL được đánh dấu `contested` và báo cáo thành nhóm
riêng.

#### Scenario: Công bố độ đồng thuận

- **WHEN** báo cáo được sinh
- **THEN** báo cáo nêu κ cho từng kiểu câu hỏi
- **AND** nêu số mẫu `contested`

#### Scenario: Mẫu mơ hồ được chấm riêng

- **WHEN** chỉ số được tính
- **THEN** mẫu `contested` không nằm trong chỉ số chính
- **AND** được báo cáo riêng, coi xác suất gần 0.5 là hành vi mong muốn

### Requirement: Chạy đánh giá theo lô qua AI Gateway

Hệ thống SHALL gọi `typesafe-ai/jev` tại
`POST https://ai-gateway.vercel.sh/v1/evaluate`, xác thực bằng
`AI_GATEWAY_API_KEY`.

Hệ thống SHALL lưu toàn bộ phân bố xác suất của mỗi answer, không chỉ nhãn được
chọn.

#### Scenario: Lưu đủ phân bố

- **WHEN** một mẫu `choice` được đánh giá
- **THEN** hệ thống lưu `choice` được chọn và `probabilities` của mọi lựa chọn

#### Scenario: Lưu đủ thang điểm

- **WHEN** một mẫu `score` được đánh giá
- **THEN** hệ thống lưu `score` nội suy và `probabilities` của từng bậc

#### Ghi chú về độ chính xác số

TypeSafe trả `score` và `probability` **làm tròn 2 chữ số thập phân**. Tổng
`probabilities` của một answer có thể không bằng đúng 1.

Hệ thống SHALL lưu giá trị nguyên văn như model trả, và SHALL NOT chuẩn hoá lại
hay assert tổng bằng 1.

Chỉ số SHALL chịu được sai số làm tròn này khi tính ECE và Brier. Hệ thống SHALL
ghi lại số chữ số làm tròn vào report để người đọc biết độ phân giải của dữ liệu.

### Requirement: Phân biệt probability với confidence

Với `choice` và `score`, TypeSafe trả thêm `confidence` — một thống kê riêng, nằm
ở `providerMetadata.typesafe.confidence[questionId]`.

Với `boolean`, `probability` là **P(true)**, không phải độ tự tin của model về
câu trả lời.

Hệ thống SHALL lưu cả hai khi có, và SHALL NOT dùng lẫn vai của chúng trong báo
cáo.

#### Scenario: Boolean không có confidence

- **WHEN** một answer `boolean` được lưu
- **THEN** hệ thống chỉ ghi `probability` là P(true)
- **AND** không gán nhãn `confidence` cho nó

### Requirement: Chỉ số calibration cho câu hỏi boolean

Hệ thống SHALL tính ECE với 10 bin đều, Brier score, AUROC, và dữ liệu dựng
reliability diagram.

#### Scenario: ECE tính đúng theo định nghĩa

- **WHEN** chỉ số được tính trên một tập đã biết trước kết quả
- **THEN** ECE bằng trung bình có trọng số của lệch giữa độ tin cậy và độ chính
      xác trong từng bin

#### Scenario: Phát hiện tự tin thái quá

- **WHEN** model trả xác suất cao cho các mẫu thực tế sai
- **THEN** reliability diagram nằm dưới đường chéo ở các bin cao
- **AND** báo cáo gọi tên hiện tượng tự tin thái quá

### Requirement: Chỉ số cho câu hỏi choice và score

Với `choice`, hệ thống SHALL tính accuracy, ma trận nhầm lẫn, và ECE trên xác
suất của lựa chọn được chọn.

Với `score`, hệ thống SHALL tính tương quan Spearman so nhãn người, MAE, và tỉ lệ
mẫu lệch quá một bậc.

#### Scenario: Ma trận nhầm lẫn đầy đủ

- **WHEN** báo cáo được sinh cho câu hỏi `choice`
- **THEN** ma trận có đủ mọi cặp nhãn thật và nhãn dự đoán
- **AND** tổng các ô bằng số mẫu đã đánh giá

### Requirement: Đo độ ổn định lặp lại

Hệ thống SHALL đánh giá mỗi mẫu nhiều lần, số lần lấy từ tham số `--repeats`, mặc
định 3.

Hệ thống SHALL báo cáo độ lệch chuẩn của xác suất giữa các lần lặp.

#### Scenario: Cảnh báo khi không ổn định

- **WHEN** độ lệch chuẩn trung bình vượt 0.05
- **THEN** báo cáo gắn cờ model không ổn định cho mục đích tự động hoá

### Requirement: So sánh với baseline LLM-as-judge

Hệ thống SHALL đánh giá cùng dataset bằng một LLM phổ thông được yêu cầu trả nhãn
kèm confidence, dùng đúng bộ chỉ số.

#### Scenario: So sánh cùng điều kiện

- **WHEN** báo cáo so sánh được sinh
- **THEN** cả hai model được chấm trên cùng mẫu, cùng chỉ số, cùng cách parse
- **AND** báo cáo nêu chất lượng, chi phí mỗi mẫu, và độ trễ cho từng model

### Requirement: Kiểm chứng ảnh hưởng của việc gộp câu hỏi

Hệ thống SHALL chạy một tập con ở cả hai chế độ: gộp nhiều câu hỏi trong một
request, và tách mỗi câu một request.

#### Scenario: Gộp câu hỏi làm lệch kết quả

- **WHEN** chỉ số giữa hai chế độ lệch quá 2 điểm phần trăm
- **THEN** báo cáo ghi nhận việc gộp là biến gây nhiễu
- **AND** nêu rõ chế độ đã dùng cho các con số chính

### Requirement: Báo cáo tách theo nguồn dữ liệu

Báo cáo SHALL trình bày chỉ số tách riêng cho `synthetic`, `harness`, và
`adversarial`, ngoài con số tổng.

#### Scenario: Không che điểm yếu bằng số tổng

- **WHEN** model đạt tốt trên `synthetic` nhưng kém trên `adversarial`
- **THEN** báo cáo hiển thị rõ cả hai
- **AND** không trình bày chỉ một con số tổng

### Requirement: Giới hạn phạm vi kết luận

Báo cáo SHALL nêu rõ kết luận chỉ áp dụng cho phân bố dữ liệu đã đo, và SHALL
liệt kê kích thước mẫu cùng khoảng tin cậy cho mỗi chỉ số chính.

#### Scenario: Chỉ số kèm khoảng tin cậy

- **WHEN** báo cáo nêu một chỉ số chính
- **THEN** chỉ số đi kèm kích thước mẫu và khoảng tin cậy 95%

### Requirement: Cache kết quả đánh giá

Hệ thống SHALL cache kết quả theo hash của `(model, state, questions, chế độ gộp)`
và tái dùng khi chạy lại, trừ khi được yêu cầu bỏ qua cache.

#### Scenario: Chạy lại không tốn thêm chi phí

- **WHEN** cùng một benchmark chạy lần thứ hai không đổi dataset
- **THEN** không có lời gọi mạng mới nào được thực hiện
- **AND** báo cáo sinh ra giống lần đầu
