# GGD Hub — Highlight cho lần khai điểm

- Ngày: 2026-10-26
- Trạng thái: Đã duyệt, đã làm (bổ sung §7.5, §8, §10 sau review cuối)
- Nhánh: `feat/ggd-hub-v1`
- Liên quan: spec gốc `2026-10-22-ggd-hub-design.md` §4.6 (khai điểm), §4.4 (bot). Thiết kế đã duyệt trong chat ("cách 2").

## 1. Mục tiêu

Người khai điểm có thể **kèm hoặc không kèm** một highlight (video hoặc ảnh) cho mỗi lần khai. Bot đăng file vào kênh Discord `#highlight` (Discord lưu file, miễn phí); web lưu đường dẫn tới tin nhắn đó để mod xem khi duyệt và người khai xem lại.

## 2. Ngoài phạm vi

- Không lưu file trên máy chủ, không phát video ngay trong trang web (nút mở tin nhắn Discord).
- Không thêm highlight qua lệnh slash `/baocao`.
- Mod/admin không thêm highlight hộ người khác; không có nút xoá highlight (chỉ đổi).
- Không cho thành viên nhắn tin trong `#highlight` (giống ba kênh hiện có: xem và thả cảm xúc).

## 3. Luồng người dùng

1. Form **Khai điểm**: ô **"Highlight (không bắt buộc)"** chọn file; dưới ô ghi giới hạn "tối đa N MB". Ô chỉ hiện khi tính năng đang bật (§5).
2. **Gửi khai điểm**: tạo lần khai như hiện tại (`POST /api/reports`, JSON); nếu có file → tải lên `PUT /api/reports/:id/highlight`. Lỗi ở bước tải file **không** huỷ lần khai: form báo "Đã gửi khai điểm, nhưng highlight chưa tải lên được: …" và người dùng thêm lại sau ở danh sách.
3. **Lần khai của tôi**: lần khai có highlight → link **"🎬 Xem highlight"** (mở tin nhắn Discord, tab mới). Lần khai **chờ duyệt** → nút **"Thêm highlight"** / **"Đổi highlight"** (chọn file → tải lên ngay).
4. **Quản trị → Duyệt điểm**: link **"🎬 Xem highlight"** cạnh lần khai có highlight.
5. **Discord `#highlight`**: bot đăng file kèm một dòng `🎬 Highlight — **Tên** · {icon} {Tên role} · {giá trị} {chỉ số} · {dd/mm/yyyy}`. Đổi highlight → bot đăng tin mới, xoá tin cũ (cố gắng; lỗi xoá không làm hỏng thao tác).

Chỉ **chủ lần khai** thêm/đổi được, và chỉ khi lần khai còn `pending`.

## 4. Dữ liệu

- Migration mới: `stat_reports` thêm `highlight_channel_id TEXT NULL`, `highlight_message_id TEXT NULL` (Prisma: `highlightChannelId`, `highlightMessageId`). Không đụng dữ liệu cũ.
- `ReportDto` thêm `highlightUrl: string | null` = `https://discord.com/channels/{DISCORD_GUILD_ID}/{channelId}/{messageId}` khi có đủ hai cột, ngược lại `null`.

## 5. Cấu hình

- Biến mới **không bắt buộc** `DISCORD_HIGHLIGHT_CHANNEL_ID` → `config.discord.highlightChannelId: string | null` (trống/không đặt → `null`).
- `null` → tính năng tắt: `GET /api/reports/highlight-config` trả `{ enabled: false, maxBytes: 0 }`, form ẩn ô, `PUT …/highlight` trả lỗi `HIGHLIGHT_DISABLED`.
- Giới hạn dung lượng = giới hạn tải lên của server Discord theo cấp boost: cấp 0–1 **10 MiB**, cấp 2 **50 MiB**, cấp 3 → vẫn **50 MiB** (trần của app, vì máy chủ 1 GB RAM giữ cả file trong bộ nhớ).

## 6. Bot (cổng `DiscordNotifier`)

Thêm ba thao tác; adapter discord.js định dạng tin và escape Markdown của tên người:

- `highlightUploadLimit(): Promise<number>` — số byte tối đa theo §5 (đọc `premiumTier` của server).
- `postHighlight(post: { memberName: string; roleLabel: string; valueText: string; playedOnText: string; fileName: string; data: Buffer }): Promise<{ channelId: string; messageId: string }>` — đăng vào kênh highlight.
- `deleteMessage(channelId: string, messageId: string): Promise<void>` — tin đã mất thì coi như xong.

Bot cần quyền **Attach Files** (cùng View Channel/Send Messages) trong `#highlight`.

## 7. Nghiệp vụ (`src/server/modules/stats/highlight.ts`)

`attachHighlight(ctx, memberId, reportId, upload: { data: Buffer }): Promise<ReportDto>`:

