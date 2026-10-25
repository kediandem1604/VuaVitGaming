# Highlight cho lần khai điểm — kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Người khai điểm kèm được (không bắt buộc) một video/ảnh highlight; bot đăng file vào kênh Discord `#highlight`, web lưu link tới tin nhắn để mod xem khi duyệt.

**Architecture:** Thêm 2 cột vào `stat_reports`, 3 thao tác vào cổng `DiscordNotifier`, một service `attachHighlight` (nhận diện file theo nội dung, kiểm giới hạn theo cấp boost, đăng rồi ghi có điều kiện), route `PUT /api/reports/:id/highlight` nhận body thô (guard JSON cho qua đúng route này như ảnh role), giao diện tải file ở trang Khai điểm và link xem ở trang Duyệt điểm. Kênh `#highlight` do script thiết lập Discord tạo.

**Tech Stack:** TypeScript, Fastify 5, Prisma 6 + PostgreSQL 16, discord.js 14, React 19 + Tailwind 4, Vitest 3.

**Spec:** `docs/superpowers/specs/2026-10-26-highlight-design.md` (đọc kèm).

## Global Constraints

- Mọi chữ người dùng thấy là tiếng Việt có dấu; comment tiếng Việt như phần còn lại của repo.
- Không lưu file highlight trên máy chủ; file chỉ nằm trong bộ nhớ trong lúc chuyển lên Discord.
- Biến `DISCORD_HIGHLIGHT_CHANNEL_ID` **không bắt buộc**; trống → tính năng tắt, mọi thứ khác chạy như cũ.
- Giới hạn: cấp boost 0–1 → 10 MiB (10 485 760 byte), cấp 2 và 3 → 50 MiB (52 428 800 byte). `bodyLimit` route = 50 MiB + 64 KiB.
- Loại file nhận: MP4/MOV, WebM, PNG, JPEG, GIF — xét theo nội dung. Content-type route nhận: `video/mp4`, `video/webm`, `video/quicktime`, `image/png`, `image/jpeg`, `image/gif`.
- Mã lỗi mới và câu chữ: `HIGHLIGHT_DISABLED` 409 "Chưa bật tính năng highlight"; `INVALID_HIGHLIGHT` 400 "Highlight phải là video MP4, WebM, MOV hoặc ảnh PNG, JPG, GIF"; `HIGHLIGHT_TOO_LARGE` 400 "Highlight tối đa N MB" (N theo giới hạn hiện hành; mặc định trong bảng lỗi "Highlight quá lớn"); `DISCORD_UNAVAILABLE` 503 "Không đăng được highlight lên Discord, thử lại sau".
- Dòng tin bot: `🎬 Highlight — **{tên đã escape}** · {icon} {tên role} · {giá trị} {chỉ số} · {dd/mm/yyyy}`.
- Giao diện theo bộ nhận diện Sảnh đêm (`panel`, `field`, `btn-*`, `text-duck-soft` cho lỗi, `text-ok` cho thành công); không cuộn ngang ở 320px; link mở tab mới với `rel="noopener noreferrer"`.
- File LF. Commit tiếng Anh, kết thúc bằng `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commit trên nhánh `feat/ggd-hub-v1`, không push.

## Review Focus

1. **iPhone chọn video có `file.type` rỗng** → web vẫn gửi đúng content-type theo đuôi file (`.mov` → `video/quicktime`…), không bị 415. (Test ở Task 3.)
2. **File đúng bằng giới hạn** được nhận; lớn hơn 1 byte bị từ chối với câu "Highlight tối đa 10 MB". (Test ở Task 1.)
3. **Sửa lần khai (PATCH) sau khi đã có highlight** → highlight giữ nguyên. (Test ở Task 1.)
4. **Lần khai bị duyệt hoặc từ chối** → `highlightUrl` vẫn còn ở danh sách của người khai và danh sách duyệt. (Test ở Task 1.)
5. **Body vượt `bodyLimit`** (vd 60 MiB) → 400 `HIGHLIGHT_TOO_LARGE`, không phải lỗi 413/500 chung. (Test ở Task 2.)

---

### Task 1: Lõi phía server — dữ liệu, cấu hình, cổng bot, service

**Files:**
- Create: `prisma/migrations/20261026090000_report_highlight/migration.sql`, `src/server/modules/stats/highlight.ts`, `tests/server/highlight.test.ts`
- Modify: `prisma/schema.prisma` (model `StatReport`), `src/server/config.ts`, `src/server/ports.ts`, `src/server/bot/discord-notifier.ts`, `src/server/lib/errors.ts`, `src/server/modules/stats/reports.ts` (`REPORT_SELECT`, `toReportDto`), `src/shared/api-types.ts` (`ReportDto`), `tests/helpers/fakes.ts` (`FakeNotifier`), `tests/server/config.test.ts`

**Interfaces:**
- Produces:
  - `config.discord.highlightChannelId: string | null`.
  - `DiscordNotifier.highlightUploadLimit(): Promise<number>`; `postHighlight(post: HighlightPost): Promise<{ channelId: string; messageId: string }>`; `deleteMessage(channelId: string, messageId: string): Promise<void>` với `HighlightPost = { memberName: string; roleLabel: string; valueText: string; playedOnText: string; fileName: string; data: Buffer }` (export từ `ports.ts`).
  - `FakeNotifier`: `highlights: (HighlightPost & { channelId: string; messageId: string })[]`, `deletedMessages: { channelId: string; messageId: string }[]`, `uploadLimit = 10 * 1024 * 1024` (gán được), `onPostHighlight?: () => Promise<void>` (gọi ngay trước khi `postHighlight` trả kết quả — để test chen thao tác giữa chừng), `postHighlight` ném khi `down`.
  - `attachHighlight(ctx: Ctx, memberId: number, reportId: number, upload: { data: Buffer }): Promise<ReportDto>`; `highlightConfig(ctx: Ctx): Promise<{ enabled: boolean; maxBytes: number }>`; `detectHighlightKind(data: Buffer): { ext: 'mp4' | 'mov' | 'webm' | 'png' | 'jpg' | 'gif' } | null` — tất cả trong `highlight.ts`.
  - `ReportDto.highlightUrl: string | null`; `toReportDto(row, guildId: string)`.

- [ ] **Step 1: Viết test hỏng** `tests/server/highlight.test.ts` (dùng `makeTestCtx`/factories có sẵn; ctx có `config.discord.highlightChannelId = 'hl-chan'`, `guildId = 'g1'`):

```ts
test('a pending report owner attaches a video and gets a Discord jump link', …)
// MP4 tối thiểu: Buffer có 'ftyp' ở byte 4 → ReportDto.highlightUrl === `https://discord.com/channels/g1/${channelId}/${messageId}`
// notifier.highlights[0]: fileName `highlight-${reportId}.mp4`, playedOnText dạng dd/mm/yyyy, roleLabel có icon + tên role
test('someone else’s report → NOT_FOUND; approved/rejected report → NOT_PENDING', …)
test('unknown or fake files → INVALID_HIGHLIGHT', …) // văn bản 'hello', PDF '%PDF', Buffer rỗng
test('a file exactly at the limit is accepted; one byte more is HIGHLIGHT_TOO_LARGE "Highlight tối đa 10 MB"', …)
test('Discord down → DISCORD_UNAVAILABLE and nothing is saved', …)
test('replacing a highlight deletes the old Discord message', …)
test('feature off (no highlight channel) → HIGHLIGHT_DISABLED; highlightConfig → { enabled: false, maxBytes: 0 }', …)
test('report reviewed while uploading → the new message is deleted and NOT_PENDING', …)
// notifier.onPostHighlight = () => db.statReport.update({ …, data: { status: 'approved' } })
test('editing the report keeps the highlight; reviewed reports keep highlightUrl', …)
test('detectHighlightKind recognises mp4, mov, webm, png, jpg, gif', …)
```

Thêm vào `tests/server/config.test.ts`: `DISCORD_HIGHLIGHT_CHANNEL_ID` trống hoặc không đặt → `highlightChannelId === null`; có giá trị → giá trị đó.
- [ ] **Step 2: Chạy** `npx vitest run tests/server/highlight.test.ts tests/server/config.test.ts` → FAIL.
- [ ] **Step 3: Migration** — `ALTER TABLE "stat_reports" ADD COLUMN "highlight_channel_id" TEXT, ADD COLUMN "highlight_message_id" TEXT;` + hai trường tương ứng trong `schema.prisma` (`@map`); `npx prisma generate`.
- [ ] **Step 4: Cài đặt** cấu hình, mã lỗi, cổng, `FakeNotifier`, adapter discord.js (kênh qua `sendableChannel(highlightChannelId, 'highlight')`, gửi `{ content, files: [{ attachment: data, name: fileName }], allowedMentions: { parse: [] } }`, escape tên bằng `escapeMarkdown`; `highlightUploadLimit` từ `premiumTier` của guild; `deleteMessage` bỏ qua lỗi tin không còn), `ReportDto.highlightUrl`, rồi `highlight.ts` theo spec §7 (MOV = `ftyp` với brand `qt  `, còn lại `ftyp` → mp4).
- [ ] **Step 5: Chạy** hai file test → PASS; `npm run typecheck` → sạch; `npm test` → toàn bộ PASS.
- [ ] **Step 6: Commit** `feat: attach highlights to score reports through the Discord bot (service, data, config)`.

---

### Task 2: API

**Files:**
- Modify: `src/server/web/routes/stats.ts`, `src/server/web/app.ts` (guard JSON), `tests/server/web/stats.test.ts`

**Interfaces:**
- Consumes: `attachHighlight`, `highlightConfig` (Task 1).
- Produces: `GET /api/reports/highlight-config` → `{ enabled: boolean; maxBytes: number }`; `PUT /api/reports/:id/highlight` (body thô) → `ReportDto`; hằng `HIGHLIGHT_UPLOAD_ROUTE = '/api/reports/:id/highlight'` và `HIGHLIGHT_TYPES` export từ `stats.ts` để guard dùng.

- [ ] **Step 1: Viết test hỏng** trong `tests/server/web/stats.test.ts`:

```ts
test('highlight-config requires login and reports enabled/maxBytes', …)
test('PUT highlight with video/mp4 body stores it and returns highlightUrl', …)
test('PUT highlight with application/pdf or text/plain → 415', …)
test('a raw body to any other /api route is still rejected (415)', …) // vd PUT /api/reports/1 với video/mp4
test('a body over the route limit → 400 HIGHLIGHT_TOO_LARGE', …) // 50 MiB + 64 KiB + 1 byte
test('not logged in → 401; another member’s report → 404', …)
```

- [ ] **Step 2: Chạy** `npx vitest run tests/server/web/stats.test.ts` → FAIL ở test mới.
- [ ] **Step 3: Cài đặt** hai route trong `stats.ts` (parser buffer cho các content-type highlight đăng ký trong plugin, như `roles.ts`; `bodyLimit` 52 494 336; `errorHandler` đổi `FST_ERR_CTP_BODY_TOO_LARGE` → `HIGHLIGHT_TOO_LARGE`; `config.rateLimit = { max: 6, timeWindow: '10 minutes' }`), và nới guard JSON trong `app.ts` cho `PUT` + content-type thuộc `HIGHLIGHT_TYPES` + route đã khớp là `HIGHLIGHT_UPLOAD_ROUTE`.
- [ ] **Step 4: Chạy** test file → PASS; `npm test` → PASS.
- [ ] **Step 5: Commit** `feat: highlight upload and config endpoints`.

---

### Task 3: Giao diện web

**Files:**
- Modify: `src/web/api.ts`, `src/web/pages/ReportPage.tsx`, `src/web/pages/admin/ReviewsTab.tsx`, `tests/web/ReportPage.test.tsx`, `tests/web/ReviewsTab.test.tsx`, `tests/web/api.test.ts`

**Interfaces:**
- Consumes: route Task 2; `ReportDto.highlightUrl`.
- Produces: `apiUpload<T>(path: string, file: File): Promise<T>` (PUT); `highlightContentType(file: File): string | null` (file.type nếu thuộc danh sách, nếu rỗng thì theo đuôi `.mp4 .mov .webm .png .jpg .jpeg .gif`, không hợp lệ → `null`).

- [ ] **Step 1: Viết test hỏng**:

```ts
// api.test.ts
test('highlightContentType falls back to the file extension when the browser gives no type', …)
// new File([..], 'clip.MOV', { type: '' }) → 'video/quicktime'; 'a.pdf' → null
test('apiUpload sends the file as the raw body with its content type', …)
// ReportPage.test.tsx
test('the highlight field is hidden when the feature is off', …)
test('submitting with a file creates the report, then uploads the highlight', …) // POST rồi PUT …/highlight
test('a too-large file is refused before upload with "Highlight tối đa 10 MB"', …)
test('upload failure keeps the report and says "Đã gửi khai điểm, nhưng highlight chưa tải lên được"', …)
test('my reports show "Xem highlight" links and an add/replace button on pending ones', …)
// ReviewsTab.test.tsx
test('a report with a highlight shows a "Xem highlight" link opening in a new tab', …)
```

- [ ] **Step 2: Chạy** ba file test → FAIL.
- [ ] **Step 3: Cài đặt** theo spec §3 và §9: ô file "Highlight (không bắt buộc)" + dòng "Video MP4, WebM, MOV hoặc ảnh PNG, JPG, GIF — tối đa N MB" (N = `maxBytes / 1048576`), trạng thái "Đang tải highlight…", "Thêm highlight"/"Đổi highlight" trên lần khai `pending`, link "🎬 Xem highlight".
- [ ] **Step 4: Chạy** test web → PASS; `npm run typecheck` → sạch.
- [ ] **Step 5: Xem trên trình duyệt** (nếu Docker chạy được; không thì ghi rõ đã bỏ qua): form ở 320px không tràn.
- [ ] **Step 6: Commit** `feat: highlight field on the report form and links for reviewers`.

---

### Task 4: Thiết lập Discord và tài liệu

**Files:**
- Modify: `src/server/tools/discord-channels.ts`, `src/server/tools/setup-discord.ts`, `deploy/server/discord-setup.sh`, `deploy/server/.env.example`, `.env.example`, `render.yaml`, `README.md`, `tests/server/discord-channels.test.ts`

**Interfaces:**
- Consumes: biến `DISCORD_HIGHLIGHT_CHANNEL_ID` (Task 1).
- Produces: `CHANNELS` thêm `{ envKey: 'DISCORD_HIGHLIGHT_CHANNEL_ID', name: 'highlight', topic: 'Highlight người chơi gửi kèm khi khai điểm.', botAttachFiles: true }` (thêm trường `botAttachFiles?: boolean` vào `ChannelPlan`).

- [ ] **Step 1: Sửa test** `discord-channels.test.ts`: kế hoạch có đúng bốn biến (thêm `DISCORD_HIGHLIGHT_CHANNEL_ID`), server trống tạo nhóm + bốn kênh theo thứ tự, chạy lại không tạo gì.
- [ ] **Step 2: Chạy** → FAIL.
- [ ] **Step 3: Cài đặt**: kế hoạch kênh; overwrite của bot cho kênh `botAttachFiles` thêm `AttachFiles`; `setup-discord.ts` kiểm bot có **Attach Files** (thiếu → lỗi tiếng Việt chỉ cách bật); `discord-setup.sh` nhận bốn biến (đủ 4 mới báo thành công); `.env.example` ×2 và `render.yaml` (`sync: false`) thêm biến; README: link mời `permissions=117776` (thêm Attach Files), mục 3 và 6C.3 nhắc `#highlight`, bảng biến môi trường thêm dòng (không bắt buộc), mục 10 thêm một dòng "Kèm highlight khi khai điểm".
- [ ] **Step 4: Chạy** `npx vitest run tests/server/discord-channels.test.ts` → PASS; `bash -n deploy/server/discord-setup.sh`; `npm test` → PASS; `npm run build` → PASS.
- [ ] **Step 5: Commit** `feat: #highlight channel in the Discord setup script; docs for highlights`.
