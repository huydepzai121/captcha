# metrics-report

## ADDED Requirements

### Requirement: Báo cáo cuối run

Hệ thống SHALL sinh `runs/<runId>/report.json` và `runs/<runId>/report.md` khi
run kết thúc.

Báo cáo SHALL gồm solve rate tổng và phân rã theo `category` và `difficulty`,
latency `p50`/`p95`/`max` tách riêng `solverMs` và `totalMs`, token và chi phí
cộng dồn, phân rã thất bại theo lý do, đường cong scaling, và cấu hình run gồm
solver, khoảng seed, và commit sha.

#### Scenario: Report khớp với dữ liệu thô

- **WHEN** report được sinh cho một run
- **THEN** solve rate trong report bằng tỉ lệ attempt có `ok` là true trong store
- **AND** tổng số attempt trong report bằng số dòng attempt của run đó

#### Scenario: Phân rã thất bại đầy đủ

- **WHEN** report được sinh
- **THEN** các lý do `timeout`, `bad_schema`, `click_outside_grid`, `wrong_tiles`,
      và `expired` đều có mặt
- **AND** tổng các lý do bằng số attempt thất bại

### Requirement: Đường cong scaling

Báo cáo SHALL ghi, với mỗi mức `--workers` đã chạy, số trial, wall time, và
throughput mỗi phút.

#### Scenario: Đủ mọi mức đồng thời

- **WHEN** benchmark đã chạy ở các mức 1, 4, 8, và 16 worker
- **THEN** đường cong scaling có đủ bốn điểm

### Requirement: Kết quả judge trong báo cáo

Khi run có judge, báo cáo SHALL gồm phân bố `failureCause`, `severity` trung
bình, số challenge bị đánh dấu mơ hồ, và số attempt không được judge.

Báo cáo SHALL giữ solve rate độc lập với output của judge.

#### Scenario: Báo cáo không judge vẫn đầy đủ

- **WHEN** run chạy với `--judge off`
- **THEN** report vẫn có solve rate, latency, và phân rã thất bại
- **AND** phần judge được ghi là không chạy

### Requirement: Phát sự kiện trực tiếp

Hệ thống SHALL phát event của worker qua WebSocket theo `runId`.

Hệ thống SHALL giữ một ring buffer 500 event gần nhất và phát lại cho client mới
kết nối trước khi chuyển sang luồng trực tiếp.

#### Scenario: Không mất event ở mức đồng thời cao

- **WHEN** chạy với 16 worker và 300 trial, có một client đang kết nối từ đầu
- **THEN** số event client nhận bằng số event server phát

#### Scenario: Client vào giữa chừng nhận được ngữ cảnh

- **WHEN** một client kết nối khi run đã chạy được một nửa
- **THEN** client nhận tối đa 500 event gần nhất rồi mới nhận event trực tiếp

### Requirement: Dashboard không ảnh hưởng số đo

Việc phát event SHALL không chặn vòng lặp worker. Hệ thống SHALL NOT chờ client
xác nhận trước khi worker đi tiếp.

#### Scenario: Có dashboard không làm chậm run

- **WHEN** cùng một benchmark chạy có và không có dashboard mở
- **THEN** chênh lệch wall time dưới 5%

### Requirement: Hiển thị trạng thái run

Dashboard SHALL hiển thị các challenge đang chạy kèm `instruction`, ảnh lưới, ô
mà solver đã chọn, và trạng thái worker.

Dashboard SHALL hiển thị luồng log worker và tóm tắt run gồm số worker, solve
rate đang chạy, và số trial đã xong trên tổng.

#### Scenario: Run kết thúc khi dashboard đang mở

- **WHEN** run kết thúc lúc dashboard đang mở
- **THEN** dashboard hiển thị trạng thái kết thúc và không lỗi
