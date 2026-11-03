# Ngày nhân điểm — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin đặt ngày nhân điểm (×2–×5); điểm cộng của lần khai ngày đó được nhân; banner web và thông báo Discord.

**Architecture:** Bảng `score_multiplier_days`; hệ số đọc lúc tính điểm trong `aggregateSeason` (một truy vấn phụ khi mùa có ngày nhân) và `reportPoints` (DTO); module `src/server/modules/multipliers/`; việc Discord theo mẫu bộ hẹn giờ có lease; web: mục trong SettingsTab, banner trong Layout.

**Tech Stack:** Fastify 5, discord.js 14, Prisma 6 / PostgreSQL 16, React 19 + TanStack Query, Vitest 3.

**Spec:** `docs/superpowers/specs/2026-10-30-multiplier-days-design.md`

## Global Constraints

- Chữ hiển thị/lỗi đúng nguyên văn spec; tiếng Việt; comment tiếng Việt.
- Điểm = `(value×points + extra×extraPoints) × m − penalty×penaltyPoints + bonus`; treo thưởng không nhân.
- Server test `GGD_TEST_DB=embedded`, một lượt mỗi lúc; web test `npx vitest run --project web`. Docker hỏng — không đụng. Không đụng `.env`. Không đụng thư mục chưa track `server-art/`, `.claude/`.
- Khoá query chung `src/web/lib/queryKeys.ts`; không import trang từ trang khác; chuyển động dùng biến `--dur-*`.
- Commit kết thúc bằng dòng trống + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Lần khai có điểm trừ lớn hơn phần cộng ngày ×m — điểm vẫn đúng công thức (không nhân phần trừ), ô âm xử lý như cũ (Task 1).
2. Ngày nhân nằm ở ranh giới tháng (ngày 1 hoặc cuối tháng) — tính đúng mùa của ngày chơi (Task 1).
3. Bộ hẹn giờ chạy lại nhiều lần trong 9:00–9:59 hoặc hai tiến trình — chỉ nhắc một lần (Task 1).
4. Banner khi đồng hồ qua nửa đêm lúc trang đang mở — chuyển "Ngày mai" → "Hôm nay" khi tải lại dữ liệu (Task 2).

---

### Task 1: Server — dữ liệu, điểm, API, Discord

**Spec:** §2, §3, §4 API, §6.

**Files:** migration mới, `prisma/schema.prisma`, mới `src/server/modules/multipliers/service.ts` (+ `jobs.ts` cho đăng bù/nhắc 9:00), `src/server/modules/stats/leaderboard.ts` (`aggregateSeason`), `src/shared/metric.ts` (`reportPoints` nhận hệ số), `src/server/modules/stats/reports.ts` (`toReportDto` thêm `multiplier`, `points` đã nhân — tra hệ số theo các ngày trong danh sách bằng một truy vấn), routes mới, đăng ký job trong scheduler, `src/shared/api-types.ts` (`MultiplierDayDto`, `ReportDto.multiplier`), tests.

- [ ] Test hỏng: công thức + Review Focus #1/#2; mọi bảng dùng điểm đã nhân; CRUD + lỗi + quyền; `upcoming`; Discord tạo/sửa/xoá/đăng bù/nhắc 9:00 một lần (#3).
- [ ] Cài đặt. typecheck, toàn bộ server + web, build. Commit `feat: score multiplier days on the server`.

### Task 2: Web — Cài đặt, banner, gợi ý form, chip

**Spec:** §4 (mục Cài đặt), §5.

**Files:** `src/web/pages/admin/SettingsTab.tsx` (hoặc component con mới), mới `src/web/components/MultiplierBanner.tsx` (gắn trong `Layout.tsx`), `ReportPage.tsx`, `ReviewsTab.tsx`, `queryKeys.ts`/`queries.ts`; tests.

- [ ] Test hỏng theo §7 phần Web + Review Focus #4.
- [ ] Cài đặt; kiểm tra tay trong pane trình duyệt (vite dev + stub) ở desktop và 320px. typecheck, toàn bộ web, build. README: đoạn ngắn về Ngày nhân điểm. Commit `feat: score multiplier days on the web`.
