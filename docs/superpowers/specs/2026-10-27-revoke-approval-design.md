# GGD Hub — Huỷ duyệt lần khai điểm (mod/admin)

- Ngày: 2026-10-27
- Trạng thái: Chờ duyệt
- Nhánh: `feat/ggd-hub-v1`
- Liên quan: spec gốc `2026-10-22-ggd-hub-design.md` §4.6–4.7 (khai điểm, duyệt, mùa, hoá thân); spec huy hiệu `2026-10-26-badges-design.md` (huy hiệu không bao giờ mất); spec chỉ số phụ `2026-10-27-extra-metric-design.md` (`formatReportValue`). Thiết kế đã duyệt trong chat.

## 1. Mục tiêu

Mod/admin **huỷ được một lần khai đã duyệt** (duyệt nhầm, khai gian bị phát hiện sau), kèm lý do. Điểm mùa, người hoá thân, Đại sảnh và Top 3 mỗi phe cập nhật theo; người khai được báo qua DM.

## 2. Ngoài phạm vi

- Huỷ lần khai thuộc mùa đã chốt (danh hiệu tháng, `role_titles` đã lưu).
- Thu hồi huy hiệu đã trao (vd "Đạo diễn") — huy hiệu không bao giờ mất.
- Xoá tin highlight trong `#highlight` (mod tự xoá trong Discord nếu cần).
- Lệnh huỷ duyệt trên bot; khôi phục lần khai đã huỷ; đưa lần khai về `pending`.
- Đăng thông báo "mất hoá thân" lên Discord.

## 3. Trạng thái và luật

- `ReportStatus` thêm giá trị **`revoked`** (Bị huỷ duyệt). Chuyển hợp lệ duy nhất mới: `approved → revoked`. `revoked` là trạng thái cuối (không sửa, không duyệt lại).
- Mọi chỗ đang đọc `status = 'approved'` (điểm mùa, bảng xếp hạng, hoá thân, Đại sảnh, Top 3 mỗi phe, chốt mùa, danh hiệu tháng, cột mốc) tự động bỏ lần khai đã huỷ — không cần sửa truy vấn.
- Ai huỷ: mod hoặc admin (`FORBIDDEN` cho người khác). **Mod không huỷ lần khai của chính mình** (`SELF_REVIEW`, lời nhắn "Mod không được huỷ duyệt lần khai của mình"); admin thì được — cùng luật với duyệt.
- Lý do bắt buộc sau khi cắt khoảng trắng (`REASON_REQUIRED`, lời nhắn "Cần ghi lý do huỷ duyệt"), tối đa 200 ký tự (`VALIDATION` "Lý do huỷ duyệt tối đa 200 ký tự").
- Mùa của ngày chơi đã chốt → `SEASON_CLOSED`.
- Lần khai không có → `NOT_FOUND`; không còn `approved` (đã bị huỷ, hoặc chưa từng duyệt) → mã mới **`NOT_APPROVED`** (409, "Lần khai không còn ở trạng thái đã duyệt").

## 4. Dữ liệu

Migration mới:

- `ALTER TYPE "ReportStatus" ADD VALUE 'revoked'`.
- `stat_reports`: `revoked_by INT NULL` (FK `members.id`), `revoked_at TIMESTAMPTZ(3) NULL` (Prisma `revokedById`, `revokedAt`, quan hệ `revokedBy` tên `"ReportRevoker"`).
- CHECK: `status::text <> 'revoked' OR (revoked_by IS NOT NULL AND revoked_at IS NOT NULL AND reject_reason IS NOT NULL)`. So sánh qua `::text` để không dùng giá trị enum mới trong cùng giao dịch với `ADD VALUE`; nếu Postgres vẫn từ chối thì tách CHECK sang migration thứ hai.
- Khi huỷ: `status = 'revoked'`, `revoked_by`, `revoked_at = now`, `reject_reason = lý do`. **Giữ nguyên** `reviewed_by`/`reviewed_at` (ai đã duyệt ban đầu). Cột `reject_reason` nay là "lý do" của cả từ chối lẫn huỷ duyệt.

## 5. Server

- `revokeReport(ctx, reviewer, reportId, reason)` trong `src/server/modules/stats/reports.ts`:
  1. Kiểm tra theo thứ tự §3: quyền → có lần khai → đang `approved` → không tự huỷ → lý do → mùa chưa chốt.
  2. Đọc top 1 của (role, mùa) **trước** khi huỷ.
  3. Trong một giao dịch: khoá dòng mùa (`SELECT … FROM seasons WHERE id = $1 FOR UPDATE`, sau `ensureSeason`), kiểm lại `closed_at IS NULL` (không → `SEASON_CLOSED`), rồi `updateMany` có điều kiện `id` + `status = 'approved'`; không trúng dòng nào → `NOT_APPROVED`. Khoá dòng mùa để huỷ duyệt không lọt vào giữa lúc chốt mùa (chốt mùa cập nhật đúng dòng này).
  4. Sau khi lưu: DM người khai (lỗi chỉ ghi log) — `Lần khai {role} ({formatReportValue}) ngày {dd/mm} đã bị huỷ duyệt: {lý do}`.
  5. Tính lại top 1; có người dẫn đầu và khác người trước → `announceHolderChange` như khi duyệt; không còn ai dẫn đầu → không đăng gì. Lỗi Discord chỉ ghi log.
