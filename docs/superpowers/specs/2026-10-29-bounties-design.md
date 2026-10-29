# GGD Hub — Treo thưởng

- Ngày: 2026-10-29
- Trạng thái: Đã duyệt thiết kế trong chat
- Nhánh: `feat/ggd-hub-v1`
- Lựa chọn của người dùng: điểm theo role của mục (mục không role chỉ vào Tổng "Cả 3 phe"); mod chọn phạm vi khi tạo (một buổi / mọi buổi); người chơi nhận qua Discord và web, mod duyệt trên web.

## 1. Mục tiêu

Mod/admin treo thưởng cho các mục tiêu trong buổi chơi (vd "Bồ Nông nuốt hết vịt +5", "Binh lính giết 3 vịt/phe thứ 3 +4", "Tham gia đủ từ game đầu tới game cuối +3"). Người chơi đã tham gia buổi báo "đã hoàn thành" trên web hoặc Discord; mod duyệt; điểm vào bảng xếp hạng.

## 2. Ngoài phạm vi

- Tự động kiểm tra hoàn thành; nhiều lần nhận một mục trong một buổi; treo thưởng có điều kiện thời gian trong buổi.

## 3. Dữ liệu

Migration mới:
- `bounties`: `id`, `title TEXT` (1–80 ký tự), `description TEXT NULL` (≤ 200), `points INT` (CHECK 1..50), `role_id INT NULL` (FK roles), `session_id INT NULL` (FK game_sessions; `NULL` = mọi buổi), `active BOOL DEFAULT true`, `created_by` (FK members), `created_at`, `updated_at`.
- `bounty_claims`: `id`, `bounty_id` (FK), `member_id` (FK), `session_id` (FK), `played_on DATE` (ngày VN của buổi), `role_id INT NULL` và `points INT` (chép từ mục lúc nhận — sửa mục sau đó không đổi lần nhận đã có), `status` (`pending`, `approved`, `rejected`, `revoked` — enum riêng `BountyClaimStatus`), `reject_reason`, `source` (`web`, `discord`), `created_at`, `reviewed_by`, `reviewed_at`, `revoked_by`, `revoked_at`. UNIQUE `(bounty_id, member_id, session_id)`. Index `(status, played_on)`, `(member_id, played_on)`.
- Không xoá mục đã có lần nhận (chỉ tắt).

## 4. Luật

- **Mục áp dụng cho buổi S** = mục `active` có `session_id = S` hoặc `session_id IS NULL`, sắp theo điểm giảm dần rồi id.
- **Nhận** (`claim`): người là thành viên đang hoạt động, có điểm danh `going` ở buổi S (buổi `scheduled`/`ended`, không `cancelled`), mục đang áp dụng cho S, ngày VN của buổi trong `[hôm nay − 3, hôm nay]`, mùa chưa chốt, chưa có lần nhận cùng (mục, người, buổi) → tạo `pending`. Lỗi: "Bạn chưa tham gia buổi này" / "Mục treo thưởng không áp dụng cho buổi này" / "Đã quá hạn nhận (3 ngày sau buổi chơi)" / "Mùa này đã chốt" / "Bạn đã nhận mục này ở buổi này rồi". Lần nhận bị từ chối thì không nhận lại được (UNIQUE).
- **Duyệt/Từ chối/Huỷ duyệt**: giống lần khai điểm — mod/admin; mod không tự duyệt/huỷ phần của mình (admin được); từ chối/huỷ cần lý do 1–200 ký tự; mùa chưa chốt (khoá dòng mùa `FOR UPDATE` như huỷ duyệt lần khai); khoá lạc quan theo trạng thái; DM người nhận khi từ chối hoặc huỷ.
- **Điểm**: lần nhận `approved` có `role_id` cộng `points` vào điểm mùa của (người, role) trong mùa của `played_on` — tham gia mọi bảng dùng điểm mùa (bảng role, hoá thân, Đại sảnh, Top 3 mỗi phe, Tổng điểm theo phe, chốt mùa `role_titles`) — **không** tăng `games`. Lần nhận không có `role_id` chỉ cộng vào Tổng điểm theo phe tab **"Cả 3 phe"**. Sau khi duyệt/huỷ một lần nhận có role: kiểm tra đổi người hoá thân như khi duyệt lần khai.
- **Chốt mùa**: lần nhận `pending` của mùa → `rejected` lý do "Mùa đã chốt" (cùng giao dịch với lần khai).

## 5. Quản trị (web, mod + admin)

- Quản trị → tab mới **"Treo thưởng"** (mod và admin thấy): danh sách mục (đang bật trước, rồi đã tắt), mỗi dòng: `{icon role} {tên}` hoặc "Mọi role", `+{điểm}`, phạm vi ("Mọi buổi" / "Buổi {giờ} {ngày} — {chế độ}"), số lần nhận đã duyệt, nút **Sửa**, **Tắt/Bật**.
- Form tạo/sửa: "Tên" (bắt buộc), "Mô tả" (tuỳ chọn), "Điểm" (1–50), "Role" (component `Select` có tìm, mục đầu "Không gắn role"), "Áp dụng cho" ("Mọi buổi" hoặc chọn một buổi chưa kết thúc/hôm nay từ danh sách). Xoá chỉ khi chưa có lần nhận (nút "Xoá"); có rồi → chỉ tắt.
- API: `GET /api/admin/bounties`, `POST /api/admin/bounties`, `PATCH /api/admin/bounties/:id`, `DELETE /api/admin/bounties/:id` (`requireMod`).
- Mọi thay đổi mục ảnh hưởng buổi chưa kết thúc → đánh dấu tin Discord của buổi đó cần sửa (§7).

