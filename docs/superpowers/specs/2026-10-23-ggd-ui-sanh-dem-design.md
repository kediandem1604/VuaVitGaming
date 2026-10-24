# GGD Hub — Giao diện "Sảnh đêm" và chạy lại bằng Docker

- Ngày: 2026-10-23
- Trạng thái: Chờ duyệt
- Nhánh: `feat/ui-sanh-dem` (tách từ `feat/ggd-hub-v1`)
- Liên quan: spec gốc `2026-10-22-ggd-hub-design.md`. Spec này **thay phần hình nhân vật ở §4.8** (thân không còn tô màu phe) và thay cách chạy database ở local/test (§10–§11). Mọi phần khác của spec gốc giữ nguyên.

## 1. Mục tiêu

1. Giao diện web nhìn **bắt mắt và giống game Goose Goose Duck**: nền đêm như menu trong game, chữ tròn đậm, nút nổi khối, viền dày.
2. Nhân vật hoá thân **giống ngỗng trong game**: thân trắng, viền đậm, mắt tròn đen, mỏ và chân cam, đội đồ theo role.
3. Làm lại **mọi trang**: Đăng nhập, Hôm nay, Đại sảnh, Xếp hạng, Tri ân, Khai điểm, Hồ sơ, Quản trị. Thêm hai thành phần dùng chung: khung trang và điều hướng.
4. **Docker** là cách mặc định để chạy PostgreSQL cho dev và test. Build và chạy được ảnh Docker của app ngay trên máy.

## 2. Ngoài phạm vi

- Không đổi tính năng, API, schema database, nội dung email hay embed Discord.
- Không dùng hình, logo hay font gốc của game. Mọi hình đều tự vẽ mới theo phong cách tương tự, vì hình của game thuộc bản quyền nhà phát hành.
- Không có giao diện sáng. Chỉ còn một giao diện tối (xem §3.6).
- Không thêm âm thanh.
- Không cho admin chọn bộ đồ cho role (role mới do admin thêm dùng bộ mặc định; admin vẫn tải ảnh riêng được như cũ).
- Tính năng sửa buổi chơi sau khi tạo đang làm ở phiên khác (nhánh `claude/sad-morse-b7dce8`), không thuộc spec này.

## 3. Bộ nhận diện

### 3.1 Màu (token trong `src/web/styles.css`, khai báo qua `@theme`)

| Token | Giá trị | Dùng cho |
|---|---|---|
| `night-950` | `#0E1130` | Viền đậm, mực vẽ, thanh dưới cùng |
| `night-900` | `#1B1F4A` | Nền trang |
| `night-800` | `#2A3070` | Ô nội dung (panel) |
| `night-700` | `#3A4180` | Panel nổi, hover, ô nhập liệu |
| `night-600` | `#7680D4` | Viền phụ, nét đứt, viền ô nhập liệu, hình bóng nhân vật trống (≥ 3:1 trên `night-800` và `night-900`) |
| `night-300` | `#AEB6FF` | Chữ phụ, nhãn |
| `night-200` | `#D6DAFF` | Chữ thường trên panel |
| `gold` | `#FFD23F` | Nút chính, mục đang chọn, điểm nhấn |
| `gold-ink` | `#3A2600` | Chữ trên nền vàng |
| `goose` / `duck` / `third` | `#2F80ED` / `#E5484D` / `#8E4EC6` | Màu phe (giữ nguyên Global Constraints) |
| `goose-strong` / `duck-strong` | `#1F6FD6` / `#C9353A` | Nền có chữ trắng (băng phe, nút nguy hiểm) |
| `goose-soft` / `duck-soft` / `third-soft` | `#7CB8FF` / `#FF8A8F` / `#C9A2F2` | Chữ màu phe hoặc chữ báo lỗi (`duck-soft`) trên nền tối |
| `ok` | `#7CF29A` | Trạng thái tốt (đếm ngược, đã duyệt, "Đã lưu") |

