# GGD Hub — Tính điểm theo ván

- Ngày: 2026-11-01
- Trạng thái: Đã duyệt thiết kế trong chat
- Nhánh: `feat/ggd-hub-v1`
- Lựa chọn: admin/mod chọn phe thắng (phe thứ 3 tick người thắng); thua vẫn bị trừ điểm phạt; khai theo ván cần mod duyệt; áp dụng từ mùa 2026-11, bỏ form khai theo ngày cho mùa mới.

## 1. Mục tiêu

Mỗi buổi chơi có các **ván** (ảnh kết quả do mod/admin up, kèm phe thắng). Người chơi khai role và chỉ số dưới từng ván. Chỉ phe thắng được điểm cộng (+1 thắng + điểm chỉ số); điểm trừ vẫn tính.

## 2. Dữ liệu

- Bảng `game_rounds`: `id`, `session_id` (FK, RESTRICT), `number INT` (1..; UNIQUE `(session_id, number)`), `image BYTEA`, `image_mime TEXT`, `image_updated_at TIMESTAMPTZ`, `winner_faction` (`Faction` NULL — chưa chọn), `created_by`, `created_at`, `updated_at`.
- Bảng `game_round_winners`: `(round_id, member_id)` PK — chỉ dùng khi `winner_faction = neutral`.
- `stat_reports.round_id INT NULL` (FK `game_rounds`, RESTRICT). UNIQUE một phần `(round_id, member_id) WHERE round_id IS NOT NULL AND source = 'self' AND status IN ('pending','approved')` (mỗi người một lần khai còn hiệu lực mỗi ván).
- Mùa có luật mới: hằng `ROUND_SCORING_FROM = '2026-11'` (mùa ≥ giá trị này dùng luật ván).

## 3. Luật điểm (lần khai có `round_id`)

- Gọi `won` = (role của lần khai thuộc `winner_faction` của ván) và (nếu `winner_faction = neutral` thì người khai có trong `game_round_winners`). Ván chưa có phe thắng → `won = false`.
- Điểm = `won ? (1 + (value×points + extra×extraPoints) × m) : 0` `− penalty×penaltyPoints + bonusPoints` (m = hệ số ngày nhân của `played_on`).
- Lần khai không có `round_id` (mùa ≤ 2026-10) giữ công thức cũ. Mục trừ điểm do báo cáo, treo thưởng, +1 báo cáo độc lập: không đổi.
- Mọi bảng dùng điểm mùa (bảng role, hoá thân, Đại sảnh, Top 3, Tổng điểm phe, chốt mùa, role Discord top phe, danh hiệu tháng) dùng công thức này; `games` = số lần khai `source='self'` như cũ (tức số ván đã khai). Đổi phe thắng/người thắng → điểm tính lại lúc đọc; kiểm tra đổi người hoá thân của các role liên quan và đăng như hiện nay.
- `ReportDto` thêm `round: { id, number, sessionId, winnerFaction, won: boolean } | null`; `points` theo công thức trên.

## 4. Quản lý ván (mod + admin)

- API (`requireMod`): `POST /api/admin/sessions/:id/rounds` (multipart: ảnh + `winnerFaction` tuỳ chọn) → ván số tiếp theo; `PATCH /api/admin/rounds/:id` (`winnerFaction` nullable, `winnerIds` khi neutral); `PUT /api/admin/rounds/:id/image` (đổi ảnh); `DELETE /api/admin/rounds/:id` (chỉ khi chưa có lần khai pending/approved; xoá ván cuối → số không bị lấp; xoá ván giữa → giữ số, không đánh lại). Ảnh: PNG/JPG/WebP nhận diện theo nội dung, ≤ 5 MB (lỗi "Ảnh tối đa 5 MB", "Chỉ nhận ảnh PNG, JPG hoặc WebP"); buổi bị huỷ → không thêm ván.
- `winnerIds` phải là người đã khai role phe thứ 3 ở ván đó (pending/approved); đặt phe thắng khác neutral → xoá danh sách người thắng.
- Ảnh phục vụ: `GET /api/rounds/:id/image` (`requireMember`, `Cache-Control: private, max-age=300`, ETag theo `image_updated_at`).
- Web: Quản trị → Buổi chơi: mỗi buổi có nút **"Ván đấu ({n})"** mở trang buổi ở chế độ quản lý; trang buổi `/buoi/:id` (mọi thành viên) với mod/admin có **"+ Thêm ván"** (chọn ảnh, phe thắng), mỗi ván: đổi ảnh, chọn phe thắng (`Select`: "Chưa chọn" / Ngỗng / Vịt / Phe thứ 3), khi Phe thứ 3 → danh sách tick người thắng (người đã khai role phe thứ 3 ván đó), Xoá ván.