1. Tính năng tắt → `HIGHLIGHT_DISABLED` (409).
2. Không có lần khai hoặc không phải của người này → `NOT_FOUND`; không còn `pending` → `NOT_PENDING`.
3. Nhận diện loại file theo **nội dung** (không tin đuôi file hay content-type): MP4/MOV (`ftyp` ở byte 4), WebM (`1A 45 DF A3`), PNG, JPEG, GIF; khác → `INVALID_HIGHLIGHT` (400, "Highlight phải là video MP4, WebM, MOV hoặc ảnh PNG, JPG, GIF"). Tên file đăng lên Discord do app đặt: `highlight-{reportId}.{đuôi theo loại}`.
4. Rỗng hoặc lớn hơn `highlightUploadLimit()` → `HIGHLIGHT_TOO_LARGE` (400, "Highlight tối đa N MB").
5. `postHighlight(...)`; lỗi từ Discord → `DISCORD_UNAVAILABLE` (503, "Không đăng được highlight lên Discord, thử lại sau"). Lỗi cố định thì báo rõ thay vì "thử lại sau": bot thiếu quyền / không vào được / kênh đã xoá (50013, 50001, 10003) → `HIGHLIGHT_CHANNEL_UNAVAILABLE` (503, "báo admin"); Discord chê file quá lớn (40005, 413) → `HIGHLIGHT_TOO_LARGE` ("Highlight tối đa N MB").
6. Ghi hai cột bằng `UPDATE … WHERE id = $1 AND member_id = $2 AND status = 'pending'`. Không dòng nào khớp (vừa bị duyệt/từ chối) → xoá tin vừa đăng (cố gắng) rồi `NOT_PENDING`.
7. Có highlight cũ → xoá tin cũ (cố gắng) sau khi ghi thành công.

`highlightConfig(ctx): Promise<{ enabled: boolean; maxBytes: number }>`.

## 8. HTTP

- `GET /api/reports/highlight-config` (thành viên) → §7.
- `PUT /api/reports/:id/highlight` (thành viên): body thô, `Content-Type` thuộc `video/mp4`, `video/webm`, `video/quicktime`, `image/png`, `image/jpeg`, `image/gif` — guard JSON trong `app.ts` cho qua **đúng route này** như route ảnh role. `bodyLimit` 50 MiB + 64 KiB; vượt → `HIGHLIGHT_TOO_LARGE`. Giới hạn tốc độ riêng: 6 lần / 10 phút mỗi IP. Trả `ReportDto` mới.
- Kiểm tra trước khi đọc body (bổ sung sau review, để máy 1 GB RAM không giữ nhiều file lớn cùng lúc): tính năng tắt → `HIGHLIGHT_DISABLED`; `Content-Length` lớn hơn giới hạn hiện tại + 64 KiB → `HIGHLIGHT_TOO_LARGE` ("Highlight tối đa N MB"); tối đa **2** lần tải đang chạy cùng lúc trên cả app, quá → `HIGHLIGHT_BUSY` (503, "Máy chủ đang bận tải highlight khác, thử lại sau"). Người chưa đăng nhập không chiếm chỗ.
- `ReportDto.highlightUrl` có ở `GET /api/reports/mine` và `GET /api/admin/reports`.

## 9. Web

- `src/web/api.ts`: hàm tải file thô `apiUpload<T>(path, file: File): Promise<T>` (PUT, `Content-Type` = `file.type`, lỗi cùng kiểu `ApiError`).
- `ReportPage`: ô file (`accept` theo danh sách §8), kiểm tra dung lượng ở trình duyệt trước khi gửi (cùng thông báo §7.4), trạng thái "Đang tải highlight…", thông báo lỗi riêng cho bước tải file; danh sách lần khai có link xem và nút thêm/đổi.
- `ReviewsTab`: link xem highlight.
- Link mở tab mới (`target="_blank" rel="noopener noreferrer"`). Giao diện theo bộ nhận diện Sảnh đêm; không cuộn ngang ở 320px.

## 10. Thiết lập Discord và triển khai

- `src/server/tools/discord-channels.ts`: thêm kênh `highlight` (`DISCORD_HIGHLIGHT_CHANNEL_ID`) vào kế hoạch; bot được cấp thêm **Attach Files** trong kênh đó. `setup-discord.ts` kiểm tra bot có **Attach Files** (thiếu → hướng dẫn bật). `discord-setup.sh` ghi cả bốn ID kênh. Chạy lại trên máy đang chạy: giữ nguyên ID kênh đã có trong `.env` (kể cả kênh đã đổi tên hay điền tay), chỉ tạo kênh còn thiếu, đặt vào cùng nhóm với kênh đã có.
- `update.sh` không bắt buộc biến mới; `.env.example` (gốc và `deploy/server/`), `render.yaml` thêm biến (không bắt buộc).
- README: link mời bot thêm Attach Files (`permissions=117776`), mục 6C.3 nhắc kênh `#highlight`, bảng biến môi trường.

## 11. Kiểm thử và tiêu chí xong

- Service (bot giả): đăng thành công lưu đúng hai cột và trả `highlightUrl`; không phải chủ → `NOT_FOUND`; không `pending` → `NOT_PENDING`; file giả/không hỗ trợ → `INVALID_HIGHLIGHT`; quá giới hạn → `HIGHLIGHT_TOO_LARGE`; Discord lỗi → `DISCORD_UNAVAILABLE` và không ghi gì; đổi highlight → tin cũ bị xoá; tắt tính năng → `HIGHLIGHT_DISABLED`; lần khai bị duyệt giữa chừng → tin vừa đăng bị xoá, `NOT_PENDING`.
- Route: chỉ thành viên; content-type lạ → 415; route khác vẫn bị guard JSON chặn body thô; quá `bodyLimit` → `HIGHLIGHT_TOO_LARGE`.
- Config: biến trống/không đặt → `null`.
- Web: form có file → gọi tạo rồi tải; tải lỗi vẫn giữ lần khai và báo lỗi; ô ẩn khi tắt; link xem highlight ở danh sách và trang duyệt.
- Kế hoạch kênh: có kênh `highlight`, chạy lại không tạo trùng.
- `npm run typecheck`, toàn bộ test, `npm run build` đạt.
