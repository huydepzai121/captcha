# Change: add-click-grounding-harness

## Why

Cần biết một vision model định vị và click đúng ô trên lưới ảnh chính xác tới đâu,
và con số đó giữ được bao nhiêu khi chạy nhiều worker song song. Chưa có cách đo.

Ý tưởng ban đầu là dùng `typesafe-ai/jev` làm bên click. Doc chính thức bác bỏ
điều đó: JEV không nhận ảnh và không trả toạ độ (xem `project.md`). Nhưng JEV khớp
chính xác một vai khác trong cùng bài toán — **trọng tài có kiểu**. Pass/fail cơ
học (so tập ô đã chọn với ground truth) không nói được *vì sao* sai: ô mơ hồ, vật
thể bị cắt qua hai ô, hay model thật sự nhìn nhầm. JEV trả `boolean` kèm xác suất
và `score` trên thang có sẵn, nên phân loại được thất bại mà không cần người ngồi
gán nhãn từng trial.

## What Changes

- Thêm bộ sinh challenge lưới ảnh, tái lập được từ seed, ground truth server-side.
- Thêm challenge server: cấp đề, render trang, chấm bài. Bind loopback.
- Thêm worker pool: N worker song song, mỗi worker một browser context.
- Thêm interface `ClickSolver` + hai baseline (`oracle`, `random`) + adapter thật
  (`claude`).
- Thêm lớp judge dùng `typesafe-ai/jev` qua AI Gateway: phân loại nguyên nhân
  thất bại, chấm độ mơ hồ của challenge, gắn cờ trial cần người xem lại.
- Thêm dashboard live + report cuối run.
- Thêm `lint:boundaries` chặn mọi phụ thuộc vi phạm ranh giới dự án.

## Impact

- Affected specs: `challenge-generation`, `challenge-server`, `worker-pool`,
  `click-solver`, `evaluation-judge`, `metrics-report`
- Affected code: toàn bộ (greenfield)
- Chi phí chạy: mỗi trial một lời gọi vision model + một lời gọi JEV. JEV rẻ hơn
  một bậc (`cost` mẫu trong doc ≈ `0.00001155`/request), nhưng `--judge off` phải
  có sẵn để chạy vòng lặp phát triển không tốn tiền.

## Blocker

Image set chưa chốt. Cần nguồn có license cho phép dùng lại, ≥ 40 ảnh mỗi
category. `challenge-generation` không implement được trước khi chốt việc này.
