# Ván đấu + Offline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Tính điểm theo ván (spec `2026-11-01-game-rounds-design.md`) và Tổ chức offline (spec `2026-11-01-offline-events-design.md`).

**Architecture:** Ván là bảng mới gắn buổi; lần khai theo ván là `stat_reports` có `round_id` nên mọi luồng duyệt/huỷ/hệ số/báo cáo dùng lại; điểm thắng/thua tính lúc đọc trong `aggregateSeasonCells` và `reportPoints`. Offline là module độc lập.

**Specs:** `docs/superpowers/specs/2026-11-01-game-rounds-design.md`, `docs/superpowers/specs/2026-11-01-offline-events-design.md`

## Global Constraints

- Chữ hiển thị/lỗi đúng nguyên văn spec; tiếng Việt; comment tiếng Việt.
- Hai agent không cùng sửa `prisma/schema.prisma` và không cùng chạy server test (DB test dùng chung) — các task chạy lần lượt.
- Server test `GGD_TEST_DB=embedded`; web `npx vitest run --project web`. Docker hỏng — không đụng. Không đụng `.env`, `server-art/`, `.claude/`.
- Khoá query chung `src/web/lib/queryKeys.ts`; ô chọn `Select`; chuyển động dùng biến `--dur-*`.
- Commit kết thúc bằng dòng trống + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Đổi phe thắng sau khi đã duyệt → bảng xếp hạng và hoá thân đổi đúng, thông báo hoá thân không lặp (Task 2).
2. Phe thứ 3 thắng nhưng chưa tick ai → không ai phe thứ 3 được cộng (Task 2).
3. Mùa 10 (không có ván) giữ nguyên điểm sau migration (Task 2).
4. Hai lần khai cùng ván cùng người gửi song song (web + Discord) → một lần (Task 3).
5. Ảnh lớn/không phải ảnh, ảnh bị đổi khi người khác đang xem (ETag) (Task 2).

---

### Task 1: Tổ chức offline (server + web)
Spec offline toàn bộ. Commit `feat: offline events`.

### Task 2: Ván — dữ liệu, điểm, quản lý ván, ảnh (server)
Spec ván §2, §3, §4 (API), `GET /api/sessions/:id/rounds` của §5. Commit `feat: game rounds and win-based scoring (server)`.

### Task 3: Khai theo ván (server + bot)
Spec ván §5 phần API/luật khai/chặn khai theo ngày/`/baocao van`. Commit `feat: report per game round (server and bot)`.

### Task 4: Web ván
Spec ván §4 phần web, §5 phần web (trang buổi, trang Khai điểm, Duyệt điểm), README. Commit `feat: game rounds on the web`.
