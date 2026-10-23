# GGD Hub — Thiết kế hệ thống quản lý cộng đồng Goose Goose Duck

- Ngày: 2026-10-22
- Trạng thái: Chờ duyệt
- Phạm vi: bản đầu tiên (v1)

## 1. Mục tiêu

Một hệ thống web + bot Discord cho một server Discord chơi Goose Goose Duck (GGD), gồm:

1. **Quản lý thành viên** — ai vào server Discord là tự có hồ sơ + mã thành viên để dùng hệ thống.
2. **Điểm danh hằng ngày** — biết hôm nay có bao nhiêu người chơi, ai tham gia.
3. **Nhắc giờ** — người đã đăng ký tham gia nhận email + tin nhắn riêng Discord đúng giờ để vào game.
4. **Sảnh tri ân MVP hôm nay** — cả server vote trong Discord theo các hạng mục vui (giết nhiều nhất, pha xử lý ngu nhất…), có hạng mục riêng theo chế độ chơi và theo role (vd Cò gáy: "pha đẻ trứng lộ liễu nhất").
5. **Đại sảnh hoá thân** — đủ role của 3 phe (Ngỗng, Vịt, Phe thứ 3), mỗi role có một chỉ số tích điểm riêng. Ai cao điểm nhất một role trong tháng thì "hoá thân" role đó: nhân vật của role hiện tên người đó trên đầu.

### Tiêu chí thành công

- Thành viên mới vào server nhận được DM có link + mã thành viên trong vòng 1 phút.
- Người đã bấm "Tham gia" nhận nhắc trước giờ chơi 15 phút và đúng giờ, không bị gửi trùng.
- Vote MVP làm hoàn toàn trong Discord, kết quả tự hiện trên web khi đóng vote.
- Bảng xếp hạng role chỉ tính điểm đã được mod duyệt, chốt mùa tự động mỗi tháng.
- Admin vận hành hằng ngày (tạo buổi, duyệt điểm) không cần đụng database hay code.

### Hạn chế đã biết

- **GGD không có API công khai cho số liệu trận đấu.** Mọi chỉ số role phải do người chơi tự khai và mod duyệt.
- Thành viên chưa đăng nhập web lần nào thì hệ thống chưa có email của họ → chỉ nhận nhắc qua DM.
- Ảnh gốc của game thuộc bản quyền Gaggle Studios. Hệ thống dùng nhân vật tự vẽ; admin tự chịu trách nhiệm nếu tải ảnh game lên thay.

### Ngoài phạm vi v1

Biểu đồ thống kê, hỗ trợ nhiều server Discord, app điện thoại, vote trên web, đồng bộ dữ liệu từ game.

## 2. Các quyết định đã chốt

| Câu hỏi | Quyết định |
|---|---|
| Mức kết nối Discord | Có bot Discord |
| Đăng nhập web | "Đăng nhập bằng Discord" (OAuth2), không mật khẩu riêng |
| Nhập điểm role | Người chơi tự khai, mod/admin duyệt mới được cộng |
| Cơ chế role | Khai mọi role đã chơi; mỗi role một bảng xếp hạng; một người có thể giữ nhiều role cùng lúc |
| Chu kỳ xếp hạng | Mùa theo tháng (giờ Việt Nam) |
| Lịch chơi | Admin (và mod) tạo buổi chơi; một ngày có thể nhiều buổi |
| Kênh nhắc | Email + DM Discord, mỗi người tự tắt từng kênh |
| Ai được vote MVP | Cả server; ứng viên là người có mặt ở buổi đó; không tự vote mình |
| Ảnh nhân vật | Tự vẽ sẵn (SVG), admin tải ảnh khác thay được |
| Hosting | Cloud rẻ: 1 dịch vụ Railway + PostgreSQL của Railway trong cùng project, cùng vùng (Singapore), ~5–10$/tháng tổng cộng (ruling R37: Neon gói miễn phí không đủ vì bộ hẹn giờ mỗi phút giữ compute thức 24/7) |
| Kiến trúc | Một ứng dụng TypeScript duy nhất |

## 3. Kiến trúc

```
                ┌──────────── Ứng dụng GGD Hub (1 tiến trình Node.js) ────────────┐
Discord server ◄─► Bot (discord.js)      Web API (Fastify)  ◄─► Web React (Vite)  ◄── Thành viên
                │        │                     │                                  │
                │        └──── Các module nghiệp vụ dùng chung ───────────────────┤
                │   Bộ hẹn giờ (mỗi phút) ─► Cổng gửi Email (SMTP) + Cổng gửi DM  │
                └─────────────────────────────┬────────────────────────────────────┘
                                         PostgreSQL
```

### Công nghệ