- Nền trang: `night-900` có lớp chấm sao mờ (CSS `radial-gradient` lặp lại, không dùng ảnh).
- Chữ trắng không đặt trực tiếp lên `goose` hay `duck` (độ tương phản chỉ khoảng 3.9:1). Những chỗ đó dùng bản `-strong`. `third` để chữ trắng được (5:1).
- Chữ màu phe hoặc chữ đỏ báo lỗi trên nền tối dùng bản `-soft` (`goose`, `duck`, `third` gốc chỉ đạt khoảng 2–3:1 trên nền tối).
- Mọi cặp chữ/nền phải đạt tối thiểu 4.5:1 với chữ thường, 3:1 với chữ lớn và icon.

### 3.2 Chữ

- Font **Baloo 2** (giấy phép OFL, có đủ dấu tiếng Việt). Cài bằng gói `@fontsource-variable/baloo-2` và đóng gói kèm app, không tải từ Google.
- Độ đậm: tiêu đề 800, nhãn và nút 700, nội dung 500.
- Cỡ chữ nội dung tối thiểu 16px trên ô nhập liệu (iOS không tự zoom), 14px ở nội dung phụ, 12px là mức nhỏ nhất (nhãn trên băng phe). Ngoại lệ duy nhất: nhãn thanh dưới cùng 11px (7 mục phải vừa 320px).
- Số dùng `tabular-nums` như hiện tại.
- Chữ "nổi" kiểu game (tiêu đề lớn, bảng tên): chữ trắng hoặc vàng, viền `night-950` bằng `-webkit-text-stroke` + `paint-order: stroke fill`. Chỉ dùng cho chữ từ 18px trở lên.

### 3.3 Hình khối chung (utility trong `styles.css`)

- `panel`: nền `night-800`, viền 3px `night-950`, bo 16px. Thay cho `card` hiện tại (đổi tên ở mọi chỗ dùng; `card` bị xoá khi xong).
- `panel-inset`: nền `night-900`, viền 2px `night-950`, bo 12px (dòng trong panel, ví dụ hàng tri ân).
- `btn-primary`: nền `gold`, chữ `gold-ink` 700, viền 3px `night-950`, **viền đáy 6px** tạo khối. Khi nhấn: viền đáy còn 3px và nút dịch xuống 3px (cảm giác lún). Khi `disabled`: nền `night-700`, chữ `night-300`, không lún.
- `btn-secondary`: nền `night-700`, chữ trắng, cùng kiểu khối.
- `btn-danger`: nền `duck-strong`, chữ trắng, cùng kiểu khối.
- `field`: nền `night-900`, viền 2px `night-600`, chữ trắng, focus viền `gold`.
- `chip`: viên thuốc bo tròn hẳn, viền 2px `night-950`. Biến thể theo phe dùng màu phe (chữ trắng trên `-strong`).
- Viền focus bàn phím: `outline` 3px `gold`, cách 2px. Áp cho mọi phần tử bấm được.

### 3.4 Icon

- Dùng `lucide-react` (giấy phép ISC) cho thanh điều hướng và nút có icon. Bỏ emoji ở thanh điều hướng vì mỗi máy hiện emoji một kiểu.
- Icon trang trí có `aria-hidden`. Nút chỉ có icon thì có `aria-label`.
- Emoji role (`role.icon`) vẫn dùng ở huy hiệu ngực và danh sách role.

### 3.5 Chuyển động

- Nhân vật nhún nhẹ khi đứng (lên xuống 2px, chu kỳ 3s), chớp mắt thỉnh thoảng. Các nhân vật trong cùng màn hình lệch nhịp nhau.
- Nút lún khi nhấn. Thẻ nhích lên 2px khi rê chuột (chỉ khi thiết bị có chuột).
- Tất cả hoạt ảnh nằm trong `@media (prefers-reduced-motion: no-preference)`. Máy bật giảm chuyển động thì mọi thứ đứng yên.

