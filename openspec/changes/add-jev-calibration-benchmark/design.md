# Design — add-jev-calibration-benchmark

## Quyết định 1: đo calibration, không chỉ đo accuracy

Accuracy trả lời "đoán đúng bao nhiêu lần". Calibration trả lời "khi nói 0.9 thì
đúng bao nhiêu lần" — và đó mới là thứ quyết định được ngưỡng tự động duyệt.

Chỉ số cho `boolean`:

| Chỉ số | Đọc thế nào |
|---|---|
| ECE (10 bin) | lệch trung bình giữa xác suất và tần suất đúng thực tế. Thấp là tốt |
| Brier score | sai số bình phương trung bình. Gộp cả calibration lẫn sức phân biệt |
| Reliability diagram | vẽ ra, thấy ngay model tự tin thái quá hay rụt rè |
| AUROC | sức phân biệt, độc lập với ngưỡng |

Cần cả ECE lẫn AUROC vì chúng bắt hai lỗi khác nhau: một model phân biệt tốt
nhưng lệch thang sẽ có AUROC cao và ECE xấu, và ngược lại. Nhìn một cái là kết
luận sai.

`choice`: accuracy, ma trận nhầm lẫn, cộng ECE tính trên xác suất của lựa chọn
được chọn.
`score`: Spearman ρ so nhãn người, MAE, và tỉ lệ lệch quá một bậc.

## Quyết định 2: nhãn người là chuẩn, có đo độ đồng thuận

Mỗi mẫu cần ≥ 2 người gán nhãn độc lập. Tính Cohen's κ.

Lý do: nếu người còn không đồng ý với nhau thì không có chuẩn nào để chấm model.
Mẫu có κ thấp tách riêng thành nhóm "vốn mơ hồ" và báo cáo riêng — model trả xác
suất quanh 0.5 ở nhóm này là **đúng**, không phải sai. Trộn chung sẽ phạt oan.

Nhóm này cũng là phép thử đáng giá nhất: một judge tốt phải biết lúc nào nó không
biết.

## Quyết định 3: dataset ba nguồn

1. **Synthetic có nhãn sẵn** — từ `challenge-generation`. Đáp án tuyệt đối, dùng
   để kiểm tra đường ống chấm điểm.
2. **Output judge của harness** — trial thật từ `add-click-grounding-harness`,
   người gán nhãn lại. Đây là phân bố sát thực tế dùng nhất.
3. **Mẫu đối kháng viết tay** — trường hợp biên: phủ định lồng nhau, đơn vị đo
   lẫn lộn, tiêu chí mâu thuẫn nhau.

Mỗi mẫu ghi rõ nguồn. Report tách theo nguồn vì ba nguồn có độ khó khác hẳn nhau;
gộp lại thành một con số sẽ che mất chỗ model hỏng.

## Quyết định 4: baseline là LLM tự báo độ tin cậy

Baseline hỏi một LLM phổ thông cùng câu hỏi, yêu cầu trả JSON kèm confidence,
chấm bằng đúng bộ chỉ số.

Đây là câu hỏi thực tế: JEV có hơn thứ mình đã có không, đủ để bù chi phí và một
phụ thuộc mới không. Report phải trả lời được bằng số, không bằng cảm tính.

Lưu ý: confidence LLM tự báo thường lệch cao. Đó chính là thứ cần đo, không phải
thứ cần sửa.

## Quyết định 5: đo độ ổn định lặp lại

Mỗi mẫu chạy 3 lần. Ghi độ lệch chuẩn của xác suất.

Judge không ổn định thì không tự động hoá được, dù calibration trung bình có đẹp.
Doc không nói JEV có tất định hay không — nên phải đo, không giả định.

## Quyết định 6: gộp câu hỏi theo lô trong một request

API cho phép nhiều câu hỏi chung một `state`, trả lời trong một round trip. Runner
tận dụng điều này khi các câu hỏi cùng chia sẻ một `state`.

Cảnh báo: gộp câu hỏi có thể làm câu này ảnh hưởng câu kia. Cần một thí nghiệm
kiểm chứng — chạy một tập con ở cả hai chế độ gộp và tách, so kết quả. Nếu lệch
đáng kể, chế độ gộp phải ghi rõ trong report vì nó thành một biến gây nhiễu.

## Rủi ro đã biết

| Rủi ro | Xử lý |
|---|---|
| Dataset quá dễ, mọi model đều ~1.0 | Bắt buộc có nhóm đối kháng; báo cáo tách theo nguồn |
| Nhãn người lệch | ≥2 người, công bố κ, tách nhóm κ thấp |
| Chi phí chạy lặp | Cache theo hash của `(model, state, questions)`; `--repeats` chỉnh được |
| So sánh thiên vị | Cùng dataset, cùng chỉ số, cùng cách parse cho mọi model |
| Suy diễn ngoài phạm vi | Report nêu rõ kết luận chỉ áp cho phân bố đã đo |
