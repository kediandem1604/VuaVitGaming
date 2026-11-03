# Chỉ số phụ cho role Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Roles can carry an optional secondary metric worth N points per unit; Ám sát becomes "Số mạng đã giết" (×1, max 15) + "Số lần ám sát trong cuộc họp" (×3, max 2), and every season score uses report points.

**Architecture:** Three nullable role columns + `stat_reports.extra_value`; one migration also converts Ám sát. Report points = `value + extraValue × extraPoints` (live role value); `aggregateSeason` sums value and extraValue per (role, member) and multiplies per role, so every season-score consumer (leaderboard, hall, held roles, season close, faction top, badges) follows. Shared formatters in `src/shared/metric.ts` render "x + y" for a report and "N điểm" for a season score of an extra-metric role.

**Tech Stack:** Node 24, Fastify 5, discord.js 14, Prisma 6 / PostgreSQL 16, React 19, Vitest 3.

**Spec:** `docs/superpowers/specs/2026-10-27-extra-metric-design.md` (binding).

## Global Constraints

- Vietnamese user-facing text with diacritics; Vietnamese comments; LF; commits English ending with a blank line then exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Tests on embedded PostgreSQL: `GGD_TEST_DB=embedded` (Docker Desktop is broken on this PC — never repair it). Full suite once per task; `npm run typecheck`; `npm run build` in the last task.
- Ám sát (`key = 'assassin'`) target: `metricLabel 'Số mạng đã giết'`, `maxPerGame 15`, `extraMetricLabel 'Số lần ám sát trong cuộc họp'`, `extraMaxPerGame 2`, `extraPoints 3`; existing reports `extra_value = value, value = 0` (all statuses).
- Role extra fields: all three set or all null; label 1–60 chars, max 1–100, points 1–100.
- Error texts: extra out of range → `VALUE_OUT_OF_RANGE` "Chỉ số phụ phải từ 0 đến N"; extra on a role without one → `VALIDATION` "Role này không có chỉ số phụ"; disabling with used extras → `VALIDATION` "Role đã có lần khai dùng chỉ số phụ, không tắt được".
- Report text for an extra-metric role: `{value} {main} + {extraValue} {extra}` via `metricAfterValue`; season score text: `{score} điểm`.
- `×5` faction weight rule (`maxPerGame === 1`) unchanged, applied to season points.

## Review Focus

- Admin edits `extraPoints` mid-season: unclosed season scores and the hoá thân holder follow the new value; closed seasons keep `role_titles.score` — test in Task 2.
- PATCH of a report without `extraValue` keeps the stored extra; PATCH changing role to one without an extra metric with a stored extra > 0 → validation error — test in Task 2.
- Review optimistic lock: a report edited (extra changed) between load and approve is not approved with stale numbers — test in Task 2.
- Migration on the live DB converts only `assassin` and is idempotent-safe to apply once (a role row whose key is missing does nothing) — test in Task 1.
- 320px: the two-input form and "x + y" lines wrap without horizontal scroll — check in Task 4.

---

### Task 1: Data, migration, role admin (server)

**Files:** Create `prisma/migrations/20261027090000_role_extra_metric/migration.sql`; Modify `prisma/schema.prisma`, `src/server/seed/roles.ts`, `src/server/modules/roles/service.ts`, `src/server/web/routes/roles.ts`, `src/shared/api-types.ts` (`RoleDto`), tests (`tests/server/roles.test.ts`, route tests, a migration/seed test).

**Produces:** `Role.extraMetricLabel/extraMaxPerGame/extraPoints` (nullable), `StatReport.extraValue Int @default(0)`, `RoleDto` extra fields (`string | null`, `number | null`, `number | null`); role create/patch accept the three fields per Global Constraints and refuse disabling when any report of the role has `extra_value > 0`.

- [ ] **Step 1: Failing tests:** create role with all three extras / with none; one or two of three → 400; ranges; patch enable/edit; patch to all-null blocked when a report has extra > 0, allowed when none; `RoleDto` carries the fields; seed gives Ám sát the target values; migration SQL contains the CHECK, the `assassin` role UPDATE and the report UPDATE `SET extra_value = value, value = 0 WHERE role_id = (SELECT id FROM roles WHERE key = 'assassin')` (read the SQL text, as the badges migration test does).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4:** focused + full suite + typecheck → PASS.
- [ ] **Step 5: Commit** `feat: optional secondary metric on roles; Ám sát gets meeting assassinations ×3`.

---