| Phần | Lựa chọn | Lý do |
|---|---|---|
| Ngôn ngữ | TypeScript, Node.js 24 LTS | Một ngôn ngữ cho bot, server, web |
| Bot | discord.js v14 | Thư viện bot Discord phổ biến và đầy đủ nhất |
| Web API | Fastify | Nhẹ, có sẵn plugin cookie/static/rate-limit |
| Database | PostgreSQL + Prisma | Ổn định, có migration; Railway có sẵn PostgreSQL trong cùng project |
| Giao diện | React + Vite + React Router + TanStack Query + Tailwind | Phổ biến, build ra file tĩnh để Fastify phục vụ |
| Email | Nodemailer qua SMTP (mặc định Gmail + mật khẩu ứng dụng) | Không cần tên miền; đổi nhà cung cấp chỉ cần sửa cấu hình |
| Test | Vitest + PostgreSQL thật chạy nhúng (`embedded-postgres`, không cần Docker) | Test logic tính điểm/vote trên DB thật |

### Nguyên tắc tách module

- Mỗi module nghiệp vụ (thành viên, buổi chơi, nhắc giờ, MVP, role & điểm, mùa giải) là một thư mục riêng, có service thuần (không phụ thuộc Discord hay HTTP).
- Bot và Web API chỉ là "lớp vỏ" gọi vào service. Cùng một thao tác (vd bấm Tham gia) đi qua cùng một hàm dù bấm trên Discord hay trên web.
- Gửi email và gửi DM đi qua hai **cổng** (interface) `Mailer` và `DiscordNotifier`. Bản thật dùng SMTP/discord.js; bản test dùng bản giả ghi lại tin đã gửi.
- Lỗi trong bot được bắt riêng, không làm sập Web API, và ngược lại.

## 4. Các module

### 4.1 Thành viên

- Bot lắng nghe sự kiện vào server → tạo hồ sơ, cấp mã `GGD-0001` (tăng dần, không tái sử dụng) → DM lời chào kèm link web và mã thành viên.
- Rời server → trạng thái `left`, giữ nguyên lịch sử. Quay lại → kích hoạt lại, giữ mã cũ.
- Khi khởi động, bot quét toàn bộ server để tạo hồ sơ cho người chưa có (chạy lại nhiều lần không sinh trùng).
- Quyền (`member` / `mod` / `admin`) suy ra từ role Discord, cấu hình bằng danh sách role ID trong biến môi trường. Cập nhật khi role Discord của người đó thay đổi và mỗi lần đăng nhập.
- Bot là thành viên bot thì bỏ qua, không tạo hồ sơ.

### 4.2 Đăng nhập

- Discord OAuth2, scope `identify email`. Có tham số `state` chống giả mạo.
- Chỉ người có hồ sơ `active` trong server mới đăng nhập được; người ngoài server thấy trang "Bạn cần vào server Discord trước".
- Lần đăng nhập đầu tiên lưu email Discord đã xác minh. Người dùng sửa được email trong hồ sơ.
- Phiên đăng nhập lưu ở bảng `web_sessions`, cookie `httpOnly`, `secure`, `sameSite=lax`, hết hạn sau 30 ngày.

### 4.3 Buổi chơi và điểm danh

- Admin/mod tạo buổi: giờ bắt đầu, chế độ chơi, sức chứa (mặc định 16 theo phòng game, tối đa 25), mã phòng (không bắt buộc), ghi chú.
- Bot đăng thông báo (embed) vào kênh lịch chơi, có nút **Tham gia** và **Huỷ**. Embed tự cập nhật số người + danh sách mỗi khi có thay đổi.
- Bấm trên web cho kết quả giống hệt bấm trên Discord.
- Hết chỗ thì nút Tham gia báo "Đã đủ người".
- Admin bấm **Kết thúc buổi** → trạng thái `ended` và mở vote MVP. Nếu quên, hệ thống tự kết thúc sau 4 tiếng kể từ giờ bắt đầu.
- Admin có thể **Huỷ buổi** → bot sửa embed thành "Đã huỷ" và DM người đã đăng ký.
- Trạng thái buổi: `scheduled` → `ended` (hoặc `cancelled`).

### 4.4 Nhắc giờ

- Bộ hẹn giờ chạy mỗi 60 giây, tìm các nhắc cần gửi:
  - `pre15`: lúc giờ bắt đầu − 15 phút.
  - `start`: đúng giờ bắt đầu, kèm mã phòng nếu có.
- Gửi cho mỗi người đang ở trạng thái tham gia, qua từng kênh họ bật (email nếu có email và bật; DM nếu bật).
- Trước khi gửi, ghi một dòng vào `notification_log` với ràng buộc duy nhất `(buổi, người, loại, kênh)` → chạy lại hay chạy song song cũng không gửi trùng.
- Server khởi động lại: gửi bù nhắc chưa gửi nếu chưa quá giờ bắt đầu 10 phút; quá thì bỏ qua.
- Người đăng ký sau mốc `pre15` không nhận nhắc `pre15`, chỉ nhận `start`.
- Chỉ một tiến trình chạy bộ hẹn giờ tại một thời điểm (khoá thuê có hạn trong bảng `scheduler_lease`), phòng khi deploy có 2 bản chạy chồng nhau.