### 3.6 Chỉ giao diện tối

- `color-scheme: dark`, bỏ mọi lớp `dark:` trong code web. Lý do: game luôn tối, giữ hai giao diện thì phải vẽ và kiểm tra mọi thứ hai lần.
- Thẻ `<meta name="theme-color">` đặt `#1B1F4A`.

## 4. Nhân vật

### 4.1 Dáng chung

- Vẽ mới trong khung `viewBox 0 0 120 160` (giữ khung cũ để logic bảng tên `nameplate.ts` dùng lại nguyên vẹn).
- Ngỗng đứng thẳng: thân trắng `#FFFFFF` hình quả trứng thon phía trên, cánh nhỏ một bên tô `#E6E2F0`, mắt tròn đen to có đốm sáng, mỏ cam `#FF9F1C` bo tròn, hai bàn chân cam. Mọi nét viền `#231A3A`, dày 3–4 đơn vị.
- **Màu phe** hiện ở **vòng sáng dưới chân** (elip mờ tô màu phe) và ở **khung thẻ** chứa nhân vật (§5.3). Thân không còn tô màu phe.
- Bảng tên trên đầu giữ nguyên quy tắc hiện tại: chữ trắng đậm viền tối, tự co theo độ dài.

### 4.2 Bộ đồ theo role

Mỗi role được gán một **bộ đồ** (kit) vẽ chồng lên dáng chung. Có 17 bộ đồ và một bộ mặc định:

| Bộ đồ | Hình | Role (theo `key`) |
|---|---|---|
| `knife` | Dao cầm ở cánh | duck, cannibal, professional, assassin, hitman, undertaker, serial_killer |
| `sword` | Kiếm dài + khăn đỏ buộc đầu | swordsman |
| `detective` | Mũ thám tử nâu + kính lúp | detective, birdwatcher, mortician, tracker, stalker, coroner, inquisitor, hoot_spotter |
| `police` | Mũ cảnh sát + huy hiệu sao | vigilante, sheriff, bodyguard, avenger, soldier, demon_hunter |
| `ninja` | Khăn bịt mặt đen, chỉ lộ mắt | morphling, silencer, spy, identity_thief, ninja, invisibility, camo_duck |
| `wizard` | Mũ phù thuỷ nhọn có sao | medium, astral, fortune_teller, lucid_dreamer, warlock, esper, witch_doctor |
| `engineer` | Mũ bảo hộ vàng + cờ lê | locksmith, engineer, scientist, sensor |
| `bomb` | Quả bom tròn có ngòi | demolitionist |
| `crown` | Vương miện vàng | politician, celebrity, lobbyist |
| `heart` | Tim đỏ trên ngực + đôi cánh nhỏ | lover_goose, lover_duck, cupid |
| `clown` | Mũi đỏ + mũ hề | party, mime, clown |
| `halo` | Vòng hào quang vàng trên đầu | preacher, saint, high_priest, initiate, sin_eater |
| `explorer` | Mũ thám hiểm + ba lô | adventurer, street_urchin, survivalist, looter |
| `sniper` | Súng dài có ống ngắm | sniper, hoot_sniper |
| `bird` | Mào lông trên đầu, màu mào khác nhau theo từng loài | dodo, dueling_dodos, vulture, pigeon, falcon, hawk, raven, cuckoo, magpie, crow, owl, chicken |
| `pouch` | Túi mỏ phồng to dưới mỏ | pelican |
| `vampire` | Áo choàng cổ cao + răng nanh | vampire, thrall |
| `badge` (mặc định) | Huy hiệu tròn trên ngực có emoji role, viền màu phe | Mọi role còn lại, và mọi role admin thêm sau |

