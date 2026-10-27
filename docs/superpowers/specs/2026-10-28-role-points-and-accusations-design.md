# GGD Hub — Điểm cộng/trừ theo role và Báo cáo người chơi

- Ngày: 2026-10-28
- Trạng thái: Đã duyệt thiết kế trong chat
- Nhánh: `feat/ggd-hub-v1`
- Liên quan: spec chỉ số phụ `2026-10-27-extra-metric-design.md`; spec huỷ duyệt `2026-10-27-revoke-approval-design.md`; spec gốc §4.6–4.7. Người dùng chọn: chỉ số phạt riêng; bỏ luật ×5; báo cáo đúng thì cộng người báo cáo VÀ tự trừ người bị báo cáo; bảng điểm khởi đầu theo đề xuất; báo cáo trùng chỉ hiện báo cáo sớm nhất.

## 1. Mục tiêu

1. Admin đặt **điểm cộng** cho chỉ số chính và **điểm trừ** (chỉ số phạt) cho từng role; tìm role nhanh trong Quản trị → Role.
2. Role bắn của phe Ngỗng nhận điểm cao hơn, bắn sai bị trừ.
3. Người khai điểm có thể **báo cáo người chơi** chơi sai (vd Dân phòng bắn Ngỗng); báo cáo đúng → người báo cáo +1, người bị báo cáo bị trừ điểm phạt của role đó.

## 2. Ngoài phạm vi

- Báo cáo qua bot Discord (chỉ web). Nhiều báo cáo trong một lần khai.
- Tính lại `role_titles.score` của mùa đã chốt; thu hồi huy hiệu.
- Thông báo Discord khi người hoá thân đổi do migration đổi điểm.

## 3. Luật điểm

- Role có: `points` (điểm mỗi đơn vị chỉ số chính, 1–100, mặc định 1); chỉ số phụ như cũ (`extraMetricLabel`, `extraMaxPerGame`, `extraPoints`); **chỉ số phạt** mới (`penaltyMetricLabel` 1–60 ký tự, `penaltyMaxPerGame` 1–100, `penaltyPoints` 1–100 — số dương, được TRỪ) — ba trường cùng có hoặc cùng null.
- **Điểm một lần khai** = `value × points + extraValue × extraPoints − penaltyValue × penaltyPoints + bonusPoints` (đọc điểm HIỆN TẠI của role; `bonusPoints` là +1 khi báo cáo kèm theo được duyệt đúng, xem §6). Có thể âm.
- **Điểm mùa** của (người, role) = tổng điểm các lần khai đã duyệt trong mùa; có thể âm. Mọi bảng xếp hạng (bảng role, người hoá thân, Đại sảnh, Top 3 mỗi phe, Tổng điểm theo phe, chốt mùa) dùng con số này và **chỉ xếp người có điểm > 0** (như cũ).
- **Bỏ luật ×5** (`rolePointWeight`): Top 3 mỗi phe và Tổng điểm theo phe dùng thẳng điểm mùa. Xoá hàm và mọi chỗ dùng; DTO `FactionTopRowDto.weight` bỏ (web cập nhật).
- **Số trận** (`games` trên bảng role) chỉ đếm lần khai do chính người chơi khai (`source = 'self'`), không đếm mục trừ điểm do báo cáo.
- Giới hạn khai: `0 ≤ value ≤ maxPerGame`, `0 ≤ extraValue ≤ extraMaxPerGame` (0 nếu không có), `0 ≤ penaltyValue ≤ penaltyMaxPerGame` (0 nếu không có; khác 0 → `VALIDATION` "Role này không có chỉ số phạt"; vượt → `VALUE_OUT_OF_RANGE` "Chỉ số phạt phải từ 0 đến N").

## 4. Dữ liệu

Migration mới:

- `roles`: `points INT NOT NULL DEFAULT 1` (CHECK 1..100), `penalty_metric_label TEXT NULL`, `penalty_max_per_game INT NULL`, `penalty_points INT NULL` (CHECK cùng null/cùng có; `penalty_points` 1..100).
- `stat_reports`: `penalty_value INT NOT NULL DEFAULT 0` (CHECK ≥ 0), `bonus_points INT NOT NULL DEFAULT 0` (CHECK 0..1), `source` enum `ReportSource` (`self`, `accusation`) NOT NULL DEFAULT `self`.
- Bảng `player_accusations`: `id`, `report_id` (lần khai của người báo cáo, UNIQUE, FK), `reporter_id`, `accused_id` (FK members), `accused_role_id` (FK roles), `victim_id` (FK members), `victim_faction` (`Faction`), `played_on DATE` (= ngày chơi của lần khai), `status` enum `AccusationStatus` (`pending`, `approved`, `rejected`, `superseded`), `reject_reason TEXT NULL`, `penalty_report_id` (FK stat_reports, UNIQUE, NULL), `created_at`, `reviewed_by`, `reviewed_at`. Index `(accused_id, accused_role_id, victim_id, played_on, status)`. CHECK `accused_id <> reporter_id`, `victim_id <> accused_id`.
- Dữ liệu điểm khởi đầu (theo `key`):
  - `vigilante` (Dân phòng): `points = 5`, phạt "Số phát bắn sai", tối đa 1, −3.
  - `lobbyist`, `soldier`, `sheriff`, `avenger`: `points = 3`, phạt "Số phát bắn sai", tối đa = `max_per_game` của role, −1.
  - Mọi role khác có `max_per_game = 1`: `points = 5` (thay luật ×5).
  - Còn lại `points = 1`.
