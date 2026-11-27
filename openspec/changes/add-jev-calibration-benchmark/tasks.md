# Tasks — add-jev-calibration-benchmark

## 1. Dataset — BLOCKED cho tới khi có nhãn người

- [ ] 1.1 Chốt schema mẫu: `state`, định nghĩa câu hỏi, nhãn, `source`, id
- [ ] 1.2 Dựng tập `synthetic` từ `challenge-generation` (đáp án tuyệt đối)
- [ ] 1.3 Xuất tập `harness` từ attempt thật của `add-click-grounding-harness`
- [ ] 1.4 Viết tập `adversarial`: phủ định lồng nhau, đơn vị lẫn lộn, tiêu chí
      mâu thuẫn. Tối thiểu 10% tổng số mẫu
- [ ] 1.5 Quy trình gán nhãn: ≥2 người độc lập cho mỗi mẫu
- [ ] 1.6 `scripts/verify-dataset.ts` — kiểm kích thước, tỉ lệ nguồn, đủ nhãn
- [ ] 1.7 Tính Cohen's κ, đánh dấu mẫu `contested`

## 2. Runner

- [ ] 2.1 `src/calibration/client.ts` — gọi evaluation qua AI Gateway
- [ ] 2.2 Lưu **toàn bộ** phân bố xác suất, không chỉ nhãn được chọn
- [ ] 2.3 Chế độ gộp và tách câu hỏi, chọn được qua cờ
- [ ] 2.4 `--repeats`, mặc định 3; lưu từng lần chạy riêng
- [ ] 2.5 Cache theo hash `(model, state, questions, chế độ gộp)`
- [ ] 2.6 Baseline LLM-as-judge, cùng đường parse, cùng cách lưu

## 3. Chỉ số

- [ ] 3.1 `ece.ts` — 10 bin đều; test trên phân bố đã biết trước kết quả
- [ ] 3.2 `brier.ts`, `auroc.ts`
- [ ] 3.3 `reliability.ts` — dữ liệu dựng biểu đồ
- [ ] 3.4 `choice-metrics.ts` — accuracy, ma trận nhầm lẫn, ECE của lựa chọn
- [ ] 3.5 `score-metrics.ts` — Spearman ρ, MAE, tỉ lệ lệch quá một bậc
- [ ] 3.6 `stability.ts` — độ lệch chuẩn giữa các lần lặp
- [ ] 3.7 Khoảng tin cậy 95% cho mọi chỉ số chính
- [ ] 3.8 Test từng chỉ số bằng dữ liệu tổng hợp có đáp số tính tay

## 4. Báo cáo

- [ ] 4.1 Tách theo `source`, kèm số tổng
- [ ] 4.2 Nhóm `contested` báo cáo riêng, xác suất quanh 0.5 tính là đúng
- [ ] 4.3 Bảng so sánh: chất lượng, chi phí mỗi mẫu, độ trễ
- [ ] 4.4 Kết quả thí nghiệm gộp so với tách; gắn cờ nếu lệch quá 2 điểm phần trăm
- [ ] 4.5 Cảnh báo không ổn định khi độ lệch chuẩn trung bình vượt 0.05
- [ ] 4.6 Ghi rõ giới hạn phạm vi kết luận

## 5. Nghiệm thu

- [ ] 5.1 `pnpm verify-dataset` xanh
- [ ] 5.2 Chạy đủ ba kiểu câu hỏi, `--repeats 3`, có baseline
- [ ] 5.3 Reliability diagram dựng được cho `boolean`
- [ ] 5.4 Chạy lại lần hai không phát sinh lời gọi mạng (cache trúng)
- [ ] 5.5 Kết luận trả lời được: có nên dùng JEV làm judge trong harness không,
      ở ngưỡng nào