### 4.5 MVP / Sảnh tri ân

- **Hạng mục** (`award_categories`): tên, mô tả, phạm vi, admin thêm/sửa/ẩn trên web. Có 3 phạm vi:
  - `always` — buổi nào cũng có: "Giết nhiều nhất", "Pha xử lý ngu nhất", "Pha dí người ngu nhất".
  - `mode` — chỉ có khi buổi chơi đúng chế độ đó (vd chế độ Săn ngỗng: "Ngỗng chạy giỏi nhất").
  - `optional` — hạng mục theo role, vì role chia ngẫu nhiên mỗi trận nên admin tự tick nếu trong buổi có người ra role đó. Vd "Pha đẻ trứng lộ liễu nhất" (Cò gáy), "Pha chém lố nhất" (Kiếm sĩ).
- **Chọn hạng mục khi kết thúc buổi:** admin thấy danh sách đã tick sẵn hạng mục `always` + `mode` khớp; hạng mục `optional` để trống, tick thêm nếu muốn. Buổi tự kết thúc (admin quên) thì chỉ dùng hạng mục tick sẵn.
- **Mở vote:** bot đăng vào kênh vote, mỗi hạng mục một tin nhắn có menu chọn (danh sách người có mặt).
- **Luật vote:**
  - Mọi thành viên `active` của server đều được vote. Người vote chưa có hồ sơ (vd bot đang tắt lúc họ vào server) thì tạo hồ sơ ngay khi vote.
  - Mỗi người một phiếu cho mỗi hạng mục; chọn lại thì đổi phiếu.
  - Không được vote chính mình (bot trả lời riêng "Không được tự vote").
  - Phản hồi vote chỉ người bấm thấy (ephemeral).
- **Đóng vote:** tự đóng sau 12 tiếng (admin đổi mặc định trong cài đặt, hoặc đóng sớm từng đợt). Hạng mục nào nhiều phiếu nhất thì người đó thắng; hoà thì tất cả cùng nhận; không ai được phiếu thì bỏ trống.
- Khi đóng: bot đăng kết quả vào kênh thông báo, web cập nhật "Sảnh tri ân hôm nay" (gộp mọi buổi trong ngày, theo ngày của buổi chơi). Có trang lịch sử tri ân theo ngày.

### 4.6 Role và điểm

- **Danh mục role** (`roles`): phe, tên tiếng Anh, tên tiếng Việt, mô tả ngắn, **tên chỉ số** (vd "Số mạng đã giết"), giới hạn tối đa mỗi trận, ảnh tuỳ chỉnh, bật/tắt. Nạp sẵn đủ role 3 phe (mục 6). Admin sửa được tên, chỉ số, giới hạn, ảnh; thêm role mới khi game cập nhật.
- **Khai điểm:** người chơi khai qua web hoặc lệnh `/baocao` (có gợi ý tên role khi gõ): role, giá trị chỉ số, ngày chơi (mặc định hôm nay), buổi chơi (không bắt buộc), ghi chú.
  - Ngày chơi từ hôm nay lùi tối đa 3 ngày (vd hôm nay ngày 10 thì khai được ngày 7 đến 10), và không thuộc mùa đã chốt.
  - Giá trị là số nguyên từ 0 đến giới hạn tối đa mỗi trận của role.
  - Giới hạn tốc độ: tối đa 30 lần khai mỗi người mỗi ngày.
- **Duyệt:** mod/admin xem hàng chờ trên web, duyệt hoặc từ chối (bắt buộc ghi lý do). Người khai nhận DM khi bị từ chối. Mod không tự duyệt lần khai của chính mình; admin thì được (để server chỉ có một admin vẫn chạy được).
- **Tính điểm:** điểm của một người ở một role trong một mùa = tổng giá trị các lần khai đã duyệt có ngày chơi thuộc mùa đó. Kèm số trận đã khai (số lần khai đã duyệt).
- **Hoà điểm:** so thời điểm duyệt lần khai gần nhất của mỗi người ở role đó trong mùa; ai sớm hơn (tức đạt mức điểm đó trước) xếp trên.
- **Đổi người hoá thân:** sau mỗi lần duyệt, tính lại top 1 của role đó trong mùa của lần khai; nếu đổi người, bot đăng "👑 <tên> đã hoá thân <role> mùa <YYYY-MM>!" vào kênh thông báo.

### 4.7 Mùa giải và Đại sảnh hoá thân

- Mùa = một tháng dương lịch theo giờ Việt Nam, mã `YYYY-MM`.
- **Chốt mùa:** lúc 00:05 ngày 4 của tháng sau (để kịp nhận khai 3 ngày cuối tháng). Khi chốt:
  - Các lần khai còn chờ duyệt của mùa đó tự chuyển "từ chối — mùa đã chốt".
  - Lưu top 1 mỗi role (có điểm > 0) vào `role_titles`. Chạy lại không sinh trùng.
  - Bot đăng bảng tổng kết mùa vào kênh thông báo.
  - Ngày 3, bot nhắc mod duyệt nốt hàng chờ của mùa trước.
