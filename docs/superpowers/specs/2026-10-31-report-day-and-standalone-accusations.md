# GGD Hub — Ngày chơi mặc định và Báo cáo người chơi tách riêng

- Ngày: 2026-10-31
- Trạng thái: Người dùng yêu cầu trực tiếp; lựa chọn: mốc 6:00 sáng; +1 báo cáo vào Tổng "Cả 3 phe".
- Thay thế phần "gửi báo cáo kèm lần khai" của spec `2026-10-28-role-points-and-accusations-design.md` §6 (các báo cáo cũ đã gắn lần khai giữ nguyên và vẫn chạy như cũ).

## A. Ngày chơi và buổi mặc định

- **Ngày chơi mặc định** = ngày VN của (bây giờ − 6 giờ): từ 00:00 đến 05:59 giờ VN là ngày hôm trước, từ 06:00 là hôm nay. Một hàm dùng chung `defaultPlayedOn(now: Date): string` trong `src/shared/` (có test ranh giới 05:59/06:00, nửa đêm, đầu tháng).
- **Buổi mặc định**: buổi (không bị huỷ) của ngày mặc định có giờ bắt đầu gần nhất mà đã bắt đầu trước "bây giờ" (nếu có), không thì buổi đầu tiên của ngày đó, không có buổi → để trống.
- Áp dụng: form **Khai điểm** (web) và form **Báo cáo người chơi** (§B) — chọn sẵn ngày và buổi, người dùng vẫn đổi được; lệnh Discord `/baocao` khi không nhập `ngay` dùng ngày mặc định (và gắn buổi mặc định nếu có, như web).
- Giới hạn khai vẫn là `[hôm nay − 3, hôm nay]` theo ngày VN (không đổi).

## B. Báo cáo người chơi — tab riêng

- Trang **Khai điểm**: thanh tab ngay dưới tiêu đề trang: **"Khai điểm"** | **"Báo cáo người chơi"** (`?tab=` giữ trên URL, mặc định Khai điểm; chỉ báo vạch dùng `TabIndicator`). Form khai điểm **không còn** phần "Báo cáo người chơi" (bỏ ô tick và bốn ô chọn khỏi form khai/sửa).
- Tab **Báo cáo người chơi**: form gồm "Ngày chơi" (mặc định §A), "Buổi" (tuỳ chọn, mặc định §A), "Người bị báo cáo", "Role của họ" (role đang bật có chỉ số phạt, nhóm theo phe), "Họ bắn trúng ai", "Phe của người bị bắn", "Ghi chú" (tuỳ chọn ≤ 300). Nút **"Gửi báo cáo"**. Gợi ý: "Báo cáo đúng: bạn +1 điểm (Tổng cả 3 phe), người bị báo cáo bị trừ điểm phạt của role đó." Dưới form: danh sách **"Báo cáo của tôi"** (mới nhất trước) với trạng thái: "Đang chờ duyệt" / "Báo cáo đúng · bạn +1 điểm" / "Báo cáo bị bác: {lý do}" / "Đã có người báo cáo trước" / "Đã bị huỷ: {lý do}".
- **Dữ liệu**: `player_accusations.report_id` thành NULL được (giữ UNIQUE khi có); thêm `session_id INT NULL` (FK), `note TEXT NULL` (≤ 300), `revoked_by`, `revoked_at`, trạng thái thêm `revoked`. Báo cáo mới tạo với `report_id = NULL`. `reporter_id`, `played_on`, các trường khác như cũ.
- **Luật gửi**: thành viên đang hoạt động; ngày trong `[hôm nay − 3, hôm nay]`, mùa chưa chốt; buổi (nếu có) không huỷ và cùng ngày VN; bốn trường bắt buộc; người bị báo cáo/người bị bắn đang hoạt động; không tự báo cáo; người bị bắn ≠ người bị báo cáo; role có chỉ số phạt và đang bật; tối đa 10 báo cáo mỗi người mỗi ngày VN. Không có điều kiện tham gia buổi.
- **Trùng vụ** (người bị báo cáo + role + người bị bắn + ngày chơi): hàng chờ chỉ hiện báo cáo `pending` sớm nhất của vụ; vụ đã có mục trừ điểm còn hiệu lực → báo cáo mới của vụ không hiện, ghi chú cho người gửi như hiện nay. Báo cáo sớm nhất bị bác → báo cáo kế tiếp hiện.
- **Duyệt** (Quản trị → Duyệt điểm, mục mới **"Báo cáo người chơi chờ duyệt ({n})"** tách khỏi hàng chờ lần khai): mỗi dòng: người báo cáo, "{người} ({icon} {role}) bắn {người bị bắn} — phe {phe}", ngày, buổi, ghi chú; nút **Duyệt** / **Từ chối** (lý do). Duyệt → báo cáo `approved` + tạo mục trừ điểm cho người bị báo cáo (như hiện nay: `source='accusation'`, `penalty_value = 1`, `approved`, ghi chú "Bị báo cáo: bắn {tên} (phe {phe})") + các báo cáo trùng còn chờ → `superseded` + DM người bị báo cáo; mod không duyệt báo cáo mà mình là người gửi hoặc người bị báo cáo (admin được); khoá dòng mùa như huỷ duyệt; kiểm tra đổi hoá thân role bị trừ.
- **Điểm người báo cáo**: mỗi báo cáo **độc lập** (`report_id IS NULL`) ở trạng thái `approved` cộng **+1** vào Tổng điểm theo phe tab **"Cả 3 phe"** của người gửi trong mùa của `played_on` (không vào bảng role/hoá thân/Top 3/phe riêng). Báo cáo cũ gắn lần khai vẫn tính qua `bonus_points` như cũ.
- **Huỷ duyệt**: "Đã duyệt gần đây" có cả báo cáo người chơi (nhãn "Báo cáo") → Huỷ duyệt (lý do): báo cáo `revoked` + mục trừ điểm kèm theo `revoked` (cùng giao dịch, khoá mùa), DM người gửi và người bị báo cáo; +1 mất theo.
- **Chốt mùa**: báo cáo độc lập `pending` của mùa → `rejected` "Mùa đã chốt".
- **API**: `POST /api/accusations`, `GET /api/accusations/mine`, `GET /api/admin/accusations?status=pending|approved`, `POST /api/admin/accusations/:id/review` `{approve, reason?}`, `POST /api/admin/accusations/:id/revoke` `{reason}`. `POST/PATCH /api/reports` không nhận `accusation` nữa (gửi lên → bỏ qua có cảnh báo trong log, hoặc 400 `VALIDATION` "Báo cáo người chơi gửi ở tab riêng") — chọn 400.

## Kiểm thử

- §A: hàm ngày mặc định (ranh giới), buổi mặc định, form web chọn sẵn, `/baocao` không nhập ngày.
- §B: gửi (mọi lỗi), trùng vụ, duyệt/từ chối/huỷ (quyền, tự duyệt, khoá mùa, DM, superseded, mục trừ), +1 chỉ vào "Cả 3 phe", báo cáo cũ gắn lần khai không đổi điểm, chốt mùa; web: tab, form, danh sách của tôi, Duyệt điểm mục mới, form khai điểm không còn phần báo cáo; 320px.
- `npm run typecheck`, toàn bộ test, `npm run build` đạt.