- Seed (`src/server/seed/roles.ts`) mang cùng giá trị cho DB mới; seed vẫn không ghi đè role đã có.

## 5. Quản trị role và khai điểm

- Role tạo/sửa nhận `points`, `penaltyMetricLabel`, `penaltyMaxPerGame`, `penaltyPoints` (gửi đủ ba hoặc null cả ba). Không cho tắt chỉ số phạt khi role đã có lần khai `penalty_value > 0` hoặc báo cáo trỏ tới role → `VALIDATION` "Role đã có lần khai dùng chỉ số phạt, không tắt được".
- Web Quản trị → Role: ô **"Điểm mỗi lần"** cho chỉ số chính; ô tick **"Có điểm trừ"** → ba ô "Tên chỉ số phạt", "Tối đa mỗi trận", "Điểm trừ mỗi lần"; thanh **"Tìm role…"** trên đầu danh sách (lọc theo tên Việt/Anh, không dấu, không hoa thường; không thấy → "Không có role nào khớp").
- `RoleDto` / `ReportDto.role` thêm `points`, `penaltyMetricLabel`, `penaltyMaxPerGame`, `penaltyPoints`. `ReportDto` thêm `penaltyValue`, `bonusPoints`, `source`, và `accusation` (§6, của chính người khai) hoặc `null`; `points` theo §3.
- `POST/PATCH /api/reports` nhận `penaltyValue` (mặc định 0); khoá lạc quan khi duyệt gồm `penaltyValue`. Form khai/sửa: role có chỉ số phạt → ô thứ ba nhãn = `penaltyMetricLabel`, gợi ý "Tối đa {max} mỗi trận · −{penaltyPoints} điểm mỗi lần". Ô chỉ số chính gợi ý "+{points} điểm mỗi lần" khi `points ≠ 1`.
- Bot `/baocao`: tuỳ chọn `so_lieu_phat` (0–100, không bắt buộc) sau `so_lieu_phu`.
- **Hiển thị một lần khai** (`formatReportValue`): `{value} {nhãn chính}` + ` + {extra} {nhãn phụ}` (nếu có chỉ số phụ) + ` − {penalty} {nhãn phạt}` (khi `penaltyValue > 0`); mục do báo cáo: `Bị báo cáo: bắn {tên} ({phe}) − {penaltyPoints} điểm`.
- **Hiển thị điểm mùa** (`seasonScoreUnit`): role có `points ≠ 1` hoặc có chỉ số phụ hoặc chỉ số phạt → `{điểm} điểm`; còn lại như cũ `{điểm} {nhãn}`.

## 6. Báo cáo người chơi

**Gửi** (chỉ web, kèm một lần khai mới hoặc khi sửa lần khai còn chờ duyệt; tối đa một báo cáo mỗi lần khai):
- Form khai: ô tick **"Báo cáo người chơi"** (tuỳ chọn) → bốn ô chọn (component `Select` có ô tìm):
  1. **"Người bị báo cáo"** — thành viên đang hoạt động, trừ chính mình.
  2. **"Role của họ"** — chỉ role đang bật có chỉ số phạt, nhóm theo phe.
  3. **"Họ bắn trúng ai"** — thành viên đang hoạt động, trừ người bị báo cáo.
  4. **"Phe của người bị bắn"** — Ngỗng / Vịt / Phe thứ 3.
  Gợi ý dưới khung: "Báo cáo đúng: bạn +1 điểm, người bị báo cáo bị trừ điểm phạt của role đó."
- Kiểm tra server: bốn trường bắt buộc khi có báo cáo; người tồn tại và đang hoạt động; role có chỉ số phạt; không tự báo cáo; người bị bắn khác người bị báo cáo → `VALIDATION` với lời nhắn cụ thể.
- API: `POST/PATCH /api/reports` nhận `accusation: { accusedId, accusedRoleId, victimId, victimFaction } | null` (PATCH `null` = bỏ báo cáo). Danh sách chọn người: `GET /api/members/options` (`requireMember`) → `{ id, displayName, avatarUrl }[]` của thành viên đang hoạt động, theo tên.