- **Đại sảnh hoá thân (web):** lưới nhân vật chia 3 phe. Mỗi ô: nhân vật của role, tên người đang dẫn đầu mùa này nổi trên đầu (kiểu bảng tên trong game), điểm + tên chỉ số. Role chưa có ai trong mùa này hiện mờ người giữ mùa trước, ghi "Mùa trước"; chưa từng có ai thì để trống "Chưa ai hoá thân".
- Xem lại các mùa đã chốt.

### 4.8 Nhân vật

- Trong game mọi người chơi đều có cùng một dáng nhân vật, nên nhân vật hoá thân = một dáng nhân vật SVG tự vẽ dùng chung, tô màu theo phe (xanh ngỗng, đỏ vịt, tím phe thứ 3), kèm biểu tượng role.
- Bảng tên trên đầu: chữ trắng viền tối như trong game, tự co chữ khi tên dài.
- Admin tải ảnh khác cho từng role: chỉ nhận PNG/JPG/WebP, tối đa 1 MB, kiểm tra định dạng thật theo nội dung file; lưu trong PostgreSQL (vì ổ đĩa Railway không giữ file khi deploy lại).

### 4.9 Bộ hẹn giờ

Một vòng lặp chạy mỗi 60 giây (giữ khoá thuê trong `scheduler_lease` để chỉ một bản chạy; không dùng advisory lock vì Prisma dùng nhiều kết nối luân phiên), làm lần lượt các việc sau. Mỗi việc độc lập: một việc lỗi thì ghi log và vẫn chạy việc tiếp theo. Mọi việc đều chạy lại được mà không gây trùng.

| Việc | Khi nào |
|---|---|
| Gửi nhắc `pre15` / `start` | Theo mục 4.4 |
| Tự kết thúc buổi + mở vote | Buổi `scheduled` đã qua giờ bắt đầu 4 tiếng |
| Đóng vote | Đợt vote `open` đã tới `closes_at` |
| Đăng/sửa lại tin Discord bị lỡ | Buổi có `discord_dirty = true`, hoặc tin vote chưa có `discord_message_id` |
| Nhắc mod duyệt hàng chờ mùa trước | 09:00 ngày 3 hằng tháng |
| Chốt mùa | 00:05 ngày 4 hằng tháng |

## 5. Dữ liệu

| Bảng | Cột chính | Ràng buộc |
|---|---|---|
| `members` | id, discord_id, member_code, display_name, avatar_url, email, notify_email, notify_dm, access_level, status, joined_at, left_at | discord_id duy nhất; member_code duy nhất |
| `web_sessions` | id, member_id, expires_at | |
| `game_modes` | id, key, name_vi, name_en, active | key duy nhất |
| `game_sessions` | id, starts_at, mode_id, capacity, room_code, note, status (`scheduled`/`ended`/`cancelled`), discord_message_id, discord_dirty (tin Discord cần đăng/sửa lại), created_by, ended_at | 1 ≤ capacity ≤ 25 |
| `attendances` | session_id, member_id, status (`going`/`cancelled`), updated_at | khoá chính (session_id, member_id) |
| `notification_log` | session_id, member_id, kind (`pre15`/`start`), channel (`email`/`dm`), sent_at, error | duy nhất (session_id, member_id, kind, channel) |
| `award_categories` | id, scope (`always`/`mode`/`optional`), mode_id (chỉ khi scope = `mode`), name, description, active, sort_order | mode_id bắt buộc khi và chỉ khi scope = `mode` |
| `vote_rounds` | id, session_id, opens_at, closes_at, status (`open`/`closed`), announce_pending | session_id duy nhất; `announce_pending` = đã đóng nhưng chưa đăng được kết quả vào kênh thông báo (bộ hẹn giờ đăng bù) |
| `vote_messages` | round_id, category_id, discord_message_id, result_pending | duy nhất (round_id, category_id); các hạng mục được chọn cho đợt vote; `result_pending` = đợt đã đóng nhưng tin chưa được sửa thành kết quả (bộ hẹn giờ sửa bù) |
| `votes` | round_id, category_id, voter_id, nominee_id, updated_at | duy nhất (round_id, category_id, voter_id); voter_id ≠ nominee_id |
| `awards` | round_id, category_id, member_id, vote_count | duy nhất (round_id, category_id, member_id) |
| `roles` | id, key, faction (`goose`/`duck`/`neutral`), name_en, name_vi, description, metric_label, max_per_game, map_note (null, vd "Chỉ có ở Ancient Sands"), mode_id (null = role chế độ thường; có giá trị = role riêng của chế độ đặc biệt), icon (emoji), image (bytea, null), image_mime (null), active, sort_order | key duy nhất; max_per_game ≥ 1 |
| `stat_reports` | id, member_id, role_id, session_id (null), played_on, value, note, status (`pending`/`approved`/`rejected`), reviewed_by, reviewed_at, reject_reason, created_at | value ≥ 0 |
| `seasons` | id (`YYYY-MM`), starts_at, ends_at, closed_at, review_nudged_at (đã nhắc mod ngày 3 chưa), summary_pending | `summary_pending` = đã chốt nhưng chưa đăng được bảng tổng kết vào kênh thông báo (bộ hẹn giờ đăng bù) |
| `scheduler_lease` | id (luôn = 1), holder, expires_at | Một dòng duy nhất |
| `role_titles` | season_id, role_id, member_id, score | duy nhất (season_id, role_id) |
| `app_settings` | key, value | key duy nhất. Giá trị mặc định: thời gian mở vote 12 tiếng, tự kết thúc buổi sau 4 tiếng, nhắc trước 15 phút |

