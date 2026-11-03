# Điểm cộng/trừ theo role và Báo cáo người chơi — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Điểm cộng/trừ cấu hình theo role (bỏ ×5), tìm role trong Quản trị, và Báo cáo người chơi trong form khai điểm.

**Architecture:** Mở rộng mô hình điểm có sẵn (`src/shared/metric.ts`, `aggregateSeason` trong `stats/leaderboard.ts`) thêm `points`, chỉ số phạt, `bonusPoints`, `source`; bảng mới `player_accusations` gắn vào lần khai, xử lý trong luồng duyệt/huỷ duyệt/chốt mùa có sẵn (`stats/reports.ts`, `seasons/service.ts`).

**Tech Stack:** Node 24, Fastify 5, discord.js 14, Prisma 6 / PostgreSQL 16, React 19 + TanStack Query + Tailwind 4, Vitest 3.

**Spec:** `docs/superpowers/specs/2026-10-28-role-points-and-accusations-design.md` (nguồn chuẩn cho mọi chữ, giá trị và luật — mỗi task đọc các mục được chỉ).

## Global Constraints

- Mọi chữ hiển thị/lỗi đúng nguyên văn spec; tiếng Việt; comment code tiếng Việt theo phong cách file.
- Điểm một lần khai = `value × points + extraValue × extraPoints − penaltyValue × penaltyPoints + bonusPoints`, đọc điểm hiện tại của role; bảng xếp hạng chỉ xếp điểm > 0; không còn ×5 ở đâu cả.
- Server test: `GGD_TEST_DB=embedded npx vitest run <files>`, không chạy hai lượt server cùng lúc; web test `npx vitest run --project web <files>`. Docker hỏng — không đụng. Không đụng `.env`.
- Khoá query dùng chung ở `src/web/lib/queryKeys.ts`; không import trang này từ trang khác. Ô chọn dùng component `src/web/components/Select.tsx`.
- Commit kết thúc bằng dòng trống rồi `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Migration viết tay theo kiểu các migration có sẵn; `npx prisma migrate diff` (migrations → schema) không còn khác biệt.

## Review Focus

1. Migration trên dữ liệu thật: điểm mùa tháng 10 đổi theo `points` mới nhưng `role_titles` mùa đã chốt không đổi; role 1 lần/ván không bị nhân đôi (×5 cũ + points 5) (Task 1).
2. Điểm mùa âm (bị trừ nhiều hơn được cộng) không làm lệch bảng/hoá thân và không lên bảng (Task 1).
3. Hai báo cáo trùng gửi gần như cùng lúc, mod duyệt báo cáo sớm nhất → báo cáo kia `superseded`, người bị báo cáo chỉ bị trừ một lần (Task 4).
4. Huỷ duyệt lần khai người báo cáo khi mục trừ điểm đã bị huỷ riêng trước đó → không lỗi, không DM thừa (Task 4).
5. Form khai: tick "Báo cáo người chơi" rồi bỏ tick → không gửi báo cáo; sửa lần khai bỏ báo cáo (`accusation: null`) xoá báo cáo pending (Task 4/5).

---

### Task 1: Lõi tính điểm — schema, migration, điểm khởi đầu, bỏ ×5

**Spec:** §3, §4 (toàn bộ, kể cả bảng `player_accusations` — chỉ tạo bảng/enum, chưa dùng), §5 hai gạch "Hiển thị".

**Files:** migration mới `prisma/migrations/20261028120000_role_points_accusations/`, `prisma/schema.prisma`, `src/server/seed/roles.ts`, `src/shared/metric.ts`, `src/shared/api-types.ts` (`RoleDto`/`ReportDto.role` thêm `points` + ba trường phạt; `ReportDto` thêm `penaltyValue`, `bonusPoints`, `source`; `FactionTopRowDto` bỏ `weight`), `src/server/modules/stats/leaderboard.ts` (`aggregateSeason`, xoá `rolePointWeight`), mọi chỗ chọn/ánh xạ role sang DTO, web chỗ hiển thị `weight`/×5 (LeaderboardPage Top 3, FactionTotals nếu có). Tests: leaderboard, seed, metric (web/shared), LeaderboardPage, các test đang khẳng định ×5.

**Interfaces — Produces:**
- `MetricRole` thêm `points: number; penaltyMetricLabel: string | null; penaltyMaxPerGame: number | null; penaltyPoints: number | null`.
- `reportPoints(r: { value: number; extraValue: number; penaltyValue: number; bonusPoints: number }, role: MetricRole): number`; `hasPenaltyMetric(role)`; `formatReportValue(r: { value; extraValue; penaltyValue }, role)` → "x + y − z" theo spec §5; `seasonScoreUnit(role)` theo spec §5.
- `aggregateSeason`: điểm ô = Σvalue×points + Σextra×extraPoints − Σpenalty×penaltyPoints + Σbonus; `games` = số lần khai `source = 'self'`; bỏ ô ≤ 0.

- [ ] Test hỏng: công thức điểm (chính ×3, phụ, phạt trừ, bonus, âm), `games` bỏ qua `source='accusation'`, Top 3/Tổng phe không còn ×5 (Dân phòng `points=5` cho đúng 5 điểm/lần), migration đặt điểm khởi đầu đúng theo `key` (seed test), `role_titles` không đổi, hiển thị "x + y − z" và đơn vị "điểm".
- [ ] Cài đặt; cập nhật mọi gọi `reportPoints`/`formatReportValue` cũ sang chữ ký mới (chưa có UI nhập phạt — Task 3).
- [ ] `npm run typecheck`, toàn bộ server + web, `npm run build`.
- [ ] Commit `feat: per-role main points and a penalty metric replace the ×5 rule`.

### Task 2: Quản trị role — điểm, điểm trừ, thanh tìm

**Spec:** §5 hai gạch đầu (quản trị role).

**Files:** `src/server/modules/roles/*`, route roles, `src/web/pages/admin/RolesTab.tsx`; tests roles + RolesTab.

**Interfaces — Consumes:** Task 1 trường role. **Produces:** API role nhận/trả `points`, `penaltyMetricLabel`, `penaltyMaxPerGame`, `penaltyPoints`.

- [ ] Test hỏng: tạo/sửa `points` (1..100, ngoài → `VALIDATION`), bật/sửa/tắt chỉ số phạt, thiếu một trường → lỗi, tắt khi đã có `penalty_value > 0` hoặc báo cáo trỏ tới → lỗi spec; web: ô "Điểm mỗi lần", tick "Có điểm trừ" hiện ba ô, tìm "dan phong" ra Dân phòng, không khớp → "Không có role nào khớp".
- [ ] Cài đặt (theo pattern chỉ số phụ hiện có).
- [ ] typecheck, test liên quan + toàn bộ, build. Commit `feat: role admin edits points and penalty, with role search`.

### Task 3: Khai chỉ số phạt

**Spec:** §3 gạch giới hạn, §5 các gạch API/form/bot/hiển thị.

**Files:** `src/server/modules/stats/reports.ts`, `src/server/web/routes/stats.ts`, bot `/baocao` (tìm command definition + handler), `src/web/pages/ReportPage.tsx`, `src/web/pages/admin/ReviewsTab.tsx` (hiển thị), tests reports/stats/bot/ReportPage/ReviewsTab.

**Interfaces — Produces:** `ReportInput.penaltyValue?: number`; khoá lạc quan duyệt gồm `penaltyValue`.

- [ ] Test hỏng: giới hạn/lỗi `penaltyValue`, PATCH giữ giá trị cũ khi không gửi, sửa chen giữa đọc và duyệt bị chặn, `/baocao so_lieu_phat`, form ô thứ ba + gợi ý "+N điểm mỗi lần" khi `points ≠ 1`, DM/hiển thị "x + y − z".
- [ ] Cài đặt. typecheck, test, build. Commit `feat: report a penalty count`.

### Task 4: Báo cáo người chơi — server

**Spec:** §6 (toàn bộ), §3 `bonusPoints`.

**Files:** module mới `src/server/modules/stats/accusations.ts` (gửi/kiểm tra/tìm vụ trùng/áp dụng khi duyệt/huỷ dây chuyền), `reports.ts` (gắn vào submit/update/review/revoke/list), `seasons/service.ts` (chốt mùa), routes (`/api/members/options`, body review `accusation`), `api-types.ts` (`AccusationInputDto`, `AccusationDto` cho người khai và cho hàng chờ). Test mới `tests/server/accusations.test.ts` + route tests.

**Interfaces — Produces:** `ReportDto.accusation: AccusationDto | null` (người khai thấy trạng thái báo cáo của mình; hàng chờ thấy tên người bị báo cáo/role/người bị bắn/phe); review body `accusation?: 'approve' | 'reject'`; `GET /api/members/options`.

- [ ] Test hỏng (mỗi gạch của spec §6 một test): gửi kèm lần khai/PATCH thêm/bỏ; kiểm tra bốn trường + tự báo cáo + người bị bắn = người bị báo cáo; hàng chờ chỉ gắn báo cáo sớm nhất của vụ; ba quyết định duyệt; báo cáo đúng → bonus +1, mục trừ điểm `source='accusation'` đúng giá trị, trùng → `superseded`, DM; bác → báo cáo trùng kế tiếp hiện; mod là người bị báo cáo → `SELF_REVIEW`; huỷ duyệt dây chuyền (kể cả khi mục trừ đã bị huỷ riêng trước — không lỗi, không DM thừa); huỷ riêng mục trừ; chốt mùa; mục trừ không vào hàng chờ, không sửa được; hoá thân role bị trừ được kiểm tra lại.
- [ ] Cài đặt; mọi thay đổi trạng thái liên quan trong cùng giao dịch với việc duyệt/huỷ (khoá mùa như huỷ duyệt hiện có).
- [ ] typecheck, toàn bộ server, build. Commit `feat: player accusations on reports, reviewed with the report`.

### Task 5: Báo cáo người chơi — web

**Spec:** §6 các gạch về form, Duyệt điểm, "Lần khai của tôi".

**Files:** `src/web/pages/ReportPage.tsx` (tách component con mới, vd `src/web/components/AccusationFields.tsx`), `src/web/pages/admin/ReviewsTab.tsx`, tests ReportPage/ReviewsTab + test mới cho component.

- [ ] Test hỏng: tick hiện bốn `Select` có tìm, bỏ tick không gửi `accusation`, thiếu trường báo lỗi tại chỗ, danh sách người loại chính mình/người bị báo cáo; sửa lần khai bỏ báo cáo gửi `accusation: null`; Duyệt điểm hiện khung báo cáo và ba nút ("Duyệt", "Duyệt, bỏ báo cáo" cần lý do, "Từ chối"), gửi đúng body; ghi chú báo cáo trùng; chip "Bị trừ điểm" và trạng thái báo cáo ở "Lần khai của tôi"; 320px.
- [ ] Cài đặt. typecheck, toàn bộ web, build. README: đoạn ngắn về điểm cộng/trừ theo role và Báo cáo người chơi. Commit `feat: accusation fields in the report form and review tab`.