**Trùng:** hai báo cáo cùng **người bị báo cáo + role + người bị bắn + ngày chơi** là cùng một vụ. Hàng chờ chỉ gắn báo cáo `pending` **sớm nhất** (theo `created_at`, rồi `id`) của mỗi vụ vào lần khai của nó; báo cáo trùng sau ẩn (lần khai của họ vẫn hiện, không kèm khung báo cáo, ghi chú nhỏ "Báo cáo của bạn trùng với một báo cáo khác đang chờ").

**Duyệt** (tab Duyệt điểm, dòng có khung "Báo cáo: {người} ({role}) bắn {người bị bắn} — phe {phe}"):
- **"Duyệt"** → duyệt lần khai VÀ báo cáo đúng. **"Duyệt, bỏ báo cáo"** (cần lý do) → duyệt lần khai, báo cáo `rejected`. **"Từ chối"** → lần khai bị từ chối, báo cáo `rejected` cùng lý do.
- `POST /api/admin/reports/:id/review` nhận thêm `accusation: 'approve' | 'reject'` (bắt buộc khi lần khai có báo cáo đang được hiện; thiếu → `VALIDATION`).
- **Báo cáo đúng** (cùng giao dịch với việc duyệt): báo cáo `approved`; lần khai người báo cáo `bonus_points = 1`; tạo lần khai trừ điểm cho người bị báo cáo: `source = 'accusation'`, role bị báo cáo, ngày chơi đó, `value = 0`, `penalty_value = 1`, `status = 'approved'`, `reviewed_by` = mod, ghi chú `Bị báo cáo: bắn {tên} (phe {phe})`; `penalty_report_id` trỏ tới nó; mọi báo cáo trùng còn `pending` của vụ → `superseded` (lý do "Đã có người báo cáo trước"). Sau khi lưu: DM người bị báo cáo `Bạn bị trừ {penaltyPoints} điểm ({role}) ngày {dd/mm}: bị báo cáo bắn {tên} (phe {phe}).`; kiểm tra người hoá thân của role bị trừ như khi duyệt.
- **Báo cáo bị bác** → báo cáo trùng `pending` kế tiếp của vụ hiện lên ở lần khai của nó.
- Luật duyệt cũ giữ nguyên (mod không tự duyệt; mùa đã chốt; khoá lạc quan). Mod không duyệt được báo cáo mà mình là người bị báo cáo (`SELF_REVIEW`); admin được.
- Lần khai `source = 'accusation'` không nằm trong hàng chờ, không sửa được bởi người bị báo cáo, hiện trong "Lần khai của tôi" của họ với chip "Bị trừ điểm".

**Huỷ duyệt:** huỷ lần khai của người báo cáo mà báo cáo đã `approved` → lần khai trừ điểm kia cũng `revoked` cùng lý do (cùng giao dịch, cùng khoá mùa), `bonus_points` giữ trên dòng đã huỷ (không còn tính vì dòng không `approved`); DM người bị báo cáo "Mục trừ điểm … đã được gỡ". Lần khai `source = 'accusation'` cũng xuất hiện ở "Đã duyệt gần đây" và huỷ được riêng (DM người bị trừ; báo cáo gốc giữ `approved`, `bonus_points` người báo cáo giữ nguyên).

**Chốt mùa:** báo cáo `pending` của lần khai bị tự từ chối khi chốt mùa → `rejected` cùng lý do chốt mùa.

## 7. Kiểm thử và tiêu chí xong

- Điểm: công thức §3 (chính × points, phụ, phạt trừ, bonus); điểm âm không lên bảng; bỏ ×5 (Top 3, Tổng phe dùng điểm mùa); `games` không đếm mục báo cáo; migration đặt đúng điểm khởi đầu và không đổi `role_titles`.
- Quản trị role: tạo/sửa/tắt chỉ số phạt, chặn tắt khi đã dùng, `points` ngoài 1..100 bị chặn; tìm role không dấu.
- Khai điểm: `penaltyValue` giới hạn và lỗi; form ô thứ ba; `/baocao so_lieu_phat`; hiển thị "x + y − z".
- Báo cáo: gửi/sửa/bỏ; kiểm tra bốn trường; trùng → chỉ báo cáo sớm nhất hiện, duyệt đúng → trùng `superseded`, bác → báo cáo kế tiếp hiện; ba nút duyệt; +1 và mục trừ đúng, DM; huỷ duyệt dây chuyền; chốt mùa; mod bị báo cáo không tự duyệt.
- Web: ô tick hiện bốn ô chọn (component `Select`), Duyệt điểm hiện khung báo cáo và ba nút, chip "Bị trừ điểm", 320px không cuộn ngang.
- `npm run typecheck`, toàn bộ test, `npm run build` đạt.
