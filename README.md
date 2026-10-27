# GGD Hub

Web + bot Discord cho cộng đồng **Goose Goose Duck** Việt Nam: hồ sơ và mã thành viên tự động, điểm danh buổi chơi, nhắc giờ qua email và tin nhắn riêng Discord, vote **Sảnh tri ân MVP** ngay trong Discord, và **Đại sảnh hoá thân** — bảng xếp hạng từng role theo mùa (tháng).

Tài liệu này viết cho người quản trị server Discord, **không cần biết lập trình**. Làm theo thứ tự từ mục 1 đến mục 6 là đưa được hệ thống lên mạng. Mục 7–8 dành cho người muốn chạy thử trên máy hoặc sửa code.

> Ứng dụng là **một tiến trình duy nhất** (web + API + bot + bộ hẹn giờ), chạy trên Railway, dùng PostgreSQL của Railway trong **cùng một project**. Toàn bộ bí mật (token, mật khẩu) chỉ nằm trong biến môi trường — không bao giờ ghi vào code hay commit lên Git.

> ⚠️ **Bắt buộc trước khi mời cả hội:** chạy hết [`docs/manual-test-checklist.md`](docs/manual-test-checklist.md) trên một **server Discord thử**. Mọi phần nói chuyện với Discord thật — bot, nút, menu vote, lệnh slash, đăng nhập Discord (OAuth) — mới chỉ được kiểm bằng bản giả trong test tự động, **chưa từng chạy với Discord thật**. Danh sách đó là lần kiểm tra thật đầu tiên.

## Mục lục

