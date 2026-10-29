# GGD Hub — Ngày nhân điểm

- Ngày: 2026-10-30
- Trạng thái: Đã duyệt thiết kế trong chat
- Nhánh: `feat/ggd-hub-v1`
- Lựa chọn của người dùng: chỉ nhân điểm cộng từ lần khai; hệ số nguyên ×2–×5; thông báo bằng banner web + Discord.

## 1. Mục tiêu

Admin đặt một ngày (vd ngày mai) có hệ số nhân điểm. Mọi người thấy banner; điểm cộng của các lần khai có ngày chơi là ngày đó được nhân khi tính bảng xếp hạng.

## 2. Dữ liệu

Bảng mới `score_multiplier_days`: `id`, `day DATE UNIQUE` (ngày VN), `multiplier INT` (CHECK 2..5), `message TEXT NULL` (≤ 100 ký tự, CHECK), `created_by` (FK members), `created_at`, `updated_at`, `announced_at TIMESTAMPTZ NULL`, `reminded_at TIMESTAMPTZ NULL`.

## 3. Luật điểm

- Điểm một lần khai = `(value × points + extraValue × extraPoints) × m − penaltyValue × penaltyPoints + bonusPoints`, với `m` = hệ số của ngày chơi (`played_on`) nếu có, không thì 1. Đọc hệ số HIỆN TẠI (tính lúc đọc, như `points`).
- Không nhân: điểm trừ (chỉ số phạt, kể cả mục trừ điểm do báo cáo), `bonusPoints` (+1 báo cáo), treo thưởng.
- Áp dụng mọi nơi dùng điểm mùa (bảng role, hoá thân, Đại sảnh, Top 3 mỗi phe, Tổng điểm theo phe, chốt mùa `role_titles`, role Discord top phe, danh hiệu tháng) — qua `aggregateSeason`; thêm tối đa một truy vấn khi mùa có ngày nhân.
- `ReportDto` thêm `multiplier: number` (1 khi không nhân); `points` đã gồm hệ số.

## 4. Quản trị (admin)

- Quản trị → Cài đặt → mục **"Ngày nhân điểm"**: danh sách các ngày từ hôm nay trở đi (gần nhất trước) và các ngày đã qua của mùa đang mở (mờ, khoá). Mỗi dòng: `{thứ}, {dd/mm}` · `×{m}` · lời nhắn · nút **Sửa**/**Xoá** (chỉ ngày ≥ hôm nay VN).
- Form: "Ngày" (date, ≥ hôm nay), "Hệ số" (chọn ×2/×3/×4/×5), "Lời nhắn" (tuỳ chọn, ≤ 100). Lỗi: "Ngày này đã có hệ số nhân" (trùng), "Chỉ đặt được cho hôm nay hoặc sau này", "Ngày đã qua không sửa/xoá được", "Hệ số phải từ ×2 đến ×5", "Lời nhắn tối đa 100 ký tự".
- API (`requireAdmin`): `GET /api/admin/multiplier-days`, `POST`, `PATCH /:id`, `DELETE /:id`.
- Công khai (`requireMember`): `GET /api/multiplier-days/upcoming` → các ngày `day ≥ hôm nay VN`, gần nhất trước: `{ id, day, multiplier, message }[]`.

## 5. Hiển thị (web)

- **Banner** dưới thanh điều hướng trên mọi trang (khi có ngày ≥ hôm nay): ngày gần nhất. Hôm nay → "🔥 Hôm nay điểm cộng ×{m}!"; ngày mai → "🔥 Ngày mai ({dd/mm}) điểm cộng ×{m}!"; xa hơn → "🔥 {Thứ}, {dd/mm}: điểm cộng ×{m}!"; kèm lời nhắn (nếu có) sau dấu " — ". Nút ✕ ("Ẩn thông báo") ẩn banner của đúng ngày đó trên máy này (localStorage, bọc try/catch). Nền vàng cam nổi bật, chữ đủ tương phản; 320px xuống dòng, không cuộn ngang; mờ vào theo bộ chuyển động.
- **Form khai/sửa:** ngày chơi là ngày nhân → dòng gợi ý "Ngày này điểm cộng ×{m}".
- **Chip `×{m}`** (vàng) cạnh điểm của lần khai có `multiplier > 1` trong "Lần khai của tôi", hàng chờ Duyệt điểm, "Đã duyệt gần đây".

## 6. Discord (#thông-báo)

- Tạo ngày nhân → bot đăng: "🔥 {Thứ} {dd/mm}: điểm cộng ×{m}!" + lời nhắn (dòng sau, nếu có); ghi `announced_at`. Sửa hệ số/lời nhắn của ngày đã đăng → đăng "✏️ Cập nhật {dd/mm}: điểm cộng ×{m}" (+ lời nhắn). Xoá ngày đã đăng → "❌ Huỷ ngày nhân điểm {dd/mm}". Lỗi Discord chỉ ghi log; đăng thất bại lúc tạo thì bộ hẹn giờ đăng bù (dựa `announced_at IS NULL` và `day ≥ hôm nay`).
- **9:00 VN đúng ngày**: bộ hẹn giờ đăng nhắc "🔥 Hôm nay điểm cộng ×{m}!" (+ lời nhắn) một lần, ghi `reminded_at` (idempotent, chạy dưới lease scheduler hiện có). Escape markdown, `allowedMentions: { parse: [] }`.

## 7. Kiểm thử và xong

- Điểm: công thức §3 (nhân phần cộng, không nhân phạt/bonus/treo thưởng), đổi hệ số đổi điểm, ngày không nhân giữ nguyên, Tổng phe/Top 3/chốt mùa dùng điểm đã nhân.
- Quản trị: CRUD, trùng ngày, ngày quá khứ bị chặn tạo/sửa/xoá, quyền admin (mod 403).
- Discord: đăng khi tạo/sửa/xoá, đăng bù, nhắc 9:00 một lần, không nhắc ngày khác.
- Web: banner (hôm nay/ngày mai/xa, lời nhắn, ẩn theo ngày, không có thì không vẽ), mục Cài đặt, gợi ý form, chip ×m, 320px.
- `npm run typecheck`, toàn bộ test, `npm run build` đạt.