- Bảng ánh xạ nằm trong `src/web/lib/roleKits.ts` (`kitForRole(key): Kit`). Key không có trong bảng → `badge`.
- Màu mào của bộ `bird` lấy từ một bảng cố định theo `key` trong cùng file (mỗi loài một màu, ví dụ quạ đen, chim ưng nâu, bồ câu xám).
- Mỗi bộ đồ là một component SVG nhỏ trong `src/web/components/goose/kits/`. Dáng chung ở `src/web/components/goose/GooseBody.tsx`.

### 4.3 Ba trạng thái (giữ API `Character` hiện tại)

`<Character role holderName variant size className />` giữ nguyên props để các trang không phải đổi cách gọi.

- `current`: đủ màu, có bộ đồ, bảng tên người giữ.
- `previous`: toàn bộ nhân vật mờ 45%, nhãn "Mùa trước" dưới bảng tên (như hiện tại).
- `empty`: hình bóng ngỗng tô `night-600`, không mắt, không bộ đồ, bảng tên "Chưa ai hoá thân" màu nhạt.
- Role có ảnh tuỳ chỉnh (`hasImage`): giữ cách hiện tại, ảnh thay phần thân, SVG chỉ còn bảng tên và vòng sáng phe.
- Toàn khối vẫn là một `role="img"` với `aria-label` "{role}: {tên}".

### 4.4 Logo, favicon, nhóm ngỗng trang đăng nhập

- Logo `DuckMark` và `favicon.svg`: vẽ lại thành đầu ngỗng trắng kiểu mới, viền đậm.
- Nhóm 5 nhân vật ở trang đăng nhập (`DuckSquad`) vẽ lại bằng dáng chung + bộ đồ: `ninja`, `detective`, `crown` (ở giữa, to hơn), `wizard`, `knife`. Giữ hoạt ảnh nhảy lên khi rê chuột hoặc chạm. `DuckBody.tsx` cũ bị xoá.

## 5. Khung trang và thành phần dùng chung

### 5.1 Thanh trên (`Layout`)

- Nền `night-950` mờ 90% + làm mờ phía sau, dính đầu trang.
- Trái: logo + chữ "GGD Hub" vàng viền tối.
- Giữa (từ `lg` trở lên): các mục điều hướng dạng viên thuốc; mục đang mở nền `gold` chữ `gold-ink`, mục khác chữ `night-200`.
- Phải: chip người dùng (avatar + tên, cắt "…" ở 128px) và nút "Đăng xuất" kiểu `btn-secondary` cỡ nhỏ. Từ `lg` trở lên chip chỉ hiện avatar, vì bảy mục điều hướng dạng icon + nhãn đã kín hàng; tên vẫn giữ cho trình đọc màn hình (`sr-only`) và ở `title` của chip. Dưới `sm` cũng chỉ avatar như vậy.
- Giữ nguyên các mốc màn hình hiện tại (`lg` = 1024px) và các chi tiết chống tràn ngang.

### 5.2 Thanh dưới cùng (dưới `lg`)

- Thanh tối `night-950`, bo hai góc trên 20px, icon lucide 22px + nhãn ngắn 11px.
- Mục đang mở: icon và nhãn màu `gold`, có chấm vàng nhỏ phía trên icon.
- 7 mục ở 320px vẫn vừa (mỗi mục ≈ 45px, nhãn cắt "…" như hiện tại).

### 5.3 Thẻ role (`RoleCard`, mới)

- Dùng ở Đại sảnh và Hồ sơ.
- Panel có **băng phe** trên cùng (nền `goose-strong` / `duck-strong` / `third`, chữ trắng 12px 800 viết hoa: "PHE NGỖNG", "PHE VỊT", "PHE THỨ 3"), dưới là `Character`, tên role 800, điểm + tên chỉ số màu `gold`.
- Role trống: viền nét đứt `night-600`, băng phe nhạt, dòng chữ "Khai điểm để giành" (chỉ là chữ: cả ô Đại sảnh đã là link tới Bảng xếp hạng của role, không lồng link trong link).
- `RoleCard` không tự là link; trang dùng nó quyết định bọc link hay không. Ô Đại sảnh giữ link tới Bảng xếp hạng của role và mùa như hiện tại.