- Mọi thời gian lưu dạng UTC; mốc "hôm nay", "tháng này", giờ chốt mùa tính theo `Asia/Ho_Chi_Minh`.
- Không xoá cứng thành viên hay lần khai; chỉ đổi trạng thái.

## 6. Danh mục role

Cập nhật theo bản game v4.12 (10/2026). Nguồn: patch note chính thức trên Steam, danh sách role trên trang của Gaggle Studios, wiki Fandom; tên tiếng Việt lấy từ video/timeline của streamer Việt (Momo Review, MixiGaming, iLoda, TUI TÊN BÔ, DK Gaming) và download.com.vn.

- Tên đánh dấu **(?)** là chưa xác minh được với bản tiếng Việt trong game. Admin sửa được trên trang quản trị.
- **Tối đa/trận** là giới hạn giá trị một lần khai (phòng tối đa 16 người). Admin chỉnh được.
- Role chỉ có ở một số bản đồ ghi rõ ở cột ghi chú; vẫn tính như role chế độ thường.
- Mọi bảng dưới đây được nạp sẵn khi cài đặt (`active = true`), trừ mục 6.4.

### 6.1 Phe Ngỗng (30 role)

| Key | Tên Việt | Tên Anh | Chỉ số tính điểm | Tối đa/trận | Ghi chú |
|---|---|---|---|---|---|
| goose | Ngỗng | Goose | Số lần vote trúng Vịt | 10 | |
| gravy | Ngỗng ba gang | Gravy | Số trận sống sót đến cuối | 1 | |
| medium | Thầy đồng | Medium | Số xác ẩn được bạn phát hiện | 10 | |
| vigilante | Dân phòng | Vigilante | Số phát bắn trúng kẻ xấu | 1 | |
| sheriff | Cảnh sát trưởng | Sheriff | Số phát bắn trúng kẻ xấu | 10 | |
| canadian | Người Canada | Canadian | Số lần tự báo xác khiến hung thủ bị vote | 1 | |
| lover_goose | Tình nhân (ngỗng) | Lover | Số trận thắng cùng người yêu | 1 | |
| mimic | Kẻ bắt chước | Mimic | Số Vịt bị lộ nhờ bạn | 5 | |
| detective | Thám tử | Detective | Số lần điều tra trúng hung thủ | 10 | |
| birdwatcher | Kẻ rình mò | Birdwatcher | Số lần bắt quả tang giết hoặc chui cống | 10 | |
| bodyguard | Vệ sĩ | Bodyguard | Số trận giữ VIP sống đến cuối | 1 | |
| politician | Chính trị gia | Politician | Số lần thắng vote hoà | 10 | Bản đồ có nhà tù |
| locksmith | Thợ khoá | Locksmith | Số người được giải cứu khỏi tù | 10 | Bản đồ có nhà tù |
| mortician | Pháp y | Mortician | Số xác khám ra thông tin hữu ích | 10 | |
| celebrity | Người nổi tiếng | Celebrity | Số lần hung thủ bị vote sau khi bạn chết | 1 | |
| adventurer | Nhà thám hiểm | Adventurer | Số lần thoát chết do môi trường hoặc phá hoại | 10 | |
| avenger | Người báo thù | Avenger | Số lần trả thù trúng kẻ xấu | 5 | |
| astral | Tinh linh | Astral | Số lần bắt quả tang khi xuất hồn | 10 | |
| engineer | Kỹ sư | Engineer | Số kẻ phá hoại bị bạn tìm ra | 10 | |
| street_urchin | Bụi đời | Street Urchin | Số lần mở khoá cứu người | 10 | Chỉ có ở Ancient Sands |
| tracker | Kẻ theo dấu | Tracker | Số hung thủ lộ diện trong bão cát | 10 | Chỉ có ở Ancient Sands |
| stalker | Kẻ đeo bám | Stalker | Số Vịt bị lộ nhờ theo dõi | 5 | |
| survivalist | Người sống sót | Survivalist | Số lần sống qua đếm ngược | 1 | |
| scientist | Nhà khoa học | Scientist | Số xác tìm thấy nhờ quét | 10 | |
| lobbyist | Người vận động hành lang | Lobbyist | Số phát giết trúng kẻ xấu | 10 | |
| fortune_teller | Thầy bói | Fortune Teller | Số hung thủ đoán đúng từ bài | 10 | |
| soldier | Binh lính | Soldier | Số phát giết trúng kẻ xấu | 10 | |
| coroner | Điều tra viên (?) | Coroner | Số xác đã báo | 15 | |
| sensor | Cảm biến | Sensor | Số Vịt bị bắt nhờ quét bản đồ | 10 | |
| lucid_dreamer | Kẻ điều khiển giấc mơ | Lucid Dreamer | Số manh mối giấc mơ dẫn tới vote đúng | 10 | |

