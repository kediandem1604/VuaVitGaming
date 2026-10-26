# GGD Hub — Chỉ số phụ cho role (Ám sát: giết ×1, ám sát trong họp ×3)

- Ngày: 2026-10-27
- Trạng thái: Chờ duyệt
- Nhánh: `feat/ggd-hub-v1`
- Liên quan: spec gốc `2026-10-22-ggd-hub-design.md` §4.6–4.7 (khai điểm, mùa, hoá thân); spec huy hiệu `2026-10-26-badges-design.md` (top phe dùng điểm mùa). Thiết kế đã duyệt trong chat; người dùng chọn "làm chung cho mọi role" và "chuyển số cũ của Ám sát sang ám sát họp".

## 1. Mục tiêu

Một role có thể có thêm **chỉ số phụ** được nhân điểm. Ám sát dùng nó: mỗi mạng giết thường **+1 điểm**, mỗi lần ám sát thành công trong cuộc họp (tối đa 2 mỗi ván) **+3 điểm**.

## 2. Ngoài phạm vi

- Nhiều hơn một chỉ số phụ; hệ số cho chỉ số chính khác 1.
- Tính lại `role_titles.score` của mùa đã chốt (điểm đã chốt giữ nguyên).
- Đổi luật ×5 của "Top 3 mỗi phe".

## 3. Luật điểm

- Role có chỉ số phụ khi đủ ba trường `extraMetricLabel`, `extraMaxPerGame`, `extraPoints`; thiếu → không có chỉ số phụ.
- **Điểm một lần khai** = `value` + `extraValue × extraPoints` (đọc `extraPoints` **hiện tại** của role). Role không có chỉ số phụ: điểm = `value` (như cũ).
- **Điểm mùa** của (người, role) = tổng điểm các lần khai đã duyệt trong mùa (như cũ, chỉ thay "tổng value" bằng "tổng điểm"). Mọi chỗ dùng điểm mùa đi theo: bảng xếp hạng, người hoá thân, Đại sảnh, Hồ sơ "role đang giữ", chốt mùa (`role_titles.score`), "Top 3 mỗi phe" (vẫn ×5 khi `maxPerGame === 1`, áp lên điểm mùa), danh hiệu top phe.
- Giới hạn: `0 ≤ value ≤ maxPerGame`; `0 ≤ extraValue ≤ extraMaxPerGame`; role không có chỉ số phụ thì `extraValue` phải là 0 (khác 0 → lỗi `VALIDATION` "Role này không có chỉ số phụ").

## 4. Dữ liệu

Migration mới:

- `roles`: `extra_metric_label TEXT NULL`, `extra_max_per_game INT NULL`, `extra_points INT NULL` (Prisma `extraMetricLabel`, `extraMaxPerGame`, `extraPoints`); CHECK cả ba cùng null hoặc cùng có.
- `stat_reports`: `extra_value INT NOT NULL DEFAULT 0`.
- Dữ liệu Ám sát (`key = 'assassin'`):
  - `metric_label = 'Số mạng đã giết'`, `max_per_game = 15`, `extra_metric_label = 'Số lần ám sát trong cuộc họp'`, `extra_max_per_game = 2`, `extra_points = 3`.
  - Mọi lần khai của role này (mọi trạng thái): `extra_value = value`, `value = 0`.
- Seed (`src/server/seed/roles.ts`) có các giá trị mới cho Ám sát (DB mới); seed vẫn không ghi đè role đã có.

## 5. Quản trị role

- Tạo/sửa role nhận thêm `extraMetricLabel` (1–60 ký tự), `extraMaxPerGame` (1–100), `extraPoints` (1–100) — gửi đủ cả ba hoặc `null` cả ba; thiếu một → `VALIDATION`.
- **Không cho tắt** chỉ số phụ (đặt về `null`) khi role đã có lần khai `extra_value > 0` → `VALIDATION` "Role đã có lần khai dùng chỉ số phụ, không tắt được". Đổi tên/tối đa/điểm vẫn được (điểm đổi thì điểm mùa chưa chốt tính lại theo giá trị mới).
- Web (Quản trị → Role, tạo và sửa): ô tick **"Có chỉ số phụ"**; tick thì hiện ba ô "Tên chỉ số phụ", "Tối đa mỗi trận", "Điểm mỗi lần".
- `RoleDto` thêm `extraMetricLabel: string | null`, `extraMaxPerGame: number | null`, `extraPoints: number | null`.