### 5.4 Các thành phần khác

- `Modal`: nền panel, viền đậm, lớp phủ `night-950` mờ 70%. Giữ nguyên logic focus.
- `QueryState` (đang tải / lỗi / trống): đang tải là nhân vật ngỗng nhún kèm chữ "Đang tải…"; lỗi là panel viền `duck` + nút "Thử lại"; trống là nhân vật ngồi + một câu mời.
- `Avatar`: viền 2px `night-950`; người không có ảnh Discord hiện chữ cái đầu màu `gold` trên nền `night-700`.
- `SeasonSelect`: kiểu `field`.

## 6. Từng trang

Mọi trang giữ nguyên dữ liệu, hành vi, đường dẫn, nhãn truy cập (`aria-*`) và chữ đang được test kiểm. Chỉ đổi cách trình bày.

- **Đăng nhập**: toàn màn hình nền đêm. Nhóm 5 ngỗng ở trên, tiêu đề "GGD Hub" lớn kiểu chữ nổi, dòng "Cộng đồng Goose Goose Duck Việt Nam", nút "Đăng nhập bằng Discord" màu Discord `#5865F2` kiểu khối, thông báo lỗi trong panel viền đỏ.
- **Hôm nay** (`TodayPage`, `SessionCard`, `DailyHall`):
  - Mỗi buổi là một panel "phòng chờ": giờ bắt đầu lớn, tên chế độ, chip đếm ngược ("còn 2 giờ 15 phút", tính ở trình duyệt từ `startsAt`, cập nhật mỗi phút; khi đã qua giờ thì "Đang chơi"), mã phòng trong chip nổi bật nếu có, ghi chú.
  - **Hàng ghế**: một ô tròn cho mỗi chỗ (`capacity`, tối đa 25), ô có người hiện avatar, ô trống viền nét đứt; dưới là "8/12 ghế đã có người". Ở 320px hàng ghế tự xuống dòng.
  - Nút "Tham gia" / "Huỷ tham gia" kiểu `btn-primary` / `btn-secondary` to hết chiều ngang; dưới nút là dòng nhắc giờ 14px theo kênh nhắc của chính người đang xem (lấy từ hồ sơ; email chỉ tính khi đã bật và có địa chỉ): "Nhắc trước giờ chơi qua email và Discord", "Nhắc trước giờ chơi qua email" hoặc "Nhắc trước giờ chơi qua Discord"; tắt cả hai thì "Bạn đã tắt nhắc giờ — đổi ở Hồ sơ" (link tới `/ho-so`). Không ghi số phút vì thời gian nhắc trước là cài đặt của admin (`reminderLeadMinutes`). Dòng này ẩn khi buổi đã tới giờ ("Đang chơi") và ở buổi đã huỷ / đã kết thúc.
  - Buổi đã huỷ / đã kết thúc: panel mờ + chip trạng thái.
  - **Sảnh tri ân hôm nay**: panel tiêu đề vàng, mỗi hạng mục một dòng `panel-inset` có icon cúp, tên người thắng, số phiếu.