## 5. Khai theo ván (người chơi)

- Trang **buổi** `/buoi/:id`: tiêu đề buổi; lưới ảnh ván (Ván 1, 2, …; ảnh bấm phóng to trong Modal); dưới mỗi ảnh: chip phe thắng ("🦢 Ngỗng thắng" / "🦆 Vịt thắng" / "Phe thứ 3 thắng" / "Chưa chọn phe thắng"), danh sách lần khai của ván (avatar, tên, `{icon} {role}`, trạng thái nhỏ cho chính mình; công khai cho mọi thành viên), nút **"Khai role ván này"** (chưa khai và còn hạn) mở form: role (`Select` có tìm, nhóm theo phe), chỉ số chính/phụ/phạt như form hiện tại, ghi chú; nút "Gửi". Đã khai → "Sửa" khi còn chờ duyệt.
- Luật khai: thành viên đang hoạt động; buổi không huỷ; ngày VN của buổi trong `[hôm nay − 3, hôm nay]`; mùa chưa chốt; mùa ≥ `ROUND_SCORING_FROM`; một lần khai còn hiệu lực mỗi (ván, người); giới hạn chỉ số như hiện tại; `played_on` = ngày VN của buổi; `session_id` = buổi của ván. Lỗi mới: "Bạn đã khai ván này rồi", "Ván này không còn nhận khai".
- API: `GET /api/sessions/:id/rounds` (`requireMember`) → ván + lần khai công khai của mỗi ván (`member`, `role`, `status` chỉ pending/approved; của chính mình thêm chỉ số/ghi chú); `POST /api/rounds/:id/reports` (giống body khai điểm, không có `playedOn`/`sessionId`); sửa/xoá dùng route lần khai hiện có (`PATCH /api/reports/:id` không cho đổi `roundId`).
- **Trang Khai điểm** (tab "Khai điểm"): từ mùa mới thay form theo ngày bằng danh sách **buổi trong 3 ngày gần đây có ván** (mới nhất trước, chọn sẵn buổi mặc định theo mốc 6:00) → mỗi buổi: các ván (thumbnail nhỏ, phe thắng, "Đã khai: {role}" hoặc nút "Khai") — bấm mở form như §5 trên trang này hoặc dẫn sang `/buoi/:id#van-{n}`. Buổi chưa có ván → "Buổi này chưa có ảnh ván, chờ mod up". "Lần khai của tôi" giữ nguyên, mỗi lần khai theo ván ghi "Buổi {giờ} {dd/mm} · Ván {n}" và chip thắng/thua.
- `POST /api/reports` (khai theo ngày) với ngày thuộc mùa ≥ `ROUND_SCORING_FROM` → 400 `VALIDATION` "Từ tháng 11 khai điểm theo ván — chọn buổi và ván để khai".
- Discord `/baocao`: thêm tuỳ chọn bắt buộc `van` (số ván, 1–50); buổi = buổi mặc định theo mốc 6:00 (có `ngay` thì buổi đầu tiên của ngày đó đã bắt đầu, theo `pickDefaultSession`); không tìm thấy ván → "Không tìm thấy ván {n} của buổi {giờ} {dd/mm}". Mùa cũ: `/baocao` không có `van` vẫn khai theo ngày như trước cho ngày thuộc mùa ≤ 2026-10 (trong cửa sổ 3 ngày).
- **Duyệt điểm**: dòng lần khai theo ván có thumbnail ảnh ván (bấm phóng to), "Ván {n} · {phe thắng}" — mod đối chiếu; Duyệt/Từ chối/Huỷ duyệt như hiện nay.

## 6. Kiểm thử và xong

- Điểm: thắng/thua/chưa chọn, phe thứ 3 tick người, điểm trừ khi thua, ngày nhân, đổi phe thắng tính lại + thông báo hoá thân, mùa cũ không đổi, `games` đếm ván.
- Quản lý ván: thêm (số tiếp theo, ảnh sai loại/quá lớn, buổi huỷ), sửa phe thắng/người thắng (ràng buộc người đã khai phe thứ 3), đổi ảnh, xoá (chặn khi có lần khai), quyền mod/admin; phục vụ ảnh.
- Khai: luật §5, trùng (cả song song), sửa không đổi ván, `POST /api/reports` theo ngày mùa mới bị chặn, `/baocao van`.
- Web: trang buổi (ảnh, phóng to, chip, danh sách khai, form, sửa), quản lý ván cho mod/admin, trang Khai điểm mới, Duyệt điểm có ảnh, 320px.
- `npm run typecheck`, toàn bộ test, `npm run build` đạt. README cập nhật luật điểm mới.