### 6.2 Phe Vịt (31 role)

| Key | Tên Việt | Tên Anh | Chỉ số tính điểm | Tối đa/trận | Ghi chú |
|---|---|---|---|---|---|
| duck | Vịt | Duck | Số mạng đã giết | 15 | |
| lover_duck | Tình nhân (vịt) | Lover | Số trận thắng cùng người yêu | 1 | |
| cannibal | Kẻ ăn xác | Cannibal | Số xác đã ăn | 15 | |
| morphling | Kẻ cải trang | Morphling | Số mạng giết khi đang cải trang | 15 | |
| silencer | Kẻ câm lặng | Silencer | Số người bị bạn câm rồi bị vote ra | 10 | |
| professional | Cao thủ | Professional | Số mạng đã giết | 15 | |
| spy | Gián điệp | Spy | Số role đã soi được | 10 | |
| assassin | Ám sát | Assassin | Số lần ám sát thành công trong cuộc họp | 2 | |
| hitman | Sát thủ | Hitman | Số mục tiêu đã hạ | 10 | |
| snitch | Kẻ mách lẻo | Snitch | Số người bị tống tù | 10 | Bản đồ có nhà tù |
| party | Tiệc tùng | Party | Số mạng đã giết | 15 | |
| demolitionist | Kẻ đặt bom | Demolitionist | Số mạng chết vì bom | 15 | |
| identity_thief | Kẻ cắp danh tính | Identity Thief | Số mạng đã giết | 15 | |
| ninja | Nhẫn giả | Ninja | Số lần giết đôi | 7 | |
| undertaker | Kẻ kéo lê | Undertaker | Số xác giấu không ai báo | 15 | |
| invisibility | Tàng hình | Invisibility | Số mạng giết khi tàng hình | 15 | |
| serial_killer | Kẻ giết người hàng loạt | Serial Killer | Số lần giết đúng mục tiêu | 15 | |
| warlock | Thầy pháp | Warlock | Số mạng chết vì bầy châu chấu | 15 | Chỉ có ở Ancient Sands |
| esper | Siêu năng lực gia | Esper | Số mạng giết từ xa | 15 | |
| preacher | Nhà truyền giáo | Preacher | Số Ngỗng bị vote ra | 10 | |
| cupid | Thần tình yêu | Cupid | Số mạng chết vì sợi dây tình | 15 | Chỉ có ở Eagleton Springs |
| drone | Quái vật | Drone | Số mạng đã giết | 15 | Chỉ có ở Eagleton Springs |
| mime | Nghệ sĩ kịch câm | Mime | Số mạng chết khi bị bạn điều khiển | 15 | |
| clown | Chú hề | Clown | Số người bị nổ bóng | 15 | |
| looter | Kẻ hôi của (?) | Looter | Số xác đã xử lý | 15 | Chỉ có ở Mallardon |
| sniper | Bắn tỉa | Sniper | Số mạng bắn tỉa | 15 | |
| witch_doctor | Thầy phù thuỷ | Witch Doctor | Số mạng chết vì lời nguyền | 15 | |
| lost_duckling | Vịt con lạc lối | Lost Duckling | Số mạng giết (không tính Vịt) | 15 | |
| carrier | Vật chủ | Carrier | Số lần cấy ký sinh thành công | 15 | |
| parasite | Ký sinh trùng | Parasite | Số vật chủ đã hạ | 15 | |
| swordsman | Kiếm sĩ | Swordsman | Số mạng chém | 15 | Có từ v4.10 (08/2026) |

### 6.3 Phe thứ 3 (10 role)