- **Đại sảnh** (`HallPage`): tiêu đề chữ nổi, chọn mùa, giữ các tab phe hiện có (Phe Ngỗng / Phe Vịt / Phe thứ 3, thêm "Chế độ đặc biệt" khi có role riêng của chế độ) nhưng vẽ thành chip màu phe, lưới `RoleCard` (2 cột ở 320px, 3 ở 768px, 4–5 ở 1280px).
- **Xếp hạng** (`LeaderboardPage`): chọn role và mùa như hiện tại; **bục 1-2-3** thay cho thẻ hạng 1 hiện tại (bục giữa cao nhất, người hạng 1 có nhân vật hoá thân đứng trên bục, hạng 2 và 3 là avatar). Bên dưới vẫn là bảng đầy đủ mọi hạng (kể cả top 3) với hàng kẻ `night-700`.
- **Tri ân** (`MvpPage`): vote vẫn diễn ra trên Discord, trang này chỉ xem kết quả. Dãy ngày chọn được hiện thành chip (ngày đang xem nền `gold`); kết quả theo ngày dùng cùng giao diện Sảnh tri ân như trang Hôm nay (`DailyHall`): mỗi hạng mục một dòng có icon cúp, người thắng (avatar + tên) và số phiếu, người thắng hạng nhất hạng mục có chữ vàng.
- **Khai điểm** (`ReportPage`): giữ ô "Role" gõ để tìm (combobox) như hiện tại. Mỗi gợi ý hiện nhân vật thu nhỏ + tên role + chip phe; role đã chọn hiện thành thẻ nhỏ có nhân vật. Phần nhập điểm trong panel; danh sách đã khai dùng chip trạng thái (chờ duyệt vàng, đã duyệt xanh `ok`, bị từ chối đỏ).
- **Hồ sơ** (`ProfilePage`): thẻ "hộ chiếu": avatar, tên, mã `GGD-xxxx` trong chip vàng; các role đang hoá thân hiện bằng `RoleCard`; hai lựa chọn nhắc giờ (email, DM) vẫn là checkbox nhưng vẽ thành công tắc gạt (giữ `type="checkbox"` và nhãn để trình đọc màn hình và test không đổi).
- **Quản trị** (`AdminPage` và các tab): thanh tab dạng chip cuộn ngang được; bảng dữ liệu nền `night-800`, hàng kẻ `night-700`, chữ 14px; form dùng `field`; nút xoá/huỷ dùng `btn-danger`. Ưu tiên dễ đọc hơn trang trí: không hoạt ảnh nhân vật trong bảng.

## 7. Docker

### 7.1 `docker-compose.yml` (mới, ở gốc repo)

| Service | Ảnh | Cổng máy | Ghi chú |
|---|---|---|---|
| `db` | `postgres:16-alpine` | 54329 | DB `ggd_dev`, user/mật khẩu `ggd`/`ggd`, volume `ggd-pgdata`, healthcheck `pg_isready` |
| `db-test` | `postgres:16-alpine` | 54330 | DB `ggd_test`, dữ liệu trong RAM (`tmpfs`), tắt `fsync`/`synchronous_commit`/`full_page_writes` cho nhanh |
| `app` | build từ `Dockerfile` | 3000 | Thuộc profile `app` (không tự chạy). Đọc `.env`, `DATABASE_URL` trỏ vào `db:5432`, chờ `db` khoẻ mới chạy |

- Cổng và chuỗi kết nối giữ đúng như hiện tại, nên `.env` và `tests/helpers/setup.ts` không phải đổi URL.
- Cổng chỉ mở trên địa chỉ loopback, cả `127.0.0.1` và `[::1]`, không mở ra mạng ngoài (phải có `[::1]` vì Prisma trên Windows phân giải `localhost` thành ::1 trước và chờ khoảng 2 giây mỗi kết nối nếu ::1 bị từ chối).
- Tên dự án compose cố định `name: ggd-hub` (không theo tên thư mục), để mọi bản checkout trên máy dùng chung một bộ container và không tranh cổng.

### 7.2 Lệnh npm

- `npm run db:start` → `docker compose up -d --wait --wait-timeout 120 db`.
- `npm run db:stop` → `docker compose stop db db-test`.
- `npm run db:start:embedded` → script PostgreSQL nhúng hiện tại (phương án dự phòng).
- `npm run app:docker` → `docker compose --profile app up --build app` (chạy thử bản production trên máy).

### 7.3 Test

