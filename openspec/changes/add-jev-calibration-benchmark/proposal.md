# Change: add-jev-calibration-benchmark

## Why

`typesafe-ai/jev` trả xác suất, không trả văn bản. Giá trị của nó nằm ở chỗ con
số đó **đáng tin tới đâu** — `probability: 0.98` có thật sự đúng 98 lần trên 100
hay không. Một model trả 0.98 cho mọi thứ vẫn có accuracy cao nếu bài dễ, nhưng
vô dụng khi cần đặt ngưỡng.

Đây là câu hỏi quyết định xem có nên dùng JEV làm judge trong
`add-click-grounding-harness`, và rộng hơn là dùng nó để tự động duyệt hay định
tuyến. Accuracy đơn thuần không trả lời được; cần đo calibration.

So sánh với LLM thường làm judge cũng cần thiết: nếu một LLM phổ thông tự báo độ
tin cậy mà đạt calibration tương đương với chi phí thấp hơn, JEV không có lý do
tồn tại trong pipeline.

## What Changes

- Thêm bộ dataset có nhãn người cho cả ba kiểu câu hỏi `boolean`, `choice`, `score`.
- Thêm runner gọi JEV qua AI Gateway theo lô, lưu toàn bộ phân bố xác suất.
- Thêm bộ chỉ số calibration: ECE, Brier score, reliability diagram, AUROC cho
  `boolean`; accuracy và ma trận nhầm lẫn cho `choice`; tương quan Spearman và MAE
  so với nhãn người cho `score`.
- Thêm baseline LLM-as-judge để so sánh trên cùng dataset.
- Thêm báo cáo so sánh gồm chất lượng, chi phí, và độ trễ.

## Impact

- Affected specs: `jev-calibration`
- Affected code: `src/calibration/`, dùng lại store và lớp gateway của
  `add-click-grounding-harness`
- Phụ thuộc: cần lớp truy cập AI Gateway từ change kia. Dataset thì độc lập, gán
  nhãn được song song.

## Blocker

Dataset chưa có. Cần tối thiểu 300 mẫu mỗi kiểu câu hỏi, có nhãn người, trong đó
một phần lấy từ chính output judge của harness để hai change kiểm chứng lẫn nhau.
