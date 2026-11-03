# GGD Hub — Tổ chức offline

- Ngày: 2026-11-01
- Trạng thái: Đã duyệt thiết kế trong chat

## Dữ liệu

- `offline_events`: `id`, `title` (1–80), `starts_at TIMESTAMPTZ`, `place` (1–120), `description` (≤ 500, NULL), `vote_deadline TIMESTAMPTZ NULL`, `closed BOOL DEFAULT false`, `announced_at TIMESTAMPTZ NULL`, `created_by`, `created_at`, `updated_at`.
- `offline_votes`: `(event_id, member_id)` PK, `going BOOL`, `updated_at`.

## Quản trị (mod + admin)

- Quản trị → tab mới **"Offline"**: danh sách sự kiện (sắp tới trước, rồi đã qua), mỗi dòng: tên, thời gian, địa điểm, số "đi được"/"không đi được", nút **Sửa**, **Đóng vote**/**Mở lại**, **Xoá** (xác nhận). Form: "Tên", "Thời gian" (datetime giờ VN), "Địa điểm", "Mô tả" (tuỳ chọn), "Hạn vote" (tuỳ chọn, ≤ thời gian sự kiện).
- API (`requireMod`): `GET/POST /api/admin/offline-events`, `PATCH/DELETE /api/admin/offline-events/:id`. Lỗi: "Tên 1–80 ký tự", "Địa điểm 1–120 ký tự", "Mô tả tối đa 500 ký tự", "Hạn vote phải trước giờ sự kiện".

## Thành viên

- Trang **Hôm nay**: ngay **dưới phần buổi chơi**, mỗi sự kiện chưa diễn ra (`starts_at` ≥ đầu ngày hôm nay giờ VN), gần nhất trước: thẻ **"🎉 Offline: {tên}"** — `{Thứ}, {dd/mm} lúc {HH:mm}` · `📍 {địa điểm}` · mô tả; hai nút **"Mình đi được"** / **"Không đi được"** (nút đã chọn nổi bật; bấm lại nút kia để đổi); "{n} người đi được" + hàng avatar (tối đa 12, "+k"); bấm số → danh sách tên cả hai nhóm. Hết hạn vote hoặc `closed` → nút ẩn, ghi "Đã chốt danh sách". Phản hồi tức thì (cập nhật lạc quan, lỗi trả lại).
- API (`requireMember`): `GET /api/offline-events/upcoming` → sự kiện + số đếm + danh sách người theo nhóm + vote của người xem; `PUT /api/offline-events/:id/vote` `{ going: boolean }`; lỗi "Đã hết hạn vote".

## Discord

- Tạo sự kiện → bot đăng vào **#thông-báo**: "🎉 Offline: **{tên}** — {Thứ} {dd/mm} {HH:mm} tại {địa điểm}" + mô tả + "Vote đi được hay không trên web: {APP_URL}" (đường dẫn web như các tin khác dùng), ghi `announced_at`; lỗi Discord chỉ ghi log, bộ hẹn giờ đăng bù sự kiện chưa đăng và chưa diễn ra. Escape markdown, không mention.

## Kiểm thử và xong

- CRUD + lỗi + quyền; vote/đổi vote/hạn/đóng; upcoming đúng thứ tự và số đếm; Discord đăng + đăng bù; web tab Offline, thẻ Hôm nay dưới buổi chơi, lạc quan, 320px. `npm run typecheck`, toàn bộ test, `npm run build`. README đoạn ngắn.