- `tests/helpers/global-setup.ts`: mặc định chạy `docker compose up -d --wait --wait-timeout 120 db-test` (Docker treo thì dừng sau 120 giây kèm hướng dẫn, không treo `npm test`) rồi `prisma migrate deploy` như hiện tại. Không dừng container khi xong (lượt sau nhanh hơn; `resetDb` vẫn xoá dữ liệu giữa các test).
- Biến môi trường `GGD_TEST_DB=embedded` → dùng PostgreSQL nhúng như hiện tại.
- Docker chưa chạy → dừng với thông báo tiếng Việt rõ ràng: bật Docker Desktop, hoặc chạy lại với `GGD_TEST_DB=embedded`.
- CI (GitHub Actions) dùng Docker (máy CI có sẵn Docker), giữ bước `docker build .`.

### 7.4 Tài liệu

- README: phần chạy local đổi sang Docker; ghi cách dùng phương án dự phòng; ghi chú máy Windows bản Insider cần tắt Docker Model Runner (lỗi file socket `dockerInference`).
- `.env.example`: sửa chú thích dòng `DATABASE_URL` (Docker hoặc PostgreSQL nhúng).

## 8. Kiểm thử và tiêu chí xong

1. `npm run typecheck` và toàn bộ test qua (chạy bằng Docker, và một lần với `GGD_TEST_DB=embedded`).
2. Test cũ chỉ kiểm chi tiết cài đặt đã bị thay (ví dụ "thân tô màu phe", tên class `card`) được sửa theo thiết kế mới. Test kiểm hành vi, chữ và nhãn truy cập giữ nguyên ý nghĩa.
3. Test mới:
   - Mọi role trong `src/server/seed/roles.ts` render `Character` không lỗi, ra đúng bộ đồ theo bảng §4.2; key lạ ra `badge`.
   - Vòng sáng phe dùng đúng màu phe; trạng thái `empty` không có bộ đồ.
   - `RoleCard` hiện đúng chữ băng phe.
   - Đếm ngược của `SessionCard` (trước giờ / đã qua giờ) và hàng ghế (số ô = `capacity`, số ô có người = số người tham gia).
   - Global setup: chọn đúng Docker / nhúng theo `GGD_TEST_DB`.
4. Kiểm tra trên trình duyệt với dữ liệu mẫu, ở 320px, 768px và 1280px: mọi trang không cuộn ngang, chữ đọc được, focus bàn phím thấy rõ, bật giảm chuyển động thì không còn hoạt ảnh.
5. Độ tương phản các cặp màu ở §3.1 được kiểm bằng số (ghi trong báo cáo).
6. `docker build .` thành công trên máy; `npm run app:docker` chạy được và `/healthz` trả 200.

## 9. Quyết định đã chốt

| Quyết định | Nếu sai thì |
|---|---|
| Thân nhân vật trắng, phe hiện ở vòng sáng và khung thẻ | Muốn tô màu thân lại thì chỉ đổi một chỗ trong `GooseBody` |
| 17 bộ đồ dùng chung, role còn lại đeo huy hiệu | Role nào muốn bộ riêng thì thêm một kit và một dòng ánh xạ |
| Chỉ giao diện tối | Thêm giao diện sáng sau phải định nghĩa lại bộ token |
| Font Baloo 2 đóng gói kèm app (chỉ bộ chữ Latin + tiếng Việt, khoảng 100 KB) | Trang tải lâu hơn một chút lần đầu |
| `lucide-react` cho icon | Thêm một dependency nhỏ |
| Docker mặc định, PostgreSQL nhúng làm dự phòng | Giữ hai đường chạy DB nên tốn chút công bảo trì |
| Tri ân trên web chỉ xem kết quả (vote ở Discord) | Muốn vote trên web là một tính năng mới, cần spec riêng |
| Khai điểm giữ ô gõ để tìm role thay vì lưới thẻ | 91 role thì gõ tìm nhanh hơn cuộn lưới; lưới có thể thêm sau |
| Container test để chạy sẵn sau khi test xong | Tốn chút RAM khi không dùng; tắt bằng `npm run db:stop` |