| Key | Tên Việt | Tên Anh | Chỉ số tính điểm | Tối đa/trận | Ghi chú |
|---|---|---|---|---|---|
| dodo | Chim đa đa | Dodo | Số trận thắng (bị vote ra) | 1 | |
| dueling_dodos | Đa đa song đấu | Dueling Dodos | Số trận thắng | 1 | |
| vulture | Kền kền | Vulture | Số xác đã ăn | 15 | |
| pigeon | Chim bồ câu | Pigeon | Số người đã lây | 15 | |
| falcon | Chim ưng | Falcon | Số mạng đã giết | 15 | |
| pelican | Bồ nông | Pelican | Số người đã nuốt | 15 | |
| hawk | Diều hâu | Hawk | Số mạng đã giết | 15 | Chỉ có ở Mallardon |
| raven | Quạ đen | Raven | Số mạng đã giết | 15 | |
| cuckoo | Cò gáy | Cuckoo | Số trứng không bị đập | 30 | Có từ v4.08 (04/2026) |
| magpie | Chim ác là | Magpie | Số lần đoán đúng role | 15 | Có từ v4.10 (08/2026) |

### 6.4 Role riêng của chế độ đặc biệt

Nạp sẵn nhưng **tắt** (`active = false`). Phe ghi dưới đây là dự đoán; admin xác nhận phe và chỉ số rồi mới bật. Trên Đại sảnh, các role này nằm ở một tab riêng "Chế độ đặc biệt".

| Chế độ | Role | Phe (dự đoán) |
|---|---|---|
| Corruption | Thanh tra (Inquisitor), Thánh (Saint), Thợ săn quỷ (Demon Hunter), Thợ may (Seamstress) | Ngỗng |
| Corruption | Đại tư tế (High Priest), Tông đồ (Initiate), Kẻ xoá tội (Sin Eater) | Vịt |
| Corruption | Quạ (Crow) | Phe thứ 3 |
| Trick or Treat | Villager (?) | Ngỗng |
| Trick or Treat | Vampire, Mummy, Thrall, Dr. Turducken, Turducken's Monster, Wereduck (?) | Vịt |
| Tastes Like Chicken | Chicken (?) | Ngỗng |
| Tastes Like Chicken | Camo Duck (?) | Vịt |
| Hoot & Seek | Owl (?) | Ngỗng |
| Hoot & Seek | Sniper, Spotter (?) (key `hoot_sniper`, `hoot_spotter`) | Vịt |

Không nạp: role đã bị gỡ khỏi game (Mechanic, Technician, Snoop — đã gộp vào Kỹ sư; Esper phe Ngỗng cũ), "Rabbit" (chỉ là trạng thái tạm thời, không phải role), "Delusional" (chưa phát hành bản quốc tế).

### 6.5 Chế độ chơi nạp sẵn

| Key | Tên hiển thị | Ghi chú |
|---|---|---|
| classic | Cổ điển (Classic) | Chế độ chính |
| draft | Chọn role (Draft) | Người chơi lần lượt chọn 1 trong 3 role |
| goose_hunt | Săn ngỗng (Goose Hunt) | |
| dine_dash | Dine & Dash | |
| trick_or_treat | Cho kẹo hay bị ghẹo (Trick or Treat) | Chỉ dịp Halloween |
| corruption | Tha hoá (Corruption) | Chỉ ở Bloodhaven |
| tastes_like_chicken | Tastes Like Chicken | |
| hoot_seek | Hoot & Seek | |
| task_race | Đua nhiệm vụ (Task Race) | Chỉ dịp sự kiện |
| hanging_out | Đi chơi (Hanging Out) | Không có role |

Tên tiếng Việt của các chế độ (trừ Săn ngỗng) chưa xác minh; admin sửa được.

## 7. Discord

- **Intent cần bật:** `Guilds`, `GuildMembers` (intent đặc quyền, phải bật trong Discord Developer Portal).
- **Quyền bot:** xem kênh, gửi tin, nhúng link, dùng lệnh slash, đọc lịch sử tin (để sửa embed).
- **Kênh cấu hình qua biến môi trường:** kênh lịch chơi, kênh vote, kênh thông báo.
- **Lệnh slash:** `/baocao` (khai điểm), `/bxh <role>` (top 10 role tháng này), `/hoso` (mã thành viên, role đang giữ, link web). Phản hồi lệnh chỉ người gọi thấy, trừ thông báo chung.
- **Thành phần tương tác:** nút Tham gia/Huỷ trên embed buổi chơi; menu chọn trên tin vote.

## 8. Giao diện web

Tiếng Việt, ưu tiên điện thoại, tông màu theo game (xanh ngỗng, đỏ vịt, tím phe thứ 3).

| Trang | Ai thấy | Nội dung |
|---|---|---|
| Hôm nay | Mọi người đã đăng nhập | Buổi chơi hôm nay, số người, nút tham gia, Sảnh tri ân hôm nay |
| Đại sảnh hoá thân | Mọi người đã đăng nhập | Lưới nhân vật 3 phe, người giữ role, xem các mùa trước |
| Bảng xếp hạng | Mọi người đã đăng nhập | Chọn role, top theo tháng |
| Tri ân | Mọi người đã đăng nhập | Lịch sử MVP theo ngày |
| Hồ sơ | Bản thân | Mã thành viên, email, bật/tắt nhắc, role đang giữ, lịch sử khai |
| Khai điểm | Bản thân | Form khai, trạng thái các lần khai |
| Quản trị | Mod/admin | Tạo/kết thúc/huỷ buổi, hàng chờ duyệt, thành viên, hạng mục MVP, role & ảnh, xem nhắc gửi lỗi |