## 6. Trang Hôm nay (web)

- Thẻ **"Treo thưởng"** cạnh thẻ buổi chơi: lưới 2 cột trên `lg` (thẻ buổi trái, treo thưởng phải), xếp dưới trên màn nhỏ; có nhiều buổi trong ngày → mỗi buổi một cặp, hoặc thẻ treo thưởng có tiêu đề theo buổi. Không có mục nào cho buổi → không vẽ thẻ (cột phải trống không còn).
- Mỗi mục: icon role (hoặc 🎯), tên, mô tả nhỏ, nhãn `+{điểm}` màu vàng. Người đã tham gia buổi: nút **"Tôi đã hoàn thành"** (`btn-secondary`); sau khi nhận: chip trạng thái "Chờ duyệt" / "Đã nhận +{điểm}" / "Bị từ chối: {lý do}" / "Đã bị huỷ: {lý do}". Chưa tham gia: chữ nhỏ "Tham gia buổi để nhận thưởng". Hết hạn: nút ẩn.
- API: `GET /api/sessions/:id/bounties` (`requireMember`) → mục áp dụng + lần nhận của người xem; `POST /api/sessions/:id/bounties/:bountyId/claim`.
- "Lần khai của tôi" có mục con **"Treo thưởng của tôi"** (lần nhận gần nhất, trạng thái). Trang thành viên công khai: không cần.

## 7. Discord — kênh `#treo-thưởng`

- Biến mới `DISCORD_BOUNTY_CHANNEL_ID` (tuỳ chọn; không đặt → phần Discord của treo thưởng tắt, web vẫn chạy). Công cụ `discord-setup` tạo kênh `#treo-thưởng` (cùng nhóm, thành viên xem được, không nhắn, bot đăng; quyền giống `#lịch-chơi`) và ghi ID vào `.env`, giữ ID đã có.
- Mỗi buổi chưa kết thúc có ít nhất một mục áp dụng → bot đăng **một tin** trong `#treo-thưởng`: tiêu đề "🎯 Treo thưởng — {chế độ} {giờ} {ngày}", danh sách mục (`{icon} **{tên}** +{điểm}` + mô tả), và menu chọn nhiều **"Tôi đã hoàn thành…"** (tối đa 25 mục; custom id theo buổi). Mục thay đổi / buổi đổi giờ / huỷ → sửa tin (buổi huỷ: tin ghi "Buổi đã huỷ", bỏ menu). Lưu `bounty_channel_id`/`bounty_message_id` trên `game_sessions` + cờ `bounty_dirty`; bộ hẹn giờ hiện có xử lý cờ (giống `discordDirty`).
- Chọn trong menu → áp dụng luật nhận §4 cho từng mục chọn; trả lời riêng (ephemeral) từng mục: "Đã gửi, chờ mod duyệt" hoặc lỗi. Người chưa có tài khoản app → tạo như các nút khác.
- Duyệt một lần nhận → bot đăng vào `#treo-thưởng`: "✅ {tên} hoàn thành **{mục}** +{điểm}" (lỗi Discord chỉ ghi log). Từ chối/huỷ → chỉ DM.

## 8. Duyệt (web)

- Quản trị → Duyệt điểm: mục mới **"Treo thưởng chờ duyệt ({n})"** dưới hàng chờ lần khai: mỗi dòng người nhận, `{icon} {mục}` `+{điểm}`, buổi + ngày, nguồn (web/Discord), nút **Duyệt** / **Từ chối** (lý do). "Đã duyệt gần đây" gồm cả lần nhận treo thưởng (nhãn "Treo thưởng"), có **Huỷ duyệt**.
- API: `GET /api/admin/bounty-claims?status=pending|approved`, `POST /api/admin/bounty-claims/:id/review`, `POST /api/admin/bounty-claims/:id/revoke`.
- Duyệt/huỷ thành công → làm mới cache bảng xếp hạng/Đại sảnh/tổng điểm như huỷ duyệt lần khai.

## 9. Kiểm thử và xong

- Luật nhận (mọi lỗi §4), trùng, hạn 3 ngày, mùa chốt; duyệt/từ chối/huỷ (quyền, tự duyệt, lý do, khoá mùa, DM, thông báo kênh); điểm: có role vào bảng role/hoá thân/Top 3/Tổng phe/chốt mùa, không role chỉ vào "Cả 3 phe", không đổi `games`; sửa điểm mục không đổi lần nhận cũ; chốt mùa từ chối pending.
- Quản trị CRUD + không xoá khi đã có lần nhận; Discord: setup tạo kênh, tin buổi + sửa khi đổi + huỷ, menu nhận, trả lời ephemeral, thông báo duyệt, tắt khi không có kênh.
- Web: tab Treo thưởng, thẻ Hôm nay (2 cột/xếp dưới, trạng thái, chưa tham gia, hết hạn), Duyệt điểm, "Treo thưởng của tôi"; 320px.
- `npm run typecheck`, toàn bộ test, `npm run build` đạt. README: mục treo thưởng + biến `DISCORD_BOUNTY_CHANNEL_ID` + nhắc chạy `discord-setup.sh` sau khi cập nhật.