1. [Yêu cầu](#1-yêu-cầu)
2. [Tạo ứng dụng Discord và mời bot](#2-tạo-ứng-dụng-discord-và-mời-bot)
3. [Lấy ID server, kênh và role](#3-lấy-id-server-kênh-và-role)
4. [Email nhắc giờ: Brevo](#4-email-nhắc-giờ-brevo)
5. [Database: PostgreSQL trên Railway](#5-database-postgresql-trên-railway)
6. [Deploy lên Railway](#6-deploy-lên-railway)
   - [6B. Phương án khác: deploy lên Render](#6b-phương-án-khác-deploy-lên-render)
   - [6C. Phương án khác: máy chủ Ubuntu riêng (Google Cloud hoặc AWS Lightsail)](#6c-phương-án-khác-máy-chủ-ubuntu-riêng-google-cloud-hoặc-aws-lightsail)
7. [Chạy ở máy (dành cho người sửa code)](#7-chạy-ở-máy-dành-cho-người-sửa-code)
8. [Chạy test](#8-chạy-test)
9. [Bảng biến môi trường](#9-bảng-biến-môi-trường)
10. [Cách dùng hằng ngày](#10-cách-dùng-hằng-ngày)
11. [Giới hạn đã biết](#11-giới-hạn-đã-biết)
12. [Khi có sự cố](#12-khi-có-sự-cố)

---

## 1. Yêu cầu

| Cần gì | Để làm gì |
|---|---|
| Tài khoản **Discord** có quyền quản trị server của hội | Tạo bot, lấy ID kênh/role |
| Một địa chỉ email của hội (nên tạo Gmail riêng, vd `ggdhub.hoi@gmail.com`) và tài khoản **Brevo** (brevo.com, gói Free) | Gửi email nhắc giờ — Railway gói Hobby chặn SMTP nên email đi qua API HTTPS của Brevo (mục 4) |
| Tài khoản **Railway** (railway.app, gói Hobby) | Chạy ứng dụng 24/7 **và** database PostgreSQL, cùng một project — tổng cộng khoảng **5–10 USD/tháng** (gói Hobby 5 USD/tháng đã gồm 5 USD tài nguyên; phần dùng vượt mới tính thêm) |
| Tài khoản **GitHub** chứa bản sao repo này | Railway kéo code từ GitHub để build |
| *Hoặc* tài khoản **Render** (render.com) thay cho Railway | Web + PostgreSQL trên Render, khoảng **13 USD/tháng** — xem mục 6B (dùng khi Railway tạm khoá đăng ký) |
| *Hoặc* tài khoản **Google Cloud** hoặc **AWS** (máy chủ Ubuntu riêng) thay cho Railway | Một máy chủ 1 GB chạy cả ứng dụng lẫn PostgreSQL: Google Cloud e2-micro ~3,6 USD/tháng (máy miễn phí, chỉ trả IPv4, đặt ở Mỹ) hoặc AWS Lightsail 7 USD/tháng (Singapore) — tự quản máy chủ, xem mục 6C |

Chỉ khi muốn **chạy ở máy** (mục 7) hoặc **chạy test** (mục 8) mới cần cài thêm:

- **Node.js 24 (LTS)** — tải ở <https://nodejs.org>. Kiểm tra: mở terminal, gõ `node --version` → `v24.x.x`.
- **Git**.
- **Docker Desktop** (<https://www.docker.com/products/docker-desktop/>) — database để chạy máy và chạy test là PostgreSQL 16 trong container, khai báo ở `docker-compose.yml` (một container cho dev, một cho test). Kiểm tra: `docker compose version`. Windows bản Insider gặp lỗi Docker tắt ngay sau khi mở → xem mục 12.
- **Phương án dự phòng không có Docker:** PostgreSQL 16 *nhúng* — gói `embedded-postgres` tự tải về khi `npm install` (khoảng 50 MB), dữ liệu nằm ngoài thư mục dự án ở `%LOCALAPPDATA%\ggd-hub\` (Windows) hoặc `~/ggd-hub/` (macOS/Linux). Dùng `npm run db:start:embedded` (mục 7) và `GGD_TEST_DB=embedded` (mục 8).

---

## 2. Tạo ứng dụng Discord và mời bot

### 2.1 Tạo ứng dụng

1. Vào <https://discord.com/developers/applications> → **New Application** → đặt tên (vd `GGD Hub`) → **Create**.
2. Tab **General Information**: chép **Application ID** → đây là `DISCORD_CLIENT_ID`.
3. Tab **OAuth2**:
   - Mục **Client Secret** → **Reset Secret** → chép → `DISCORD_CLIENT_SECRET`.
   - Mục **Redirects** → **Add Redirect** → nhập đúng `{PUBLIC_URL}/auth/callback`, trong đó `PUBLIC_URL` là địa chỉ web sẽ dùng (mục 6 sẽ cho bạn địa chỉ Railway, vd `https://ggd-hub-production.up.railway.app/auth/callback`). Chưa có địa chỉ thì quay lại thêm sau — **thiếu dòng này thì không ai đăng nhập web được**. Nếu sẽ chạy thử ở máy, thêm cả `http://localhost:3000/auth/callback` và `http://localhost:5173/auth/callback`.
   - **Save Changes**.
4. Tab **Bot**:
   - **Reset Token** → chép token → `DISCORD_TOKEN`. Token chỉ hiện **một lần**; ai có token là điều khiển được bot, nên không gửi cho ai và không dán vào chat.
   - Kéo xuống **Privileged Gateway Intents** → bật **Server Members Intent** → **Save Changes**. Đây là intent *đặc quyền*: bot cần nó để biết ai vào/rời server (tạo hồ sơ, cấp mã thành viên) và role của từng người (phân quyền admin/mod). **Không bật thì bot không khởi động được** (log báo `Used disallowed intents`). `Message Content Intent` và `Presence Intent` không cần.
   - Nên tắt **Public Bot** để chỉ bạn mời được bot vào server.

### 2.2 Mời bot vào server

1. Tab **OAuth2** → kéo xuống **OAuth2 URL Generator**.
2. **Scopes**: tick `bot` và `applications.commands` (lệnh slash `/baocao`, `/bxh`, `/hoso`).
3. **Bot Permissions**: tick **View Channels**, **Send Messages**, **Embed Links**, **Attach Files** (để bot đăng highlight), **Read Message History** (để bot sửa lại tin đã đăng). Muốn bot **tự tạo bốn kênh** (máy chủ riêng, mục 6C.3) thì tick thêm **Manage Channels** — tạo kênh xong có thể tắt quyền này trong Server Settings → Roles → role của bot. Không cần quyền Administrator.
4. Chép **Generated URL** ở dưới cùng, mở trong trình duyệt → chọn server của hội → **Authorize**.

Link mời tương đương (thay `APPLICATION_ID`; link thứ hai có thêm Manage Channels):

```
https://discord.com/oauth2/authorize?client_id=APPLICATION_ID&scope=bot%20applications.commands&permissions=117760
https://discord.com/oauth2/authorize?client_id=APPLICATION_ID&scope=bot%20applications.commands&permissions=117776
```

5. Trong Discord, kiểm tra bot **thấy và gửi được** vào các kênh sẽ dùng (lịch chơi, vote, thông báo, và highlight nếu dùng — ở kênh này bot còn cần **Attach Files**). Kênh riêng tư thì thêm role của bot vào quyền kênh.

Bot cần có trong server **trước** lần khởi động đầu: mỗi lần nối Discord, bot quét toàn bộ server để tạo hồ sơ cho người chưa có.

---

## 3. Lấy ID server, kênh và role

Chạy trên máy chủ riêng (mục 6C) thì có thể để bot **tự tạo bốn kênh và tự điền ID kênh** (mục 6C.3, bước 3) — khi đó ở mục này chỉ cần ID server.

Discord ẩn ID; bật chế độ nhà phát triển để thấy nút chép ID:

1. Discord → **User Settings** (bánh răng) → **Advanced** → bật **Developer Mode**.
2. **ID server**: chuột phải vào tên server (góc trên trái) → **Copy Server ID** → `DISCORD_GUILD_ID`.
3. **ID kênh**: chuột phải vào kênh → **Copy Channel ID**. Cần ba kênh, và một kênh thứ tư không bắt buộc:

   | Biến | Kênh | Bot đăng gì |
   |---|---|---|
   | `DISCORD_SCHEDULE_CHANNEL_ID` | Lịch chơi | Thông báo buổi chơi với nút **Tham gia** / **Huỷ**, tự cập nhật số người |
   | `DISCORD_VOTE_CHANNEL_ID` | Vote | Mỗi hạng mục MVP một tin có menu chọn |
   | `DISCORD_ANNOUNCE_CHANNEL_ID` | Thông báo | Kết quả tri ân, 👑 đổi người hoá thân, tổng kết mùa, nhắc mod |
   | `DISCORD_HIGHLIGHT_CHANNEL_ID` | Highlight *(không bắt buộc)* | Video/ảnh highlight thành viên kèm khi khai điểm (mục 10). Để trống thì form khai điểm không có ô highlight. Bot cần thêm **Attach Files** ở kênh này |

   Server nhỏ có thể dùng chung một kênh cho cả ba kênh bắt buộc (điền cùng một ID), nhưng tách riêng dễ theo dõi hơn.

4. **ID role**: **Server Settings** → **Roles** → chuột phải vào role (hoặc nút ⋯) → **Copy Role ID**.

   | Biến | Ai | Làm được gì trên web |
   |---|---|---|
   | `DISCORD_ADMIN_ROLE_IDS` | Admin của hội | Tất cả: cài đặt, hạng mục MVP, danh mục role & ảnh, duyệt cả lần khai của chính mình |
   | `DISCORD_MOD_ROLE_IDS` | Mod | Tạo / kết thúc / huỷ buổi, đóng vote sớm, duyệt điểm (không tự duyệt mình), xem thành viên, xem nhắc gửi lỗi |

   Nhiều role thì ngăn bằng dấu phẩy: `DISCORD_ADMIN_ROLE_IDS=111111111111111111,222222222222222222`. Người có cả role admin lẫn mod là admin; người không có role nào là thành viên thường. Quyền cập nhật ngay khi role Discord của người đó đổi (bot đang chạy) và mỗi lần người đó đăng nhập web.

---

## 4. Email nhắc giờ: Brevo

Railway gói Free và Hobby **chặn gửi email qua SMTP** (chỉ gói Pro trở lên mới có), nên trên Railway ứng dụng gửi email qua **API HTTPS của Brevo**. Gói Free của Brevo gửi được **300 email/ngày**, không cần thẻ, không cần tên miền riêng. Có `BREVO_API_KEY` thì ứng dụng dùng Brevo; không có thì dùng SMTP (mục 4.2). Log lúc khởi động ghi rõ đang dùng cái nào: `Gửi email qua Brevo, người gửi …` hoặc `Gửi email qua SMTP …`.

### 4.1 Brevo (dùng trên Railway)

1. Đăng ký ở <https://www.brevo.com> (gói **Free**) bằng email của hội (vd `ggdhub.hoi@gmail.com`). Brevo có thể hỏi thêm vài thông tin (tên tổ chức, mục đích gửi) trước khi cho gửi email.
2. **Senders, Domains & Dedicated IPs → Senders → Add a sender**: tên `GGD Hub`, email của hội → Brevo gửi mã xác minh tới hộp thư đó → nhập mã. Chỉ địa chỉ **đã xác minh** mới làm người gửi được.
3. **SMTP & API → API Keys → Generate a new API key** → đặt tên `GGD Hub` → chép khoá (dạng `xkeysib-…`, chỉ hiện một lần) → `BREVO_API_KEY`.
4. Điền:

   ```
   BREVO_API_KEY=xkeysib-...
   MAIL_FROM=GGD Hub <ggdhub.hoi@gmail.com>
   ```

   `MAIL_FROM` là tên + địa chỉ hiện ở ô "Từ" của email; địa chỉ phải **đúng** địa chỉ đã xác minh ở bước 2. Đã có `BREVO_API_KEY` thì các biến `SMTP_*` không cần (đặt cũng bị bỏ qua).

Ghi chú: email gửi qua Brevo mà người gửi là một địa chỉ Gmail đôi khi bị lọc vào **Thư rác** (Gmail không xác thực được thư đi từ máy chủ khác). Lần đầu nhắc thành viên bấm "Không phải thư rác". Nếu hội có tên miền riêng, xác minh tên miền trong Brevo (**Domains**) và dùng địa chỉ thuộc tên miền đó cho `MAIL_FROM` thì thư vào hộp thư chính ổn định hơn.

### 4.2 Gmail qua SMTP (chạy ở máy, hoặc Railway gói Pro)

Không đặt `BREVO_API_KEY` thì ứng dụng gửi qua SMTP. Gmail không cho ứng dụng dùng mật khẩu đăng nhập thường; phải tạo **mật khẩu ứng dụng** (16 ký tự), và chỉ tạo được khi tài khoản đã bật xác minh 2 bước.

1. Đăng nhập Gmail của hội → <https://myaccount.google.com/security> → **2-Step Verification** → **Get started** → làm theo hướng dẫn (số điện thoại).
2. Vào <https://myaccount.google.com/apppasswords> (hoặc ở trang Security, gõ `App passwords` vào ô tìm kiếm) → đặt tên `GGD Hub` → **Create** → Google hiện 16 chữ cái dạng `abcd efgh ijkl mnop`. Chép lại **bỏ hết dấu cách** → `SMTP_PASS`. Mật khẩu này cũng chỉ hiện một lần.
3. Điền:

   ```
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=465
   SMTP_USER=ggdhub.hoi@gmail.com
   SMTP_PASS=abcdefghijklmnop
   MAIL_FROM=GGD Hub <ggdhub.hoi@gmail.com>
   ```

   `MAIL_FROM` là tên + địa chỉ hiện ở ô "Từ" của email; địa chỉ phải là chính Gmail đó (Gmail tự thay nếu khác).

Ghi chú: Gmail thường giới hạn khoảng 500 email/ngày cho tài khoản cá nhân — đủ cho một hội chơi game. Dùng nhà cung cấp SMTP khác cũng được: cổng `465` là TLS ngay từ đầu; cổng khác (vd `587`) thì ứng dụng bắt buộc nâng cấp STARTTLS, máy chủ không hỗ trợ sẽ bị từ chối.

---

## 5. Database: PostgreSQL trên Railway

**Mặc định (khuyên dùng): PostgreSQL của Railway, nằm trong cùng project với ứng dụng.** Một nơi quản lý và trả tiền, database và ứng dụng ở cùng một vùng (truy vấn nhanh), không bị giới hạn giờ chạy mỗi tháng.

### 5.1 Tạo project và database

1. <https://railway.app> → đăng ký (gói **Hobby**) → **New Project** → **Deploy PostgreSQL** (hoặc **Empty Project** → **+ Create** → **Database** → **PostgreSQL**). Railway tạo một dịch vụ tên `Postgres` có ổ đĩa riêng để giữ dữ liệu.
2. Bấm vào dịch vụ `Postgres` → **Settings** → **Region** (hoặc **Deploy → Regions**) → chọn **Southeast Asia (Singapore)** — gần Việt Nam nhất. Đặt vùng **ngay lúc này**, trước khi có dữ liệu. Ứng dụng ở mục 6 phải đặt **cùng vùng** này.
3. Chưa cần chép gì: ở mục 6.3, biến `DATABASE_URL` của ứng dụng chỉ là một **tham chiếu** tới database này:

   ```
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   ```

   Railway tự thay bằng chuỗi kết nối nội bộ (`postgres.railway.internal`), đi trong mạng riêng của project: không ra Internet, không tính phí băng thông, không cần `?sslmode=require`. Nếu bạn đổi tên dịch vụ `Postgres` thì sửa chữ `Postgres` trong tham chiếu theo tên mới.

Không phải tạo bảng bằng tay: lần khởi động đầu, ứng dụng tự tạo toàn bộ bảng và nạp dữ liệu tham chiếu (chế độ chơi, hơn 70 role của ba phe, hạng mục MVP mặc định). Những lần sau chỉ áp dụng phần thay đổi, không đụng dữ liệu đã có.

Sao lưu: dịch vụ `Postgres` → tab **Backups** (nếu gói của bạn có) hoặc thỉnh thoảng chạy `pg_dump` bằng chuỗi `DATABASE_PUBLIC_URL` (tab **Variables** của dịch vụ `Postgres`).

### 5.2 Phương án khác: Neon

Dùng được, nhưng **không dùng gói miễn phí của Neon**:

> ⚠️ Gói miễn phí của Neon tính theo **giờ compute mỗi tháng**; compute chỉ "ngủ" khi không có truy vấn. Bộ hẹn giờ của ứng dụng truy vấn **mỗi 60 giây**, nên compute thức **24/7** và hạn mức giờ miễn phí **hết giữa tháng** — từ lúc đó database ngừng, web/bot/nhắc giờ đều chết tới đầu tháng sau. Chọn Neon thì dùng **gói trả phí**.

1. <https://neon.tech> → **New Project**: vùng **Singapore** (`aws-ap-southeast-1`), PostgreSQL 16 hoặc 17.
2. Nút **Connect** → chọn **Direct connection** — *không* chọn "Pooled connection" (chuỗi direct **không** có `-pooler` trong tên máy; `prisma migrate deploy` lúc khởi động cần nối thẳng).
3. Chép chuỗi `postgresql://...` → `DATABASE_URL`. Chuỗi phải kết thúc bằng `?sslmode=require`; nếu có thêm `&channel_binding=require` thì xoá đoạn đó.

   ```
   DATABASE_URL=postgresql://neondb_owner:MAT_KHAU@ep-xxxx-yyyy.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
   ```

4. Ứng dụng trên Railway vẫn phải đặt vùng **Southeast Asia (Singapore)** (mục 6.1) cho gần database.

---

## 6. Deploy lên Railway

### 6.1 Tạo dịch vụ

1. Đưa repo này lên GitHub của bạn (repo private cũng được).
2. Mở **project đã tạo ở mục 5.1** (project có dịch vụ `Postgres`) → **+ Create** → **GitHub Repo** → chọn repo. Ứng dụng phải nằm **trong cùng project** với database thì tham chiếu `${{Postgres.DATABASE_URL}}` và mạng nội bộ mới dùng được. Railway thấy file `Dockerfile` ở gốc repo và tự dùng nó để build (kiểm tra: **Settings → Build → Builder** là *Dockerfile*).
3. Dịch vụ ứng dụng → **Settings → Deploy → Regions** (hoặc **Region**) → chọn **cùng vùng với database**: **Southeast Asia (Singapore)**. Lý do: mỗi lần bấm "Tham gia", vote hay duyệt điểm, ứng dụng chạy vài truy vấn nối tiếp nhau trong một giao dịch có khoá dòng. Cùng vùng thì mỗi truy vấn mất ~1 ms; khác vùng (vd ứng dụng ở Mỹ, database ở Singapore) thì mỗi truy vấn mất ~200 ms, một lần bấm thành cả giây, khoá bị giữ lâu nên người bấm sau phải chờ — lúc cả hội cùng bấm có thể quá giờ chờ và báo lỗi.
4. Lần build đầu sẽ **thất bại** vì chưa có biến môi trường — bình thường, làm tiếp bước dưới.

### 6.2 Địa chỉ web

1. **Settings → Networking → Public Networking → Generate Domain**. Khi được hỏi cổng, nhập **3000**. Railway cho một địa chỉ dạng `https://ggd-hub-production.up.railway.app`.
2. Địa chỉ đó (không có `/` cuối) là `PUBLIC_URL`. Quay lại Discord Developer Portal → OAuth2 → **Redirects** → thêm `PUBLIC_URL/auth/callback` (mục 2.1, bước 3).
3. **Không** bật *TCP Proxy* và không mở cổng nào khác cho dịch vụ này: mọi truy cập phải đi qua proxy HTTPS của Railway. Đi tắt sẽ làm hỏng cookie đăng nhập (chỉ gửi qua HTTPS) và làm giới hạn tốc độ không nhận đúng IP người dùng.

### 6.3 Biến môi trường

Tab **Variables** → **RAW Editor** → dán toàn bộ khối sau, thay giá trị thật từ mục 2–5 → **Update Variables**:

```
PORT=3000
PUBLIC_URL=https://ggd-hub-production.up.railway.app
SESSION_SECRET=<chuỗi ngẫu nhiên ít nhất 32 ký tự>
TRUST_PROXY_HOPS=1

DATABASE_URL=${{Postgres.DATABASE_URL}}

DISCORD_TOKEN=...
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...
DISCORD_GUILD_ID=...
DISCORD_SCHEDULE_CHANNEL_ID=...
DISCORD_VOTE_CHANNEL_ID=...
DISCORD_ANNOUNCE_CHANNEL_ID=...
DISCORD_HIGHLIGHT_CHANNEL_ID=
DISCORD_ADMIN_ROLE_IDS=...
DISCORD_MOD_ROLE_IDS=...

BREVO_API_KEY=...
MAIL_FROM=GGD Hub <...@gmail.com>
```

- `DISCORD_HIGHLIGHT_CHANNEL_ID` **không bắt buộc**: ID kênh `#highlight` (mục 3). Để trống hoặc bỏ dòng này thì tắt tính năng kèm highlight khi khai điểm.
- `BREVO_API_KEY` và `MAIL_FROM`: mục 4.1. **Không** dùng SMTP (Gmail) trên Railway gói Hobby: Railway chặn SMTP ra ngoài, mọi email nhắc giờ sẽ lỗi (hết giờ chờ kết nối).
- `SESSION_SECRET` là khoá ký cookie đăng nhập: chuỗi ngẫu nhiên bất kỳ, **ít nhất 32 ký tự**, không ai cần nhớ. Tạo nhanh nếu máy có Node.js: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Đổi khoá này sẽ đăng xuất mọi người.
- `DATABASE_URL=${{Postgres.DATABASE_URL}}`: gõ **nguyên văn** như vậy (tham chiếu tới dịch vụ `Postgres` ở mục 5.1). Dùng Neon (mục 5.2) thì thay bằng chuỗi direct `…?sslmode=require` của Neon.
- `TRUST_PROXY_HOPS=1`: trước ứng dụng có đúng một lớp proxy (của Railway). Nếu sau này đặt thêm Cloudflare hay CDN khác phía trước, tăng lên `2`. Để sai số này, giới hạn tốc độ sẽ đếm nhầm (mọi người chung một IP → ai cũng bị "Bạn thao tác quá nhanh", hoặc ngược lại ai cũng né được). Sau lần deploy đầu, **kiểm tra** số này bằng log (mục 1 của `docs/manual-test-checklist.md`).
- **Không** đặt `DEV_LOGIN` trên Railway (và kể cả đặt, ứng dụng chỉ chấp nhận khi `PUBLIC_URL` bắt đầu bằng `http://localhost`).

### 6.4 Kiểm tra sức khoẻ và khởi động lại

**Settings → Deploy**:

- **Healthcheck Path**: `/healthz`. Ứng dụng trả `{"ok":true,"discord":"ready"}` khi bot đang nối Discord, `{"ok":true,"discord":"down"}` khi bot mất kết nối. Cả hai đều là mã 200 — Discord sập thì web và nhắc email vẫn phải chạy, Railway không được khởi động lại web vì Discord.
- **Healthcheck Timeout**: `300` giây — lần khởi động đầu còn chạy migration và nạp dữ liệu.
- **Restart Policy**: *On Failure*.
- **Replicas phải là `1`** (một vùng, một bản). **Không** chạy hai bản cùng lúc:
  - mỗi bản mở một phiên kết nối Discord (gateway) riêng, nên cả hai cùng nhận sự kiện "có người vào server" → **DM chào mừng gửi hai lần**;
  - hàng đợi gửi tin Discord nằm trong bộ nhớ của từng tiến trình, hai bản không biết nhau → tin buổi chơi, menu vote, thông báo kết quả có thể **bị đăng hai lần** hoặc sửa đè nhau;
  - giới hạn tốc độ (120 yêu cầu/phút mỗi IP) đếm riêng trong từng bản.

  Khoá thuê của bộ hẹn giờ chỉ bảo vệ **bộ hẹn giờ** (lúc deploy, bản cũ và bản mới chạy chồng nhau vài giây), không bảo vệ những phần trên.

### 6.5 Lần khởi động đầu

**Deployments → bản mới nhất → View Logs**. Thứ tự đúng:

1. Build: `npm ci`, `npm run build` (vài phút).
2. `prisma migrate deploy` — "N migrations found… applied".
3. `Đã nạp dữ liệu tham chiếu.`
4. `Đang chạy tại cổng 3000`
5. `[bot] Đã đăng nhập Discord với tên GGD Hub#1234`, `[bot] Đã đăng ký 3 lệnh slash cho server …`, `Bot Discord đã kết nối`.

Mở `PUBLIC_URL` → trang **Đăng nhập bằng Discord** → đăng nhập bằng tài khoản có role admin → thấy trang **Hôm nay** và mục **Quản trị** trên thanh menu.

**Trước khi mời cả hội — bắt buộc:** trỏ ứng dụng vào một **server Discord thử** và chạy hết `docs/manual-test-checklist.md`. Đây là lần đầu tiên bot, nút, menu vote, lệnh slash và đăng nhập Discord chạy với Discord thật (test tự động chỉ dùng bản giả). Chỉ khi mọi mục đạt mới đổi các biến `DISCORD_*` sang server của hội.

Mỗi lần bạn (hoặc người sửa code) đẩy commit mới lên nhánh mà Railway theo dõi, Railway tự build và deploy lại; migration mới (nếu có) tự chạy trước khi web mở cổng.

---

## 6B. Phương án khác: deploy lên Render

Dùng khi không có Railway (vd Railway tạm khoá đăng ký tài khoản mới). File `render.yaml` ở gốc repo là một **Blueprint**: Render đọc nó để tự tạo cả dịch vụ web (build từ `Dockerfile`) lẫn PostgreSQL 16, cùng vùng **Singapore**, đúng 1 bản chạy, kiểm tra sức khoẻ ở `/healthz`.

- **Chi phí** (bảng giá Render 10/2026): web `0.5c-512mb` 7 USD/tháng + PostgreSQL `0.1c-256mb` (1 GB) 6 USD/tháng. **Không** dùng gói miễn phí: web miễn phí tự "ngủ" khi không ai vào (bot Discord và nhắc giờ ngừng), PostgreSQL miễn phí bị xoá sau 30 ngày.
- **Email:** dùng Brevo (mục 4.1) như trên Railway.
- **Database** chỉ nhận kết nối từ mạng nội bộ của Render (`ipAllowList: []`). Muốn `pg_dump` từ máy thì thêm IP của bạn ở tab **Networking** của database.

Các bước:

1. Đẩy repo lên GitHub (nhánh có file `render.yaml`).
2. Mở <https://dashboard.render.com/blueprint/new> → chọn repo → chọn **nhánh** muốn deploy → Render đọc `render.yaml` và liệt kê dịch vụ `ggd-hub` + database `ggd-db`.
3. Render hỏi giá trị cho các biến đánh dấu `sync: false` — điền như mục 6.3: `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_GUILD_ID`, 4 ID kênh (trong đó `DISCORD_HIGHLIGHT_CHANNEL_ID` không bắt buộc — để trống nếu không dùng highlight), `DISCORD_ADMIN_ROLE_IDS`, `DISCORD_MOD_ROLE_IDS`, `BREVO_API_KEY`, `MAIL_FROM`. **Không** cần điền:
   - `DATABASE_URL` — Render tự nối tới `ggd-db`;
   - `SESSION_SECRET` — Render tự sinh chuỗi ngẫu nhiên;
   - `PUBLIC_URL` — ứng dụng tự dùng địa chỉ `https://….onrender.com` mà Render cấp (biến `RENDER_EXTERNAL_URL`). Gắn tên miền riêng thì thêm `PUBLIC_URL` trong tab **Environment** của dịch vụ.
4. **Apply** → chờ build xong (vài phút). Lần đầu ứng dụng tự tạo bảng và nạp dữ liệu (log giống mục 6.5).
5. Lấy địa chỉ `https://….onrender.com` ở đầu trang dịch vụ `ggd-hub` → Discord Developer Portal → OAuth2 → **Redirects** → thêm `https://….onrender.com/auth/callback`.
6. Kiểm tra: mở `https://….onrender.com/healthz` → `{"ok":true,"discord":"ready"}`; rồi chạy `docs/manual-test-checklist.md` như mục 6.5.

Mỗi lần đẩy commit lên nhánh đã chọn, Render tự build và deploy lại. Biến `sync: false` chỉ được hỏi **lần tạo đầu**; về sau sửa ở tab **Environment** của dịch vụ.

---

## 6C. Phương án khác: máy chủ Ubuntu riêng (Google Cloud hoặc AWS Lightsail)

Một máy chủ ảo Linux (Debian 13 hoặc Ubuntu 24.04) chạy mọi thứ bằng Docker Compose (thư mục `deploy/server/`):

- **Caddy** — nhận HTTPS ở cổng 443, tự xin và gia hạn chứng chỉ miễn phí. Địa chỉ web mặc định dạng `https://34-82-10-20.sslip.io` (IP tĩnh của máy, không cần mua tên miền).
- **Ứng dụng** — build từ `Dockerfile`, mỗi lần khởi động tự migrate và nạp dữ liệu tham chiếu.
- **PostgreSQL 16** — chỉ chạy trong máy, không mở ra Internet.
- **Sao lưu** — mỗi ngày một bản `pg_dump` vào `deploy/server/backups/`, giữ 14 ngày.

Khác Railway/Render, máy chủ này **bạn tự quản**: cập nhật code bằng một lệnh, thỉnh thoảng xem dung lượng ổ đĩa và bản sao lưu (mục 6C.4).

**Chọn nơi đặt máy** (bảng giá 10/2026):

| | Google Cloud — máy e2-micro (mục 6C.1) | AWS Lightsail (mục 6C.2) |
|---|---|---|
| Chi phí hằng tháng | Máy **miễn phí** (Free Tier); địa chỉ IPv4 công khai **~3,6 USD**; vượt 1 GB dữ liệu gửi đi thì ~0,12 USD/GB | **7 USD** (đã gồm IPv4 và 2 TB dữ liệu) |
| Lúc mới tạo tài khoản | 300 USD tín dụng, dùng trong 90 ngày | 100–200 USD tín dụng, dùng trong 6 tháng |
| Vị trí | Chỉ ở Mỹ — chọn Oregon (`us-west1`), gần Việt Nam nhất; mỗi lần bấm chậm thêm khoảng 0,2 giây | Singapore |
| Sức máy | 1 GB RAM, CPU yếu (khoảng 1/4 nhân chạy liên tục) — build lần đầu **15–30 phút** | 1 GB RAM, 2 vCPU — build **5–10 phút** |

### 6C.1 Tạo máy trên Google Cloud (e2-micro miễn phí)

1. **Tài khoản:** <https://cloud.google.com/free> → **Get started for free** → đăng nhập Google → nhập thẻ (chỉ để xác minh; trong 90 ngày dùng thử không bị trừ tiền) → nhận 300 USD tín dụng.
2. **Project và Compute Engine:** tạo project (vd `ggd-hub`) nếu được hỏi → menu ☰ → **Compute Engine** → **VM instances** → bấm **Enable** để bật Compute Engine API (chờ 1–2 phút).
3. **Cảnh báo chi phí** (nên làm): menu ☰ → **Billing** → **Budgets & alerts** → **Create budget** → 5 USD/tháng → Google gửi email khi chi phí sắp vượt.
4. **Tạo máy:** **VM instances** → **Create instance**:
   - **Name:** `ggd-hub`.
   - **Region:** `us-west1 (Oregon)`; **Zone:** để mặc định.
   - **Machine configuration:** series **E2** → machine type **`e2-micro`** (đúng loại này mới miễn phí).
   - **OS and storage** (*Boot disk*) → **Change** → hệ điều hành để mặc định **Debian 13** hoặc chọn **Ubuntu 24.04 LTS** (bản **x86/64**, không chọn bản *Minimal*) — cả hai đều chạy được → **Boot disk type:** **Standard persistent disk** → **Size:** **30 GB** → **Select**. Phải đổi khỏi loại *Balanced* mặc định: chỉ ổ *Standard* tới 30 GB mới miễn phí.
   - **Networking** → **Firewall:** tick **Allow HTTP traffic** và **Allow HTTPS traffic**.
   - Bấm **Create**.
5. **IP tĩnh:** menu ☰ → **VPC network** → **IP addresses** → dòng địa chỉ *External* của `ggd-hub` → **⋮** → **Promote to static IP address** → tên `ggd-hub-ip` → **Reserve**. Làm **trước** mục 6C.3, vì địa chỉ web được tạo từ IP này. Giá giữ nguyên (~3,6 USD/tháng khi gắn vào máy). Nếu sau này **xoá máy**, nhớ **Release** luôn IP tĩnh — IP giữ mà không gắn vào máy bị tính giá cao hơn.
6. **Mở cửa sổ lệnh:** **Compute Engine** → **VM instances** → nút **SSH** trên dòng `ggd-hub` → mở cửa sổ terminal trong trình duyệt (lần đầu bấm **Authorize**). Dán bằng `Ctrl+V`.
7. ⚠️ **Trước khi hết 90 ngày dùng thử:** menu ☰ → **Billing** → **Activate full account** (nâng cấp lên tài khoản trả phí), nếu không máy bị dừng khi hết thời gian dùng thử. Máy e2-micro vẫn miễn phí sau khi nâng cấp; bạn chỉ trả tiền IPv4 và phần vượt hạn mức.

Tiếp theo: mục 6C.3.

### 6C.2 Tạo máy trên AWS Lightsail

1. **Tài khoản AWS:** <https://aws.amazon.com> → **Create an AWS account** (cần thẻ thanh toán và xác minh số điện thoại). ⚠️ Tài khoản ở **gói Free tự đóng sau 6 tháng** (hoặc khi hết tín dụng), máy chủ tắt theo. Muốn chạy tiếp, **chuyển sang gói Paid trước hạn**: góc phải trên AWS Console → tên tài khoản → **Billing and Cost Management** → nâng cấp gói (*Upgrade plan*).
2. **Tạo máy:** <https://lightsail.aws.amazon.com> → **Create instance**:
   - **Region:** *Singapore* (`ap-southeast-1`).
   - **Platform:** *Linux/Unix* → **Blueprint:** *OS Only* → **Ubuntu 24.04 LTS**.
   - **Plan:** *General purpose* **7 USD** (1 GB RAM). **Không** chọn gói 5 USD (0,5 GB): không đủ bộ nhớ để build.
   - **Tên:** `ggd-hub` → **Create instance**.
3. **IP tĩnh** (miễn phí khi gắn vào máy): trang chủ Lightsail → tab **Networking** → **Create static IP** → gắn vào `ggd-hub`. Làm **trước** mục 6C.3.
4. **Mở cổng HTTPS:** bấm vào máy `ggd-hub` → tab **Networking** → **IPv4 Firewall** → **Add rule** → *HTTPS* (443) → **Create**. (Cổng SSH 22 và HTTP 80 đã mở sẵn.)
5. **Mở cửa sổ lệnh:** tab **Connect** → **Connect using SSH**. Dán vào terminal: bấm biểu tượng clipboard ở góc dưới bên phải, dán văn bản vào ô đó, rồi bấm chuột phải trong terminal.

Tiếp theo: mục 6C.3.

### 6C.3 Cài đặt và chạy (giống nhau cho cả hai)

1. **Tải code và chuẩn bị máy** — dán từng dòng vào terminal:

   ```
   sudo apt-get update && sudo apt-get install -y git
   git clone -b feat/ggd-hub-v1 https://github.com/kediandem1604/VuaVitGaming.git ggd-hub
   cd ggd-hub
   bash deploy/server/setup.sh
   ```

   `setup.sh` cài Docker, tạo 2 GB swap, tạo file `deploy/server/.env` và **tự điền** địa chỉ web, mật khẩu database, `SESSION_SECRET` (ngẫu nhiên, sinh ngay trên máy). Cuối cùng nó in ra địa chỉ web `https://….sslip.io`.

2. **Điền Discord và email:**

   ```
   nano deploy/server/.env
   ```

   Điền `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_GUILD_ID` (mục 2–3), `BREVO_API_KEY` và `MAIL_FROM` (mục 4.1). Đã có sẵn kênh thì điền luôn ID kênh (ba kênh bắt buộc, `#highlight` nếu dùng) và ID role admin/mod (mục 3) rồi sang bước 4. Không sửa `SITE_ADDRESS`, `POSTGRES_PASSWORD`, `SESSION_SECRET`. Lưu: `Ctrl+O`, `Enter`; thoát: `Ctrl+X`.

3. **Để bot tự tạo kênh** (bỏ qua nếu đã điền ID kênh). Bot phải có quyền **Manage Channels** và **Attach Files** (mục 2.2):

   ```
   bash deploy/server/discord-setup.sh
   ```

   Script build ảnh ứng dụng (lần đầu lâu, `update.sh` dùng lại), rồi bot tạo nhóm kênh **GGD Hub** gồm `#lịch-chơi`, `#vote-mvp`, `#thông-báo`, `#highlight` — thành viên xem được nhưng không nhắn, chỉ bot đăng tin (nút Tham gia và menu vote vẫn bấm được; `#highlight` nhận video/ảnh thành viên kèm khi khai điểm) — và **tự ghi bốn ID kênh vào `.env`**. Chạy lại không tạo trùng: kênh đã có ID trong `.env` được giữ nguyên, kênh cùng tên được dùng lại; đổi tên kênh hay nhóm trong Discord sau đó không ảnh hưởng gì. Cuối cùng script in danh sách role của server kèm ID: chép ID role admin/mod vào `DISCORD_ADMIN_ROLE_IDS` và `DISCORD_MOD_ROLE_IDS` (`nano deploy/server/.env`).

4. **Chạy:**

   ```
   bash deploy/server/update.sh
   ```

   Script kiểm tra `.env` đã đủ biến (thiếu thì báo tên biến và dừng), rồi build và khởi động. Lần đầu mất 5–10 phút trên Lightsail, 15–30 phút trên e2-micro của Google Cloud. Cửa sổ SSH bị ngắt giữa chừng thì mở lại và chạy lại lệnh này.

5. **Kiểm tra:** mở `https://….sslip.io/healthz` → `{"ok":true,"discord":"ready"}` (lần đầu Caddy cần khoảng 1 phút để lấy chứng chỉ). Vào Discord Developer Portal → OAuth2 → **Redirects** → thêm `https://….sslip.io/auth/callback`. Rồi chạy `docs/manual-test-checklist.md` như mục 6.5.

### 6C.4 Hằng ngày và bảo trì

Mọi lệnh chạy trong terminal SSH của máy, từ thư mục `~/ggd-hub`.

- **Cập nhật lên code mới nhất** của nhánh: `bash deploy/server/update.sh` (dữ liệu và chứng chỉ không mất).
- **Thêm kênh `#highlight` cho máy đã chạy bản cũ** (chỉ có ba kênh): trước khi chạy lại script, Server Settings → Roles → role của bot → bật **Manage Channels** (nếu đã tắt sau lần tạo kênh đầu — chạy xong lại tắt được) và **Attach Files** (hoặc mời lại bot bằng link thứ hai ở mục 2.2). Rồi chạy lần lượt `git pull`, `bash deploy/server/discord-setup.sh`, `bash deploy/server/update.sh`. Script giữ nguyên ID ba kênh đang có trong `.env` (kể cả khi đã đổi tên kênh hay nhóm, hoặc ID tự điền tay), chỉ tạo thêm `#highlight` và ghi ID của nó vào `.env`. Không muốn dùng highlight thì chỉ cần `update.sh` như thường — biến `DISCORD_HIGHLIGHT_CHANNEL_ID` không bắt buộc.
- **Xem log ứng dụng:** `cd deploy/server && sudo docker compose logs -f app` (`Ctrl+C` để thoát).
- **Trạng thái:** `cd deploy/server && sudo docker compose ps`.
- **Dung lượng ổ đĩa:** `df -h /` — ảnh Docker cũ được dọn sau mỗi lần cập nhật; log mỗi dịch vụ giới hạn 30 MB.
- **Sao lưu** nằm cùng ổ đĩa với database, nên mất máy là mất luôn bản sao lưu. Nên bật thêm bản chụp ổ đĩa tự động (khoảng 0,05 USD/GB/tháng): Google Cloud → **Compute Engine** → **Snapshots** → **Create snapshot schedule** rồi gắn vào ổ của `ggd-hub`; Lightsail → máy `ggd-hub` → tab **Snapshots** → **Automatic snapshots**. Thỉnh thoảng tải một bản `.sql.gz` về máy của bạn.
- **Khôi phục từ một bản sao lưu** (xoá dữ liệu hiện tại, thay bằng bản sao lưu):

  ```
  cd ~/ggd-hub/deploy/server
  sudo docker compose stop app
  sudo docker compose exec -T db psql -U ggd -d ggd -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
  gunzip -c backups/ggd-2026-10-24.sql.gz | sudo docker compose exec -T db psql -U ggd -d ggd -v ON_ERROR_STOP=1 -q
  sudo docker compose start app
  ```

- **Bản vá Ubuntu:** bản vá bảo mật tự cài hằng ngày. Thỉnh thoảng chạy `sudo apt update && sudo apt upgrade -y && sudo reboot`; sau khi khởi động lại, các container tự chạy lại.
- **Dùng tên miền riêng:** trỏ bản ghi `A` của tên miền về IP tĩnh, sửa `SITE_ADDRESS=` trong `.env` thành tên miền (không có `https://`), chạy `update.sh`, rồi cập nhật Redirects bên Discord.

---

## 7. Chạy ở máy (dành cho người sửa code)

```bash
git clone <repo> ggd-hub
cd ggd-hub
npm install                 # tải cả PostgreSQL nhúng dự phòng (lần đầu hơi lâu)
cp .env.example .env        # Windows: copy .env.example .env
```

Mở `.env`, điền các biến (xem mục 9). Chưa có bot/Gmail thật mà chỉ muốn xem web thì điền giá trị bất kỳ (vd `x`) cho các biến Discord và SMTP: lúc chạy, bot sẽ báo *Không kết nối được Discord* nhưng web vẫn lên.

Mở Docker Desktop, rồi cần **hai cửa sổ terminal**:

| Cửa sổ | Lệnh | Việc |
|---|---|---|
| 1 (một lần) | `npm run db:start` | Bật PostgreSQL dev trong Docker ở `postgresql://ggd:ggd@localhost:54329/ggd_dev` (container `db`, dữ liệu giữ trong volume `ggd-pgdata`). Lệnh trả về ngay khi database sẵn sàng (chờ tối đa 120 giây, quá thì báo lỗi); container chạy nền tới khi `npm run db:stop` hoặc tắt Docker Desktop. Lần đầu tải ảnh `postgres:16-alpine` (~100 MB). |
| 1 (một lần) | `npm run db:migrate` rồi `npm run db:seed` | Tạo bảng, nạp dữ liệu tham chiếu. Chạy lại không sinh trùng. |
| 1 (tuỳ chọn) | `npm run db:demo` | Nạp **dữ liệu mẫu** để xem giao diện: 12 thành viên `demo-*` (`demo-admin` là admin), buổi chơi hôm nay, một đợt vote đã đóng có kết quả, điểm role đã duyệt cho đủ ba phe. Chạy lại bao nhiêu lần cũng được (dữ liệu mẫu được dọn rồi tạo lại cho đúng ngày hôm nay); từ chối chạy nếu `DATABASE_URL` không trỏ vào `localhost`. |
| 1 | `npm run dev:server` | API + bot + bộ hẹn giờ ở cổng 3000, tự nạp lại khi sửa code server. |
| 2 | `npm run dev:web` | Giao diện React (Vite) ở <http://localhost:5173>, có hot reload; `/api` và `/auth` được chuyển tiếp sang cổng 3000. |

Không có Docker: thay `npm run db:start` bằng `npm run db:start:embedded` (PostgreSQL nhúng, cùng chuỗi kết nối) — lệnh này chiếm cửa sổ terminal, `Ctrl+C` để dừng.

Các container thuộc dự án compose tên cố định **`ggd-hub`** (`name:` trong `docker-compose.yml`), nên mọi bản checkout của repo trên máy (kể cả worktree) dùng chung một bộ `db` / `db-test` và một volume dữ liệu dev, không tranh nhau cổng. Máy đã từng chạy bản trước khi có tên này thì container cũ mang tên dự án theo thư mục (vd `goosegooseduck-db-1`): dừng bằng `docker compose -p goosegooseduck stop`, rồi `npm run db:start` và chạy lại bước migration + `db:seed` / `db:demo` ở trên (volume mới bắt đầu trống). Khi không cần nữa, gỡ container cũ bằng `docker compose -p goosegooseduck down` — thêm `-v` chỉ khi không còn cần dữ liệu dev cũ (lệnh đó xoá luôn volume `goosegooseduck_ggd-pgdata`).

Đăng nhập khi chạy ở máy — chọn một trong hai:

- **Đăng nhập nhanh không qua Discord** (`DEV_LOGIN`): trong `.env` đặt `DEV_LOGIN=1` và `PUBLIC_URL=http://localhost:3000`, rồi mở `http://localhost:5173/auth/dev-login?discordId=<Discord ID của một thành viên đã có trong database>`. Đã chạy `npm run db:demo` thì dùng `http://localhost:5173/auth/dev-login?discordId=demo-admin` (admin) hoặc `discordId=demo-mod` (mod). Chỉ hoạt động khi `PUBLIC_URL` bắt đầu bằng `http://localhost`, và chỉ với thành viên **đã có hồ sơ** `active`: dữ liệu mẫu, bot thật đồng bộ từ server thử, hoặc tự thêm một dòng vào bảng `members` bằng `npx prisma studio` (điền `discordId`, `displayName`, `memberCode` dạng `GGD-0001`, `status = active`, `accessLevel = admin`).
- **Đăng nhập Discord thật qua Vite**: đặt `PUBLIC_URL=http://localhost:5173` và thêm `http://localhost:5173/auth/callback` vào Redirects của ứng dụng Discord (mục 2.1). Bot phải đang chạy với token thật để hồ sơ của bạn tồn tại.

Chạy giống production ở máy — hai cách:

- `npm run build` rồi `npm start` → mọi thứ ở <http://localhost:3000> (`npm start` cũng tự chạy migration và nạp dữ liệu như trên Railway).
- `npm run app:docker` → build ảnh từ `Dockerfile` (đúng ảnh Railway sẽ chạy) và chạy container `app` ở <http://localhost:3000>, đọc biến từ `.env` nhưng tự trỏ `DATABASE_URL` vào container `db`. Dùng file env khác: `GGD_ENV_FILE=duong/dan/.env.khac npm run app:docker` (PowerShell: `$env:GGD_ENV_FILE='…'; npm run app:docker`). `Ctrl+C` để dừng; `docker compose --profile app down` để gỡ container (lệnh này gỡ cả `db` / `db-test`, dữ liệu dev vẫn còn trong volume — `npm run db:start` bật lại).

Các lệnh khác: `npm run db:stop` (dừng hai container database), `npm run typecheck` (kiểm tra kiểu TypeScript cho cả server và web), `npx prisma studio` (xem/sửa dữ liệu trong trình duyệt).

---

## 8. Chạy test

```bash
npm test
```

- Vitest tự chạy `docker compose up -d --wait db-test`: một PostgreSQL **riêng** cho test ở cổng `54330`, dữ liệu trong RAM (mất khi container dừng — đúng ý), rồi áp dụng migration. Container để chạy tiếp sau khi test xong cho lượt sau nhanh hơn; `npm run db:stop` để dừng. **Không cần `npm run db:start`** (chạy song song với DB dev cũng được vì khác cổng). Docker Desktop chưa mở thì test dừng ngay với hướng dẫn.
- Không có Docker: `GGD_TEST_DB=embedded npm test` (PowerShell: `$env:GGD_TEST_DB='embedded'; npm test`) dùng PostgreSQL nhúng ở cùng cổng `54330` (thư mục dữ liệu `pgdata-test`), chạy xong thì tắt. Hai cách không chạy cùng lúc được (chung cổng): đang có container `db-test` thì `npm run db:stop` trước.
- Test server chạy tuần tự trên một database (mỗi test xoá sạch và nạp lại dữ liệu mẫu), nên toàn bộ mất vài phút. Test web (React) chạy trong jsdom.
- Chạy một file: `npx vitest run tests/server/web/health.test.ts --project server`.
- `npm run typecheck` để kiểm tra kiểu.
- **CI trên GitHub**: `.github/workflows/ci.yml` chạy `npm ci`, `npm run typecheck`, `npm test` (máy Ubuntu của GitHub có sẵn Docker nên `db-test` tự bật như ở máy) và `docker build .` (Node 24) cho mỗi lần push và pull request — bắt đầu chạy khi repo đã nằm trên GitHub (xem tab **Actions**).

---

## 9. Bảng biến môi trường

Mẫu đầy đủ ở `.env.example`. Tất cả đều **bắt buộc** trừ khi ghi khác; thiếu hay sai thì ứng dụng dừng ngay lúc khởi động với dòng `Cấu hình môi trường không hợp lệ — <tên biến>: <lý do>`.

| Biến | Ý nghĩa | Ví dụ / mặc định |
|---|---|---|
| `PORT` | Cổng web lắng nghe | `3000` (mặc định nếu bỏ trống) |
| `PUBLIC_URL` | Địa chỉ web công khai, không `/` cuối — dùng cho OAuth và link trong tin nhắn/email. Trên Render có thể để trống: ứng dụng dùng `RENDER_EXTERNAL_URL` do Render cấp | `https://ggd-hub-production.up.railway.app` |
| `SESSION_SECRET` | Khoá ký cookie đăng nhập, ≥ 32 ký tự | chuỗi ngẫu nhiên |
| `TRUST_PROXY_HOPS` | Số lớp proxy phía trước app, để lấy đúng IP người dùng cho giới hạn tốc độ | `1` (mặc định); `2` nếu có CDN trước Railway |
| `DEV_LOGIN` | *Chỉ dev.* `1` bật `/auth/dev-login`; chỉ có tác dụng khi `PUBLIC_URL` bắt đầu bằng `http://localhost` | `0` / không đặt |
| `DATABASE_URL` | Chuỗi kết nối PostgreSQL | Railway: `${{Postgres.DATABASE_URL}}`; Neon: chuỗi direct `…?sslmode=require`; dev: `postgresql://ggd:ggd@localhost:54329/ggd_dev` |
| `DISCORD_TOKEN` | Token bot (tab Bot) | |
| `DISCORD_CLIENT_ID` | Application ID | |
| `DISCORD_CLIENT_SECRET` | Client Secret (tab OAuth2) | |
| `DISCORD_GUILD_ID` | ID server Discord của hội | |
| `DISCORD_SCHEDULE_CHANNEL_ID` | Kênh bot đăng buổi chơi | |
| `DISCORD_VOTE_CHANNEL_ID` | Kênh bot đăng tin vote MVP | |
| `DISCORD_ANNOUNCE_CHANNEL_ID` | Kênh bot đăng kết quả, 👑, tổng kết mùa | |
| `DISCORD_HIGHLIGHT_CHANNEL_ID` | Kênh bot đăng highlight thành viên kèm khi khai điểm — *không bắt buộc*; trống hoặc không đặt = tắt highlight (form khai điểm không có ô highlight) | để trống |
| `DISCORD_ADMIN_ROLE_IDS` | ID các role được coi là admin, ngăn bằng dấu phẩy | có thể để trống (không ai là admin) |
| `DISCORD_MOD_ROLE_IDS` | ID các role được coi là mod, ngăn bằng dấu phẩy | có thể để trống |
| `BREVO_API_KEY` | Khoá API Brevo (mục 4.1). Có thì gửi email qua Brevo và không cần các biến `SMTP_*` | `xkeysib-…`; bắt buộc trên Railway gói Free/Hobby |
| `SMTP_HOST` | Máy chủ SMTP — *chỉ khi không đặt `BREVO_API_KEY`* | `smtp.gmail.com` |
| `SMTP_PORT` | Cổng SMTP — *chỉ khi không đặt `BREVO_API_KEY`* | `465` |
| `SMTP_USER` | Tài khoản SMTP (địa chỉ Gmail) — *chỉ khi không đặt `BREVO_API_KEY`* | |
| `SMTP_PASS` | Mật khẩu ứng dụng Gmail (16 chữ, bỏ dấu cách) — *chỉ khi không đặt `BREVO_API_KEY`* | |
| `MAIL_FROM` | Người gửi hiện trên email, dạng `Tên <email>`; dùng Brevo thì phải là địa chỉ đã xác minh | `GGD Hub <ggdhub.hoi@gmail.com>` |

---

## 10. Cách dùng hằng ngày

### Thành viên

- Vào server Discord → bot gửi **DM chào mừng** kèm **mã thành viên** (`GGD-0001`, `GGD-0002`… cấp một lần, không dùng lại) và link web. Rời server thì hồ sơ chuyển "đã rời" nhưng giữ lịch sử; quay lại giữ mã cũ.
- Web: **Đăng nhập bằng Discord** (chỉ người đang ở trong server). Lần đầu, email Discord đã xác minh được lưu vào hồ sơ; vào **Hồ sơ** để sửa email hoặc tắt/bật nhắc qua **email** / **DM**.
- Các trang: **Hôm nay** (buổi chơi, nút tham gia, Sảnh tri ân hôm nay — sáng sớm chưa có kết quả thì hiện sảnh gần nhất), **Đại sảnh hoá thân**, **Bảng xếp hạng**, **Tri ân** (lịch sử theo ngày: 30 ngày gần nhất có kết quả, ngày cũ hơn thì dùng ô **Chọn ngày khác**), **Khai điểm**, **Hồ sơ**. Mod/admin có thêm **Quản trị**.
- Lệnh slash trong server: `/baocao` khai điểm (gõ vài chữ tên role là có gợi ý, không cần dấu), `/bxh <role>` top 10 role tháng này, `/hoso` mã thành viên + role đang giữ + link web.

### Một buổi chơi, từ đầu đến cuối (admin/mod)

1. **Tạo buổi**: web → **Quản trị → Buổi chơi**: ngày, giờ (giờ Việt Nam), chế độ chơi, sức chứa (mặc định 16, tối đa 25), mã phòng (không bắt buộc, hiện trong nhắc đúng giờ), ghi chú. Bot đăng ngay vào kênh lịch chơi một tin có nút **Tham gia** / **Huỷ**.
2. **Thành viên tham gia**: bấm nút trên Discord hoặc nút trên trang **Hôm nay** — kết quả như nhau, tin Discord tự cập nhật số người và danh sách. Đủ người thì nút đổi thành **Đã đủ người**.
3. **Nhắc giờ** (tự động): trước giờ bắt đầu 15 phút và đúng giờ (kèm mã phòng), gửi email + DM cho người đã tham gia theo kênh họ bật. Không bao giờ gửi trùng, kể cả khi server khởi động lại. Ai bị lỗi gửi (chặn DM, email sai) xem ở **Quản trị → Gửi lỗi**.
4. **Huỷ buổi** (nếu cần): **Quản trị → Buổi chơi → Huỷ buổi** → tin Discord đổi thành *Đã huỷ*, người đã đăng ký nhận DM.
5. **Kết thúc buổi**: **Quản trị → Buổi chơi → Kết thúc** → hộp chọn **hạng mục tri ân**: các hạng mục *luôn có* và *theo chế độ chơi* đã tick sẵn; hạng mục *tuỳ chọn* theo role (vd "Pha đẻ trứng lộ liễu nhất" của Cò gáy) tự tick nếu buổi đó có người ra role ấy. Quên kết thúc thì hệ thống tự kết thúc sau 4 giờ với các hạng mục tick sẵn. Buổi không có ai tham gia thì chỉ đóng, không mở vote.
6. **Vote trong Discord**: bot đăng vào kênh vote mỗi hạng mục một tin có menu chọn — chỉ liệt kê **người có mặt** buổi đó. Ai trong server cũng vote được, mỗi người một phiếu mỗi hạng mục (chọn lại là đổi phiếu), **không tự vote mình**. Phản hồi chỉ người bấm thấy.
7. **Đóng vote**: tự đóng sau 12 giờ, hoặc **Quản trị → Buổi chơi → Vote đang mở → Đóng vote sớm**. Bot thay menu bằng kết quả, đăng bảng kết quả vào kênh thông báo; web **Hôm nay** và **Tri ân** cập nhật. Hoà thì cùng nhận; không ai được phiếu thì để trống.

### Điểm role và Đại sảnh hoá thân

1. Người chơi **khai điểm** sau trận: web **Khai điểm** hoặc `/baocao`: role, số liệu (chỉ số riêng của role, vd "Số mạng đã giết", có giới hạn mỗi trận), ngày chơi (hôm nay lùi tối đa 3 ngày), buổi chơi (không bắt buộc), ghi chú. Tối đa 30 lần khai mỗi người mỗi ngày.
2. **Kèm highlight khi khai điểm** (không bắt buộc; chỉ khi đã đặt `DISCORD_HIGHLIGHT_CHANNEL_ID`): ô **Highlight** trên form web nhận video MP4/WebM/MOV hoặc ảnh PNG/JPG/GIF; bot đăng file vào kênh `#highlight` kèm tên người, role và số liệu. Mod thấy link **🎬 Xem highlight** khi duyệt; người khai xem lại ở **Lần khai của tôi** và có thể **Thêm / Đổi highlight** khi lần khai còn chờ duyệt. Dung lượng tối đa theo cấp boost của server Discord: **10 MB**, từ boost cấp 2 là **50 MB**. `/baocao` không kèm highlight được.
3. Mod/admin **duyệt**: **Quản trị → Duyệt điểm** → **Duyệt** hoặc **Từ chối** (phải ghi lý do; người khai nhận DM). Mod không tự duyệt lần khai của chính mình; admin thì được. Duyệt nhầm thì **Huỷ duyệt** ở mục **Đã duyệt gần đây** ngay bên dưới (phải ghi lý do; người khai nhận DM) — chỉ khi mùa của tháng đó chưa chốt (trước 00:05 ngày 4 tháng sau, giờ Việt Nam).
4. Điểm chỉ tính khi đã duyệt. Ai dẫn đầu một role trong tháng thì **hoá thân** role đó: nhân vật của role trên **Đại sảnh hoá thân** mang tên người ấy. Đổi người dẫn đầu → bot đăng `👑 <tên> đã hoá thân <role> mùa YYYY-MM!` vào kênh thông báo.
5. **Mùa** = một tháng theo giờ Việt Nam. **09:00 ngày 3** tháng sau, bot nhắc mod duyệt nốt hàng chờ của mùa cũ. **00:05 ngày 4**, mùa tự **chốt**: lần khai còn chờ của mùa đó bị từ chối ("mùa đã chốt"), người giữ mỗi role được lưu lại, bot đăng bảng tổng kết. Không phải làm gì bằng tay. Trận chơi cuối tháng mà duyệt đầu tháng sau vẫn tính cho mùa cũ (theo ngày chơi).

### Cài đặt (admin)

- **Quản trị → Cài đặt**: thời gian mở vote (1–72 giờ, mặc định 12), tự kết thúc buổi sau (1–24 giờ, mặc định 4), nhắc trước (5–120 phút, mặc định 15). Cuối tab là mục **Chế độ chơi**: sửa tên tiếng Việt của từng chế độ (tên Việt của dữ liệu mẫu chưa được xác minh hết) và bật/tắt — chế độ tắt không còn trong form tạo buổi, hạng mục và role; buổi cũ giữ nguyên.
- **Hạng mục**: thêm/sửa/ẩn hạng mục tri ân; phạm vi *luôn có* / *theo chế độ* / *tuỳ chọn*.
- **Role**: sửa phe, tên tiếng Việt, tên chỉ số, giới hạn mỗi trận, biểu tượng, bật/tắt; tải ảnh riêng cho role (PNG/JPG/WebP, tối đa 1 MB) thay nhân vật vẽ sẵn. Form **Thêm role** ở đầu tab khi game ra role mới (key cố định sau khi tạo; role riêng của một chế độ thì chọn chế độ đó).
- **Thành viên**: tìm theo tên/mã, lọc đang hoạt động / đã rời. Email chỉ admin (và chính chủ) thấy.

---

## 11. Giới hạn đã biết

- **Goose Goose Duck không có API số liệu trận đấu.** Mọi điểm role đều do người chơi tự khai và mod duyệt; hệ thống chỉ chặn được giá trị quá giới hạn mỗi trận, ngày chơi quá 3 ngày, mùa đã chốt, và 30 lần khai/ngày.
- **Thành viên chưa đăng nhập web lần nào thì chưa có email** → chỉ nhận nhắc qua DM Discord (không có dòng "gửi lỗi" nào cho email). Người tắt DM từ người lạ trong server cũng không nhận được DM — bot ghi lỗi vào **Gửi lỗi**, không thử lại.
- **Bot cần intent đặc quyền Server Members** (mục 2.1). Không bật thì bot không lên, nhưng web, API và nhắc email vẫn chạy; nút/menu/lệnh trong Discord không hoạt động cho tới khi bot nối lại.
- **Bot mất kết nối** (Discord lỗi, deploy lại): dữ liệu vẫn lưu đầy đủ; tin buổi chơi / tin vote chưa đăng được sẽ do bộ hẹn giờ đăng bù trong vòng một phút sau khi bot nối lại. Trong lúc đó thành viên vẫn tham gia và xem mọi thứ trên web.
- **Khởi động lại giữa giờ nhắc**: nhắc chưa gửi được gửi bù nếu chưa quá giờ bắt đầu 10 phút; quá thì bỏ (nhắc "vào game" lúc đó vô nghĩa).
- **Một server Discord** mỗi bản cài. Hội thứ hai cần một bản cài khác (ứng dụng Discord, database, dịch vụ Railway riêng).
- **Chỉ chạy một bản** (Railway Replicas = 1, mục 6.4): hai bản cùng lúc gửi trùng DM chào mừng và có thể đăng trùng tin Discord.
- **Neon gói miễn phí không dùng được**: bộ hẹn giờ truy vấn mỗi phút khiến compute không bao giờ ngủ, hạn mức giờ miễn phí hết giữa tháng (mục 5.2). Mặc định dùng PostgreSQL của Railway.
- **Giới hạn email mỗi ngày**: Brevo gói Free 300 email/ngày; Gmail qua SMTP ≈ 500/ngày. Mỗi người tham gia thường nhận 2 email mỗi buổi (còn 15 phút, vào game).
- **Ảnh role** lưu trong database (ổ đĩa Railway bị xoá mỗi lần deploy), nên giới hạn 1 MB mỗi ảnh. Ảnh gốc của game thuộc bản quyền Gaggle Studios; hệ thống dùng nhân vật tự vẽ, admin tự chịu trách nhiệm nếu tải ảnh game lên.
- Vote chỉ làm trong Discord (không vote trên web); chưa có biểu đồ thống kê; chưa có app điện thoại (web ưu tiên màn hình điện thoại).

---

## 12. Khi có sự cố

Luôn bắt đầu từ **Railway → Deployments → View Logs**. Mọi thông báo của ứng dụng đều bằng tiếng Việt; dòng bắt đầu bằng `[bot]` là của bot, `[scheduler]` là bộ hẹn giờ, `[main]` là tiến trình chính.

| Thấy gì | Nguyên nhân thường gặp | Làm gì |
|---|---|---|
| Build trên Railway thất bại ở `npm ci` / `npm run build` | Lỗi Dockerfile hoặc code không biên dịch được | Xem dòng lỗi trong log build; chạy `docker build .` (hoặc `npm run app:docker`) ở máy để tái hiện đúng ảnh Railway sẽ build |
| `Cấu hình môi trường không hợp lệ — DISCORD_TOKEN: thiếu biến` | Thiếu hoặc gõ sai tên biến | Sửa trong **Variables** (ứng dụng tự deploy lại) |
| `Không kết nối được Discord: Used disallowed intents` | Chưa bật Server Members Intent | Mục 2.1, bước 4 |
| `Không kết nối được Discord: An invalid token was provided` | Token sai / đã reset | Reset Token rồi cập nhật `DISCORD_TOKEN` |
| `prisma migrate deploy` báo `P1001: Can't reach database server` | Railway: `DATABASE_URL` không đúng `${{Postgres.DATABASE_URL}}`, tên dịch vụ database khác `Postgres`, ứng dụng và database không cùng project, hoặc dịch vụ `Postgres` đang dừng. Neon: chuỗi sai, thiếu `?sslmode=require`, hoặc project bị tạm dừng (hết giờ compute) | Railway: sửa tham chiếu trong **Variables**, xem dịch vụ `Postgres` còn chạy; Neon: kiểm tra chuỗi direct và mục **Usage** |
| Mỗi lần bấm Tham gia / vote mất cả giây | Ứng dụng và database khác vùng | Đặt cả hai dịch vụ cùng **Southeast Asia (Singapore)** (mục 6.1) |
| Email không đi, **Gửi lỗi** ghi `Brevo từ chối email (HTTP 401): unauthorized…` | `BREVO_API_KEY` sai hoặc đã bị xoá | Tạo khoá mới (mục 4.1, bước 3) rồi cập nhật **Variables** |
| Email không đi, **Gửi lỗi** ghi `Brevo từ chối email (HTTP 400)…` nhắc tới sender | `MAIL_FROM` chưa được xác minh trong Brevo, hoặc tài khoản Brevo chưa được kích hoạt gửi | Xác minh đúng địa chỉ đó (mục 4.1, bước 2); xem thông báo trong trang Brevo |
| Email không đi trên Railway, **Gửi lỗi** ghi `Connection timeout` / `ETIMEDOUT` | Đang gửi qua SMTP mà Railway (gói Free/Hobby) chặn SMTP | Chuyển sang Brevo (mục 4.1): đặt `BREVO_API_KEY` |
| Email không đi, **Gửi lỗi** ghi `535 … Username and Password not accepted` | (SMTP) Mật khẩu ứng dụng Gmail sai hoặc chưa bật xác minh 2 bước | Tạo lại mật khẩu ứng dụng (mục 4.2) |
| Đăng nhập web quay về trang đăng nhập với lỗi | `not_member`: người đó không ở trong server hoặc bot chưa đồng bộ hồ sơ (bot đang tắt); `state`/`oauth`: Redirect URL trong Discord không khớp `PUBLIC_URL/auth/callback` hoặc `DISCORD_CLIENT_SECRET` sai | Bật bot / mời người đó vào server; kiểm tra Redirects và secret |
| Healthcheck thất bại, deploy không bao giờ "Active" | Ứng dụng chưa mở cổng 3000 (xem log), hoặc Healthcheck Path không phải `/healthz` | Sửa theo mục 6.4; tăng Healthcheck Timeout |
| `/healthz` trả `"discord":"down"` lâu | Bot mất kết nối | Xem log dòng `[bot]`; Discord thường tự nối lại; không thì **Redeploy** |
| Log `[bot] Phiên Discord bị vô hiệu — thoát…` rồi ứng dụng khởi động lại | Discord huỷ phiên của bot (token bị reset, Discord bảo trì) — bot không tự nối lại được nên ứng dụng thoát mã 1 để Railway khởi động lại (cần **Restart Policy: On Failure**, mục 6.4) | Thường tự hết sau một lần khởi động lại; lặp lại liên tục thì kiểm tra `DISCORD_TOKEN` |
| Ai cũng bị "Bạn thao tác quá nhanh, thử lại sau" | `TRUST_PROXY_HOPS` sai nên mọi người chung một IP | Đặt đúng số lớp proxy (Railway: `1`; có Cloudflare: `2`) |
| Lệnh slash không hiện trong Discord | Bot chưa được mời với scope `applications.commands`, hoặc client Discord chưa làm tươi | Mời lại bot bằng link ở mục 2.2; nhấn `Ctrl+R` trong Discord |
| Bot không đăng được vào kênh | Bot không có quyền xem/gửi ở kênh đó | Thêm role bot vào quyền kênh (View Channels, Send Messages, Embed Links, Read Message History; `#highlight` thêm Attach Files) |

| Ai đó nhận DM chào mừng hai lần, tin Discord bị đăng đôi | Đang chạy hơn một bản | **Settings → Deploy → Replicas** về `1` (mục 6.4) |

Sự cố ở **máy phát triển** (mục 7–8):

| Thấy gì | Nguyên nhân thường gặp | Làm gì |
|---|---|---|
| Docker Desktop (Windows bản Insider) tắt ngay sau khi mở; log Docker có lỗi về file socket `dockerInference` | Tính năng **Docker Model Runner** tạo file socket trong `%LOCALAPPDATA%\Docker\run` và bản Windows này không chấp nhận | **Settings → AI → tắt Docker Model Runner** (dự án không dùng). Vẫn crash thì thoát hẳn Docker Desktop, đổi tên thư mục `%LOCALAPPDATA%\Docker\run` (vd thành `run.cu`) rồi mở lại — Docker tạo lại thư mục sạch |
| `npm test` dừng với `Không bật được PostgreSQL test bằng Docker` | Docker Desktop chưa mở hoặc treo quá 120 giây; hoặc cổng `54330` đang bị chiếm — bởi container `db-test` của một bản checkout khác còn dùng dự án compose cũ (tên theo thư mục), hoặc bởi PostgreSQL nhúng của lần chạy trước | Mở Docker Desktop rồi chạy lại. Cổng bị chiếm: `docker ps` để xem container nào giữ `54330`, rồi `npm run db:stop` ở bản checkout đó (hoặc `docker stop <tên>`); PostgreSQL nhúng thì đóng terminal đang chạy nó (Windows: tắt `postgres.exe` trong Task Manager). Hoặc dùng bản nhúng: `GGD_TEST_DB=embedded npm test` (mục 8). Lỗi gốc của Docker nằm cuối thông báo |
| `npm run db:start` báo cổng `54329` đã bị dùng | Container `db` của dự án compose cũ (mục 7), hoặc PostgreSQL nhúng (`db:start:embedded`) của lần trước còn chạy | `docker compose -p goosegooseduck stop` (thay bằng tên dự án cũ thấy trong `docker ps`); PostgreSQL nhúng thì đóng cửa sổ terminal đang chạy nó (hoặc tắt `postgres.exe`) rồi chạy lại |

Trước khi mời cả hội, **bắt buộc** chạy hết **`docs/manual-test-checklist.md`** trên một server Discord thử — phần Discord/đăng nhập thật chưa từng được chạy trước đó.