- `listRecentlyApproved(ctx)`: lần khai `approved` có ngày chơi thuộc mùa **chưa chốt** (mùa hiện tại và mùa trước nếu chưa chốt), sắp `reviewed_at` giảm dần rồi `id` giảm dần, tối đa 50.
- Routes (`src/server/web/routes/stats.ts`, `requireMod`):
  - `GET /api/admin/reports?status=approved` → `ReviewedReportDto[]` (`status=pending` giữ như cũ; giá trị khác → `VALIDATION`).
  - `POST /api/admin/reports/:id/revoke`, body `{ reason: string }` → 204.
- `src/shared/api-types.ts`: `ReportStatus` thêm `'revoked'`; `ReviewedReportDto = ReportDto & { reviewedBy: { id: number; displayName: string } | null; reviewedAt: string }` — chỉ dùng ở danh sách quản trị (người khai không thấy tên người duyệt, như hiện nay).
- `errors.ts`: thêm `NOT_APPROVED`.

## 6. Web

- **Quản trị → Duyệt điểm** (`ReviewsTab.tsx`): dưới hàng chờ thêm mục **"Đã duyệt gần đây"** (tiêu đề kèm số dòng, nút Tải lại), cùng kiểu danh sách panel. Mỗi dòng: tên người khai, `{icon} {role}`, ngày chơi, giá trị (`formatReportValue`), "Duyệt bởi {tên} lúc {giờ} {ngày}", ghi chú, link highlight. Danh sách rỗng → "Chưa có lần khai nào được duyệt trong mùa đang mở".
- Nút **"Huỷ duyệt"** (`btn-secondary`) mở form: ô "Lý do huỷ duyệt" (đếm ký tự /200, kiểm tra rỗng tại chỗ "Cần ghi lý do huỷ duyệt"), nút **"Xác nhận huỷ duyệt"** (`btn-danger`) và "Thôi".
- Huỷ thành công → dòng rời danh sách ngay (sửa cache) và làm mới cache bảng xếp hạng, Đại sảnh, Top 3 mỗi phe. Lỗi `NOT_APPROVED` → hiện lời nhắn và tải lại danh sách. Duyệt một lần khai ở hàng chờ cũng làm mới danh sách "Đã duyệt gần đây".
- **Khai điểm → Lần khai của tôi** (`ReportPage.tsx`): chip mới **"Bị huỷ duyệt"** (`bg-duck-soft text-night-950`), lý do hiện như lần khai bị từ chối.

## 7. Kiểm thử và tiêu chí xong

- Huỷ: `approved → revoked`, lưu người/giờ huỷ và lý do, giữ người duyệt ban đầu; DM gửi đúng nội dung; lỗi DM không làm hỏng việc huỷ.
- Lỗi: không phải mod → `FORBIDDEN`; không có → `NOT_FOUND`; đang `pending`/`rejected`/`revoked` → `NOT_APPROVED`; mod tự huỷ → `SELF_REVIEW` (admin tự huỷ được); lý do rỗng/quá 200 → lỗi; mùa đã chốt → `SEASON_CLOSED`; hai lần huỷ cùng lúc → đúng một lần thành công.
- Điểm: sau khi huỷ, điểm mùa, bảng xếp hạng, Đại sảnh, Top 3 mỗi phe không còn tính lần khai đó; người giữ hoá thân đổi → đăng "👑 … đã hoá thân …"; không còn ai → không đăng; chốt mùa sau đó không tính lần khai đã huỷ.
- Danh sách: chỉ `approved` của mùa chưa chốt, đúng thứ tự, tối đa 50, có tên người duyệt; mùa trước đã chốt không hiện.
- Migration: enum mới, hai cột, CHECK chặn `revoked` thiếu người/giờ/lý do; dữ liệu cũ không đổi.
- Web: mục "Đã duyệt gần đây", form lý do và kiểm tra rỗng, dòng biến mất sau khi huỷ, `NOT_APPROVED` tải lại; chip "Bị huỷ duyệt" kèm lý do ở Lần khai của tôi.
- `npm run typecheck`, toàn bộ test, `npm run build` đạt.
