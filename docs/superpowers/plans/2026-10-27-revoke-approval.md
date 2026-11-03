# Huỷ duyệt lần khai Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mod/admin huỷ được lần khai đã duyệt (kèm lý do) khi mùa chưa chốt; điểm và hoá thân tính lại, người khai nhận DM.

**Architecture:** Trạng thái mới `revoked` trên `stat_reports` (mọi truy vấn điểm đã lọc `approved` nên tự bỏ lần khai bị huỷ). Service `revokeReport` + `listRecentlyApproved` trong `stats/reports.ts`, hai route mod, và mục "Đã duyệt gần đây" trong tab Duyệt điểm.

**Tech Stack:** Node 24, Fastify 5, Prisma 6 / PostgreSQL 16, React 19 + TanStack Query, Vitest 3 (server test: `GGD_TEST_DB=embedded`).

**Spec:** `docs/superpowers/specs/2026-10-27-revoke-approval-design.md`

## Global Constraints

- Mọi chữ hiển thị bằng tiếng Việt, đúng nguyên văn spec: "Bị huỷ duyệt", "Đã duyệt gần đây", "Huỷ duyệt", "Xác nhận huỷ duyệt", "Thôi", "Lý do huỷ duyệt", "Cần ghi lý do huỷ duyệt", "Lý do huỷ duyệt tối đa 200 ký tự", "Mod không được huỷ duyệt lần khai của mình", "Lần khai không còn ở trạng thái đã duyệt", "Chưa có lần khai nào được duyệt trong mùa đang mở".
- DM: `Lần khai {role.nameVi} ({formatReportValue(value, extraValue, role)}) ngày {formatVnDay(playedOn)} đã bị huỷ duyệt: {lý do}`.
- Lý do: cắt khoảng trắng, 1–200 ký tự. Danh sách tối đa 50 dòng.
- Lỗi Discord (DM, thông báo hoá thân) chỉ ghi log, không làm hỏng việc huỷ.
- Server tests và web tests dùng chung DB `ggd_test`: không chạy hai lượt server test cùng lúc. Web test chạy riêng `npx vitest run --project web`.
- Commit kết thúc bằng `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Không chạm `.env`; không sửa Docker.

## Review Focus

1. Huỷ đúng lúc chốt mùa (00:05 ngày 4) → hoặc huỷ thành công và `role_titles` không tính lần khai đó, hoặc huỷ bị `SEASON_CLOSED` và danh hiệu tính nó — không bao giờ lệch (Task 2, test chạy song song).
2. Ngày 1–3 của tháng: lần khai ngày chơi tháng trước (mùa trước chưa chốt) phải hiện trong danh sách và huỷ được; sau khi mùa trước chốt thì biến mất (Task 2).
3. Bấm Huỷ hai lần / hai mod cùng bấm → đúng một lần thành công, chỉ một DM (Task 2).
4. Lần khai đã huỷ không sửa được (`updateOwnReport` → `NOT_PENDING`) và không duyệt lại được (`reviewReport` → `NOT_PENDING`) (Task 2).
5. Lý do chỉ toàn khoảng trắng trên web → báo lỗi tại chỗ, không gửi request (Task 4).

---

### Task 1: Trạng thái `revoked` trong DB, kiểu chung, mã lỗi và chip "Bị huỷ duyệt"

**Files:**
- Create: `prisma/migrations/20261027120000_report_revoke/migration.sql`
- Modify: `prisma/schema.prisma` (enum `ReportStatus`, model `StatReport`, model `Member` thêm quan hệ ngược `revokedReports StatReport[] @relation("ReportRevoker")`)
- Modify: `src/shared/api-types.ts` (`ReportStatus`)
- Modify: `src/server/lib/errors.ts` (`NOT_APPROVED`)
- Modify: `src/web/pages/ReportPage.tsx` (`STATUS_CHIP.revoked`; lý do hiện cho cả `rejected` và `revoked`)
- Test: `tests/server/errors.test.ts`, `tests/server/reports.test.ts` (CHECK), `tests/web/ReportPage.test.tsx`

**Interfaces:**
- Produces: Prisma `ReportStatus.revoked`; `StatReport.revokedById: number | null`, `StatReport.revokedAt: Date | null`, quan hệ `revokedBy`; shared `type ReportStatus = 'pending' | 'approved' | 'rejected' | 'revoked'`; mã lỗi `'NOT_APPROVED'` → `{ status: 409, message: 'Lần khai không còn ở trạng thái đã duyệt' }`.

- [ ] **Step 1: Viết test hỏng**
  - `errors.test.ts`: `appError('NOT_APPROVED')` có status 409 và message "Lần khai không còn ở trạng thái đã duyệt".
  - `reports.test.ts` test `'a revoked report must carry who, when and why (CHECK)'`: tạo lần khai, `testDb.$executeRaw` đặt `status = 'revoked'` khi thiếu `revoked_by` → lỗi CHECK (mã Postgres 23514); đủ `revoked_by`, `revoked_at`, `reject_reason` → thành công.
  - `ReportPage.test.tsx`: lần khai `status: 'revoked'`, `rejectReason: 'Clip không khớp'` → hiện chip "Bị huỷ duyệt" và "Clip không khớp".
- [ ] **Step 2: Chạy, thấy hỏng** — `GGD_TEST_DB=embedded npx vitest run tests/server/errors.test.ts tests/server/reports.test.ts` và `npx vitest run --project web tests/web/ReportPage.test.tsx`.
- [ ] **Step 3: Migration** — `ALTER TYPE "ReportStatus" ADD VALUE 'revoked';`, thêm `revoked_by INTEGER` (FK `members(id)`, cùng kiểu FK như `reviewed_by`) và `revoked_at TIMESTAMPTZ(3)`, rồi CHECK tên `stat_reports_revoked_complete`: `status::text <> 'revoked' OR (revoked_by IS NOT NULL AND revoked_at IS NOT NULL AND reject_reason IS NOT NULL)`. Nếu `prisma migrate` từ chối vì enum mới trong cùng giao dịch, tách CHECK sang `20261027120100_report_revoke_check`. Cập nhật `schema.prisma` khớp migration (`npx prisma migrate diff` không còn khác biệt), `npx prisma generate`.
- [ ] **Step 4: Kiểu và lỗi** — thêm `'revoked'` vào `ReportStatus` shared, `NOT_APPROVED` vào `errors.ts`; `STATUS_CHIP.revoked = { text: 'Bị huỷ duyệt', className: 'bg-duck-soft text-night-950' }`; điều kiện hiện lý do ở `ReportPage.tsx:729` gồm cả `revoked`.
- [ ] **Step 5: Chạy lại test + `npm run typecheck`** — PASS.
- [ ] **Step 6: Commit** `feat: revoked report status, NOT_APPROVED error and its chip`

---

### Task 2: `revokeReport` và `listRecentlyApproved`

**Files:**
- Modify: `src/server/modules/stats/reports.ts` (thêm hai hàm; cập nhật chú thích đầu file)
- Modify: `src/shared/api-types.ts` (`ReviewedReportDto`)
- Test: Create `tests/server/revoke.test.ts`

**Interfaces:**
- Consumes: Task 1 (`revoked`, `revokedById`, `revokedAt`, `NOT_APPROVED`); có sẵn `Reviewer`, `getRoleLeader`, `announceHolderChange`, `ensureSeason`, `isSeasonClosed`, `seasonIdOf`, `previousSeasonId`, `seasonDateRange`, `HOT_TX`, `toReportDto`, `REPORT_SELECT`.
- Produces:
  - `export async function revokeReport(ctx: Ctx, reviewer: Reviewer, reportId: number, reason: string): Promise<void>`
  - `export async function listRecentlyApproved(ctx: Ctx): Promise<ReviewedReportDto[]>`
  - shared `export type ReviewedReportDto = ReportDto & { reviewedBy: { id: number; displayName: string } | null; reviewedAt: string }`

- [ ] **Step 1: Viết test hỏng** trong `tests/server/revoke.test.ts` (dựng theo `reports.test.ts`: `makeTestCtx`, `setNow`, `createMember`, `roleByKey`; tạo lần khai rồi `reviewReport(..., { approve: true })`):
  - `'revoking an approved report stores who, when and why, keeps the approver, and DMs the reporter'`: sau khi huỷ → `status 'revoked'`, `revokedById` = mod, `revokedAt` = giờ đồng hồ, `rejectReason` = lý do đã cắt, `reviewedById` vẫn là người duyệt; `notifier.dms` có đúng một tin `Lần khai Vịt (3 mạng đã giết) ngày 10/10 đã bị huỷ duyệt: Clip không khớp` (dùng nhãn thật của role Vịt trong seed qua `formatReportValue`).
  - `'revoke rules'`: thành viên thường → `FORBIDDEN`; id không có → `NOT_FOUND`; lần khai `pending`, `rejected`, `revoked` → `NOT_APPROVED`; mod huỷ lần khai của chính mình → `SELF_REVIEW` với message "Mod không được huỷ duyệt lần khai của mình"; admin tự huỷ được; lý do `'   '` → `REASON_REQUIRED` message "Cần ghi lý do huỷ duyệt"; lý do 201 ký tự → `VALIDATION` "Lý do huỷ duyệt tối đa 200 ký tự"; mùa đã chốt (`closeSeason`) → `SEASON_CLOSED`.
  - `'a DM failure does not undo the revoke'`: notifier `sendDm` ném lỗi → hàm vẫn xong, lần khai `revoked`.
  - `'two concurrent revokes: exactly one wins, one DM'`: `Promise.allSettled` hai lần huỷ → một fulfilled, một rejected `NOT_APPROVED`; `notifier.dms.length === 1`.
  - `'revoking the leader hands the incarnation to the next player and announces it; no one left → no post'`: A 5 điểm, B 3 điểm cùng role → huỷ của A → `getRoleLeader` là B và `notifier.announcements` có một tin chứa tên B; role chỉ có A → huỷ → không có tin mới.
  - `'leaderboard and season close ignore a revoked report'`: sau khi huỷ, `getRoleLeaderboard` không còn điểm đó; `closeSeason` sau đó → `role_titles` không tính nó.
  - `'revoke racing season close never leaves a title counting a revoked report'`: `setNow` sau giờ chốt; `Promise.allSettled([revokeReport(...), closeSeason(ctx, '2026-10')])` → nếu huỷ fulfilled thì `role_titles` của role không có điểm đó; nếu huỷ rejected thì lý do là `SEASON_CLOSED` và lần khai vẫn `approved`.
  - `'a revoked report can no longer be edited or reviewed'`: `updateOwnReport` → `NOT_PENDING`; `reviewReport` → `NOT_PENDING`.
  - `'listRecentlyApproved: approved reports of open seasons, newest review first, at most 50, with the approver'`: có pending/rejected/revoked không hiện; thứ tự `reviewedAt` giảm dần rồi `id` giảm dần; 51 lần duyệt → 50 dòng; `reviewedBy.displayName` và `reviewedAt` (ISO) đúng.
  - `'listRecentlyApproved includes last month until it closes'`: giờ = 2026-11-02 12:00 VN; lần khai ngày 30/10 đã duyệt hiện; `revokeReport` nó được; sau `closeSeason(ctx, '2026-10')` không còn hiện.
- [ ] **Step 2: Chạy, thấy hỏng** — `GGD_TEST_DB=embedded npx vitest run tests/server/revoke.test.ts`.
- [ ] **Step 3: Cài `revokeReport`** — kiểm tra theo thứ tự spec §3 (quyền → có → `approved` → không tự huỷ → lý do → mùa chưa chốt), đọc `getRoleLeader` trước, `ensureSeason`, rồi `ctx.db.$transaction(async (tx) => …, HOT_TX)`: `tx.$queryRaw` `SELECT closed_at FROM seasons WHERE id = ${seasonId} FOR UPDATE`; `closed_at` khác null → `SEASON_CLOSED`; `tx.statReport.updateMany({ where: { id, status: 'approved' }, data: { status: 'revoked', revokedById, revokedAt: ctx.now(), rejectReason: reason } })`, `count === 0` → `NOT_APPROVED`. Sau giao dịch: DM (try/catch, `console.error`), rồi so top 1 như `afterApprove` (dùng lại hàm đó nếu khớp). Dùng `REVIEW_ROLE_SELECT` cho role.
- [ ] **Step 4: Cài `listRecentlyApproved`** — mùa mở = `seasonIdOf(toVnDate(ctx.now()))` và `previousSeasonId(...)` nếu `!isSeasonClosed`; lọc `status: 'approved'` + `playedOn` trong khoảng ngày của các mùa đó; `orderBy [{ reviewedAt: 'desc' }, { id: 'desc' }]`, `take: 50`; select `REPORT_SELECT` + `reviewedAt` + `reviewedBy { id, displayName }`; ánh xạ qua `toReportDto` rồi thêm hai trường.
- [ ] **Step 5: Chạy lại** `tests/server/revoke.test.ts` và `tests/server/reports.test.ts` + `npm run typecheck` — PASS.
- [ ] **Step 6: Commit** `feat: revoke an approved report and list recently approved ones`

---

### Task 3: Routes quản trị

**Files:**
- Modify: `src/server/web/routes/stats.ts`
- Test: `tests/server/web/stats.test.ts`

**Interfaces:**
- Consumes: Task 2 `revokeReport`, `listRecentlyApproved`, `ReviewedReportDto`.
- Produces: `GET /api/admin/reports?status=approved` → `ReviewedReportDto[]`; `GET /api/admin/reports?status=pending` như cũ; `POST /api/admin/reports/:id/revoke` body `{ reason: string }` (strict) → 204.

- [ ] **Step 1: Viết test hỏng** trong `stats.test.ts`:
  - `'member cannot list approved reports or revoke'`: thành viên thường → 403 ở cả hai route.
  - `'mods list recently approved reports with the approver'`: `status=approved` → 200, mảng có `reviewedBy.displayName`; `status=other` → 400.
  - `'revoke: 204 then 409 NOT_APPROVED; empty reason 400; DMs the reporter'`: lần 1 → 204 và `notifier.dms` có tin "đã bị huỷ duyệt"; lần 2 → 409 code `NOT_APPROVED`; body `{ reason: '' }` → 400 `REASON_REQUIRED`; body thừa trường → 400.
- [ ] **Step 2: Chạy, thấy hỏng** — `GGD_TEST_DB=embedded npx vitest run tests/server/web/stats.test.ts`.
- [ ] **Step 3: Cài** — `pendingQuery` thành `z.object({ status: z.enum(['pending', 'approved']) })`, rẽ nhánh `listPendingReports` / `listRecentlyApproved`; route revoke `requireMod`, `revokeBody = z.object({ reason: z.string() }).strict()`, gọi `revokeReport` với `currentMember(request)`, trả 204.
- [ ] **Step 4: Chạy lại + `npm run typecheck`** — PASS.
- [ ] **Step 5: Commit** `feat: admin routes to list approved reports and revoke one`

---

### Task 4: Mục "Đã duyệt gần đây" trong tab Duyệt điểm

**Files:**
- Modify: `src/web/pages/admin/ReviewsTab.tsx` (thêm `APPROVED_REPORTS_KEY`, component `ApprovedReport` và mục mới; cập nhật chú thích đầu file)
- Test: `tests/web/ReviewsTab.test.tsx`

**Interfaces:**
- Consumes: Task 3 routes; `ReviewedReportDto`; có sẵn `formatReportValue`, `HighlightLink`, `QueryState`, `EmptyState`, `formatDateLabel`, `formatTime`, `ApiError`, `errorMessage`.
- Produces: `export const APPROVED_REPORTS_KEY = ['admin', 'reports', 'approved'] as const`.

- [ ] **Step 1: Viết test hỏng** (dựng theo test hiện có của file):
  - `'recently approved shows member, role, value, play date and "Duyệt bởi {tên} lúc …"'`.
  - `'revoking requires a non-blank reason before anything is sent'`: bấm "Huỷ duyệt", gõ `'   '`, bấm "Xác nhận huỷ duyệt" → hiện "Cần ghi lý do huỷ duyệt", không có POST.
  - `'revoking posts the trimmed reason, removes the row and refreshes leaderboards'`: POST `/api/admin/reports/{id}/revoke` body `{ reason: 'Clip không khớp' }`; dòng biến mất; các query `['leaderboard']`, `['leaderboard-factions']`, `['hall']`, `['member']` bị invalidate.
  - `'NOT_APPROVED shows the server message and refetches the list'`.
  - `'approving from the queue refreshes the recently approved list'`.
  - `'no recently approved report says so'`: "Chưa có lần khai nào được duyệt trong mùa đang mở".
  - `'"Thôi" closes the revoke form without sending'`.
- [ ] **Step 2: Chạy, thấy hỏng** — `npx vitest run --project web tests/web/ReviewsTab.test.tsx`.
- [ ] **Step 3: Cài** — mục dưới hàng chờ: tiêu đề "Đã duyệt gần đây (N)" + nút "Tải lại", danh sách panel như hàng chờ; mỗi dòng như `PendingReport` (bỏ "Khai lúc", thêm `Duyệt bởi {reviewedBy?.displayName ?? '—'} lúc {formatTime} {formatDateLabel}`); nút "Huỷ duyệt" (`btn-secondary`) mở form lý do giống form từ chối (nhãn "Lý do huỷ duyệt", đếm /200, nút `btn-danger` "Xác nhận huỷ duyệt" / "Đang gửi…", nút "Thôi"). Thành công → bỏ dòng khỏi cache `APPROVED_REPORTS_KEY` và invalidate bốn query trên; `NOT_APPROVED` → invalidate `APPROVED_REPORTS_KEY`. Duyệt thành công ở `PendingReport` → invalidate `APPROVED_REPORTS_KEY`. Giữ hiển thị đúng ở 320px (`break-words` như dòng hàng chờ).
- [ ] **Step 4: Chạy lại test web + `npm run typecheck`** — PASS.
- [ ] **Step 5: Commit** `feat: recently approved list with a revoke button in the review tab`

---

### Hoàn tất

- [ ] `npm run typecheck`, `GGD_TEST_DB=embedded npm test` (toàn bộ), `npm run build` — đạt.
- [ ] README: một dòng trong mục quản trị/duyệt điểm nhắc nút Huỷ duyệt (chỉ khi mùa chưa chốt).