### Task 2: Reports, scoring, DTOs, Discord texts (server)

**Files:** Modify `src/shared/metric.ts`, `src/server/modules/stats/reports.ts`, `src/server/web/routes/stats.ts`, `src/server/modules/stats/leaderboard.ts`, `src/server/modules/stats/highlight.ts`, `src/server/modules/seasons/service.ts` (summary text), `src/shared/api-types.ts` (`ReportDto`), tests.

**Interfaces:**
- `src/shared/metric.ts`: `interface MetricRole { metricLabel: string; extraMetricLabel: string | null; extraPoints: number | null }`; `reportPoints(value: number, extraValue: number, role: MetricRole): number`; `formatReportValue(value: number, extraValue: number, role: MetricRole): string`; `formatSeasonScore(score: number, role: MetricRole): string` (`'10 điểm'` for extra roles, else `formatMetricValue`).
- `ReportInput.extraValue?: number` (default 0); `ReportDto` adds `extraValue`, `points`, and `role` adds `maxPerGame`, `extraMetricLabel`, `extraMaxPerGame`, `extraPoints`.
- `aggregateSeason` → `score` = Σ value + Σ extraValue × role.extraPoints (one `groupBy` with `_sum` of both, plus one role lookup for `extraPoints`).

- [ ] **Step 1: Failing tests:** Ám sát report 4 + 2 → `points` 10, season score 10; two reports sum; role without extra unchanged; changing `extraPoints` changes an unclosed season's score and holder; closed season keeps `role_titles.score`; extra > max → `VALUE_OUT_OF_RANGE` with the constraint text; extra on a role without one → `VALIDATION`; PATCH without `extraValue` keeps it; review lock rejects when `extraValue` changed after load; faction top uses new points (Ám sát 4+2 → 10 points); rejection DM / highlight caption read `4 mạng đã giết + 2 lần ám sát trong cuộc họp`; season summary uses `formatSeasonScore`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4:** focused + full suite + typecheck → PASS.
- [ ] **Step 5: Commit** `feat: score reports with the secondary metric`.

---

### Task 3: Discord bot

**Files:** Modify `src/server/bot/commands.ts`, `src/server/bot/interactions.ts`, tests in `tests/server/bot/`.

- [ ] **Step 1: Failing tests:** `/baocao` definition has optional integer option `so_lieu_phu` (0–100) right after `so_lieu`; handler passes it as `extraValue`; confirmation `Đã gửi: 🗡️ Ám sát — 4 mạng đã giết + 2 lần ám sát trong cuộc họp ngày …`; role autocomplete shows `— Số mạng đã giết (+ Số lần ám sát trong cuộc họp)` clipped to 100; `/bxh` line for Ám sát `… — 10 điểm (1 trận)`, other roles unchanged; `/hoso` held roles via `formatSeasonScore` if it shows a label.
- [ ] **Step 2–4:** run → FAIL; implement; focused + full suite + typecheck → PASS.
- [ ] **Step 5: Commit** `feat: secondary metric in /baocao and /bxh`.

---

### Task 4: Web

**Files:** Modify `src/web/pages/ReportPage.tsx`, `src/web/pages/admin/ReviewsTab.tsx`, `src/web/pages/admin/RolesTab.tsx`, `src/web/components/RoleCard.tsx`, `src/web/components/Podium.tsx`, `src/web/pages/LeaderboardPage.tsx`, `src/web/pages/ProfilePage.tsx` (via RoleCard), tests in `tests/web/`.

- [ ] **Step 1: Failing tests:** report form shows the second input only for an extra-metric role, label = extra label, hint `Tối đa 2 mỗi trận · +3 điểm mỗi lần`, sends `extraValue`, refuses > max before sending; edit form likewise and now caps `value` at `role.maxPerGame`; list and review queue show `4 mạng đã giết + 2 lần ám sát trong cuộc họp`; RoleCard/podium/table/Top 3 show `10 điểm` for Ám sát and unchanged text for others; "Chỉ số:" line `Chỉ số: Số mạng đã giết (+1 điểm) · Số lần ám sát trong cuộc họp (+3 điểm)`; Roles admin: "Có chỉ số phụ" checkbox reveals three inputs on create and edit, sends all three or all `null`, shows the server error when disabling is refused.
- [ ] **Step 2–4:** run → FAIL; implement; web tests, full suite, typecheck, `npm run build` → PASS; check 320px in a browser if feasible (report if not).
- [ ] **Step 5: Commit** `feat: secondary metric in the report form, displays and role admin`.