Trang đăng nhập là trang duy nhất không cần đăng nhập.

## 9. Xử lý lỗi

- **Gửi nhắc thất bại** (email sai, người chặn DM): ghi lỗi vào `notification_log`, không thử lại; admin xem danh sách gửi lỗi. Lỗi của một người không chặn người khác.
- **Khởi động lại giữa chừng:** bộ hẹn giờ đọc trạng thái từ database, gửi bù theo quy tắc mục 4.4.
- **Discord mất kết nối:** web vẫn chạy; discord.js tự kết nối lại. Thao tác web cần đăng/sửa tin Discord thì vẫn lưu DB thành công, việc sửa tin được thử lại ở lần chạy bộ hẹn giờ tiếp theo.
- **Bấm trùng / vote trùng:** ràng buộc duy nhất ở database đảm bảo kết quả đúng dù bấm nhiều lần.
- **Phân quyền:** mọi thao tác mod/admin kiểm tra quyền phía server. Người dùng chỉ sửa được hồ sơ và lần khai của chính mình (lần khai chỉ sửa được khi còn chờ duyệt).
- **Dữ liệu vào:** kiểm tra kiểu và giới hạn ở phía server cho mọi API (zod). Thông báo lỗi bằng tiếng Việt, không lộ chi tiết nội bộ.
- **Bảo mật:** chống CSRF bằng cookie `sameSite=lax` + chỉ nhận JSON cho thao tác ghi; giới hạn tốc độ API; token và mật khẩu chỉ nằm trong biến môi trường; email chỉ bản thân và admin thấy.

## 10. Kiểm thử

- **Test tự động (Vitest, PostgreSQL thật chạy nhúng)** cho phần dễ sai:
  - Tính điểm, phân định hoà, đổi người hoá thân.
  - Chốt mùa: tự từ chối lần khai còn chờ, lưu `role_titles`, chạy lại không trùng.
  - Vote: đổi phiếu, cấm tự vote, đếm phiếu, hoà phiếu, không ai vote.
  - Nhắc giờ: chọn đúng ai cần nhắc lúc nào, không gửi trùng, gửi bù sau khởi động lại, người tắt kênh.
  - Quy tắc khai điểm: 3 ngày, giới hạn mỗi trận, mùa đã chốt.
  - Phân quyền các API quản trị.
- Bot và email dùng bản giả qua cổng `Mailer` / `DiscordNotifier`, test không cần Discord hay Gmail thật.
- Kiểm tra tay trước khi phát hành: chạy với một server Discord thử nghiệm theo danh sách kiểm tra trong README.

## 11. Cấu hình và deploy

Biến môi trường:

| Biến | Ý nghĩa |
|---|---|
| `DATABASE_URL` | Chuỗi kết nối PostgreSQL |
| `PUBLIC_URL` | Địa chỉ web (dùng cho OAuth và link trong tin nhắn) |
| `SESSION_SECRET` | Khoá ký cookie |
| `TRUST_PROXY_HOPS` | Số lớp proxy phía trước app (mặc định 1) — dùng để lấy đúng IP người dùng cho giới hạn tốc độ |
| `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` | Thông tin app Discord |
| `DISCORD_GUILD_ID` | ID server Discord |
| `DISCORD_SCHEDULE_CHANNEL_ID`, `DISCORD_VOTE_CHANNEL_ID`, `DISCORD_ANNOUNCE_CHANNEL_ID` | Các kênh bot đăng tin |
| `DISCORD_ADMIN_ROLE_IDS`, `DISCORD_MOD_ROLE_IDS` | Role Discord được coi là admin / mod (phân tách bằng dấu phẩy) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Gửi email |

Deploy: một dịch vụ Railway chạy `npm start` (chạy migration rồi khởi động) + một dịch vụ PostgreSQL của Railway trong **cùng project** (`DATABASE_URL=${{Postgres.DATABASE_URL}}`, mạng nội bộ), cả hai cùng vùng Southeast Asia (Singapore), Replicas = 1; tổng ~5–10$/tháng. Neon chỉ là phương án thay thế, và phải dùng gói trả phí (gói miễn phí hết giờ compute giữa tháng vì bộ hẹn giờ chạy mỗi phút). README tiếng Việt hướng dẫn từng bước: tạo app Discord và bật intent, mời bot vào server, tạo mật khẩu ứng dụng Gmail, tạo project Railway kèm PostgreSQL, deploy ứng dụng vào cùng project, chạy dữ liệu mẫu, rồi chạy danh sách kiểm tra tay trên server Discord thử.