## 6. Khai điểm

- `POST /api/reports` / `PATCH /api/reports/:id` nhận thêm `extraValue` (số nguyên, không bắt buộc, mặc định 0). Duyệt lần khai khoá lạc quan cả `extraValue` (như `value`).
- `ReportDto` thêm `extraValue: number`, `points: number` (điểm lần khai theo §3); `ReportDto.role` thêm `maxPerGame`, `extraMetricLabel`, `extraMaxPerGame`, `extraPoints`.
- Web form khai (và form sửa lần khai): role có chỉ số phụ → ô thứ hai, nhãn = `extraMetricLabel`, gợi ý "Tối đa {extraMaxPerGame} mỗi trận · +{extraPoints} điểm mỗi lần", mặc định 0, kiểm tra giới hạn trước khi gửi. Form sửa cũng giới hạn `value` theo `maxPerGame` (nay có trong DTO).
- Discord `/baocao`: tuỳ chọn mới `so_lieu_phu` (số nguyên, không bắt buộc, 0–100), đặt sau `so_lieu`.

## 7. Hiển thị

- **Một lần khai** (danh sách "Lần khai của tôi", Duyệt điểm, tin xác nhận `/baocao`, tin nhắn bị từ chối, chú thích highlight): role có chỉ số phụ → `{value} {nhãn chính} + {extraValue} {nhãn phụ}` (bỏ "Số" như `formatMetricValue`), vd "4 mạng đã giết + 2 lần ám sát trong cuộc họp"; role không có → như cũ. Một hàm dùng chung `formatReportValue(...)` trong `src/shared/metric.ts`.
- **Điểm mùa** (Đại sảnh/RoleCard, bục, bảng xếp hạng, Top 3 mỗi phe, Hồ sơ, `/bxh`, tổng kết mùa): role có chỉ số phụ → `{điểm} điểm`; role không có → như cũ (`{điểm} {nhãn}`). Dòng "Chỉ số: …" trên bảng xếp hạng của role có chỉ số phụ: "Chỉ số: {nhãn chính} (+1 điểm) · {nhãn phụ} (+{extraPoints} điểm)".
- Autocomplete role `/baocao`: `icon tên — nhãn chính (+ nhãn phụ)` nếu có, cắt 100 ký tự như cũ.

## 8. Kiểm thử và tiêu chí xong

- Điểm: lần khai Ám sát 4 + 2 → 10 điểm; tổng mùa cộng nhiều lần khai; đổi `extraPoints` đổi điểm mùa chưa chốt; role thường không đổi.
- Giới hạn: `extraValue` vượt tối đa → `VALUE_OUT_OF_RANGE`; role không có chỉ số phụ mà `extraValue > 0` → lỗi; PATCH giữ `extraValue` cũ khi không gửi.
- Migration: dữ liệu Ám sát chuyển đúng (value → extra_value, value = 0, role cập nhật); role khác không đổi; CHECK ba trường.
- Quản trị role: bật/sửa/tắt; tắt bị chặn khi đã có `extra_value > 0`; thiếu một trường → lỗi.
- Top 3 mỗi phe, người hoá thân, chốt mùa dùng điểm mới.
- Web: ô phụ hiện/ẩn theo role; giới hạn; hiển thị "x + y" và "N điểm"; quản trị role.
- Bot: `/baocao` với `so_lieu_phu`; tin xác nhận; `/bxh` hiện "N điểm" cho role có chỉ số phụ.
- `npm run typecheck`, toàn bộ test, `npm run build` đạt.
