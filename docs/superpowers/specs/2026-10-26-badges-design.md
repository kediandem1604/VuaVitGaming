# GGD Hub — Huy hiệu (danh hiệu vĩnh viễn)

- Ngày: 2026-10-26
- Trạng thái: Chờ duyệt
- Nhánh: `feat/ggd-hub-v1`
- Liên quan: spec gốc `2026-10-22-ggd-hub-design.md` §4.5 (vote MVP), §4.6–4.7 (khai điểm, mùa, hoá thân), §8 (Hồ sơ); spec `2026-10-26-highlight-design.md`. Thiết kế đã duyệt trong chat.

## 1. Mục tiêu

Thành viên nhận **danh hiệu** khi đứng đầu một hạng mục trong tháng (vd **SMVP tháng 10/2026**) hoặc khi đạt một cột mốc (vd **Lão làng** — 50 trận). Danh hiệu **không bao giờ mất**: trao một lần, lưu lại, không tính lại. Mọi thành viên xem được danh hiệu của mọi người; danh hiệu mới hơn hiện trên.

## 2. Ngoài phạm vi

- Admin trao/thu hồi tay, sửa tên/biểu tượng danh hiệu trong trang quản trị (danh mục nằm trong code).
- Nhãn danh hiệu cạnh tên ở mọi trang; danh hiệu trong lệnh Discord `/hoso`; gán role Discord theo danh hiệu.
- Trang công khai cho người chưa đăng nhập (cả web vẫn yêu cầu đăng nhập như hiện tại).

## 3. Danh mục danh hiệu

Danh mục là hằng số dùng chung `src/shared/badges.ts` (server tính, web hiện mục "Cách nhận"). Mỗi mục: `key`, `kind` (`monthly` | `milestone`), `icon`, `name`, `howTo` (một câu tiếng Việt).

### 3.1 Theo tháng (`monthly`)

Tháng = tháng lịch giờ Việt Nam (UTC+7), mã `YYYY-MM` như mùa. Tên lưu khi trao: `{name} tháng {MM}/{YYYY}` (dùng `formatSeasonLabel`).

| key | icon | name | Ai nhận | Tối thiểu | `detail` lưu kèm |
|---|---|---|---|---|---|
| `smvp` | 👑 | SMVP | Nhiều lần thắng hạng mục vote nhóm **Khen** nhất (§4) | 1 | `{n} lần MVP` |
| `fun_king` | 🤡 | Vua tấu hài | Nhiều lần thắng hạng mục vote nhóm **Vui** nhất | 1 | `{n} lần thắng hạng mục vui` |
| `top_goose` | 🪿 | Chiến thần phe Ngỗng | Hạng 1 "Top 3 mỗi phe" phe Ngỗng của mùa đó | điểm > 0 | `{điểm} điểm · {role}` |
| `top_duck` | 🦆 | Sát thủ phe Vịt | Hạng 1 phe Vịt | điểm > 0 | như trên |
| `top_neutral` | 🃏 | Trùm phe thứ 3 | Hạng 1 phe thứ 3 | điểm > 0 | như trên |
| `grinder` | 🔥 | Chăm cày | Nhiều trận đã đi nhất (§4) | 1 | `{n} trận` |
| `versatile` | 🎭 | Đa diện | Nhiều role khác nhau có lần khai **đã duyệt** (ngày chơi trong tháng) nhất | 2 | `{n} role` |

- **Bằng nhau thì tất cả cùng nhận** (`smvp`, `fun_king`, `grinder`, `versatile`). Top phe dùng đúng thứ hạng `getFactionTop(ctx, seasonId, 1)` (đã có phân hoà, ×5 cho role tối đa 1 lần/trận) nên mỗi phe tối đa một người.
- Không ai đạt tối thiểu → không trao danh hiệu đó tháng đó.
- Thành viên đã rời server vẫn được tính (giữ lịch sử, như bảng xếp hạng).

### 3.2 Cột mốc trọn đời (`milestone`)

| key | icon | name | Điều kiện |
|---|---|---|---|
| `games_10` | 🎮 | Quen mặt | Đã đi 10 trận |
| `games_50` | 🏅 | Lão làng | Đã đi 50 trận |
| `games_100` | 🏆 | Huyền thoại sảnh | Đã đi 100 trận |
| `mvp_1` | ⭐ | Ngôi sao mới | Thắng MVP lần đầu (nhóm Khen) |
| `mvp_10` | 🌟 | Ngôi sao sáng | 10 lần thắng MVP |
| `mvp_50` | 💫 | Siêu sao | 50 lần thắng MVP |
| `incarnate_1` | 🎖️ | Lần đầu hoá thân | Có ít nhất một dòng `role_titles` (hoá thân một mùa đã chốt) |
| `incarnate_5` | 🧬 | Bậc thầy hoá thân | Đã hoá thân 5 role khác nhau (đếm `roleId` khác nhau trong `role_titles`) |
| `director` | 🎬 | Đạo diễn | Có lần khai **đã duyệt** kèm highlight (`highlight_message_id` khác null) |

Tên lưu = `name` (không kèm tháng). `detail` = điều kiện đã đạt, vd `Đã đi 50 trận`.

## 4. Định nghĩa số liệu

- **Một lần thắng vote**: một dòng `awards` (một người thắng một hạng mục trong một vòng). Đồng hạng trong vòng tạo nhiều dòng — mỗi người đều tính. Tháng của dòng = ngày VN của `game_sessions.starts_at` của vòng (cách Sảnh tri ân đang nhóm).
- **Nhóm hạng mục**: cột mới `award_categories.badge_group` (`mvp` | `fun` | `none`, mặc định `none`). Migration đặt cho dữ liệu có sẵn theo tên: "Giết nhiều nhất", "Ngỗng chạy giỏi nhất" → `mvp`; "Pha xử lý ngu nhất", "Pha dí người ngu nhất", "Pha đẻ trứng lộ liễu nhất (Cò gáy)", "Pha chém lố nhất (Kiếm sĩ)" → `fun`. Seed (`src/server/seed/categories.ts`) có giá trị tương ứng cho DB mới. Admin đổi ở trang quản trị hạng mục (ô "Tính cho danh hiệu": Khen / Vui / Không tính). Luôn đọc giá trị **hiện tại** lúc trao.
- **Một trận đã đi**: một dòng `attendances` trạng thái `going` của trận có `status = 'ended'`. Tháng = ngày VN của `starts_at`.
- **Điểm phe**: như trang Bảng xếp hạng (`getFactionTop`).

## 5. Dữ liệu

Migration mới (không đụng dữ liệu cũ ngoài `badge_group`):

```prisma
enum BadgeGroup { mvp fun none }

model AwardCategory { … badgeGroup BadgeGroup @default(none) @map("badge_group") }

model MemberBadge {
  id        Int      @id @default(autoincrement())
  memberId  Int      @map("member_id")
  badgeKey  String   @map("badge_key")
  periodId  String   @map("period_id")   // 'YYYY-MM' cho danh hiệu tháng; '' cho cột mốc
  title     String                        // chữ hiện, đóng băng lúc trao
  icon      String
  detail    String
  awardedAt DateTime @map("awarded_at") @db.Timestamptz(3)
  member    Member   @relation(fields: [memberId], references: [id])
  @@unique([badgeKey, periodId, memberId])
  @@index([awardedAt, id])
  @@index([memberId, awardedAt])
  @@map("member_badges")
}

model BadgeMonth {
  periodId        String   @id @map("period_id")   // 'YYYY-MM' đã trao xong
  awardedAt       DateTime @map("awarded_at") @db.Timestamptz(3)
  announcePending Boolean  @map("announce_pending")
  @@map("badge_months")
}
```

- Không có thao tác xoá/sửa `member_badges` trong app (danh hiệu không mất).
- `app_settings` key `badges.milestones_backfilled` (giá trị ISO time) đánh dấu đã trao bù cột mốc lần đầu.

## 6. Trao danh hiệu (`src/server/modules/badges/`)

Job scheduler mới `badges` (chạy sau job `season` trong `defaultJobs()`), mỗi lượt 60 giây, chạy lại an toàn:

### 6.1 Tháng

1. Các tháng cần xét: từ tháng của dữ liệu cũ nhất (trận sớm nhất hoặc lần khai sớm nhất) tới tháng trước tháng hiện tại, bỏ tháng đã có dòng `badge_months`.
2. Tháng M chỉ trao khi `now >= seasonCloseAt(M)` (00:05 VN ngày 4 tháng sau) **và** nếu có dòng `seasons` của M thì nó đã chốt (`closed_at` khác null) — để Top phe dùng số liệu đã chốt. Chưa đủ → để lượt sau.
3. Một giao dịch: tạo dòng `badge_months` (trùng khoá → một tiến trình khác đã trao → dừng), tính bảy danh hiệu §3.1, `createMany` `member_badges` (`skipDuplicates`), `awardedAt = now`, `announcePending = (có ít nhất một danh hiệu)`.
4. Sau commit: gửi tin tổng kết (§8); thành công mới xoá `announcePending`. Lượt sau thử lại tháng còn `announcePending = true`.

### 6.2 Cột mốc

1. Mỗi lượt: bốn truy vấn gộp (số trận đã đi, số lần thắng nhóm Khen, số role hoá thân khác nhau + có hoá thân, có highlight đã duyệt) cho mọi thành viên → các cột mốc đạt mà chưa có → `createMany` (`skipDuplicates`), `periodId = ''`, `awardedAt = now`.
2. Chưa có `badges.milestones_backfilled`: trao bù **không đăng Discord**, rồi ghi key. Từ lượt sau, cột mốc mới (những dòng thực sự được tạo ở lượt này) được đăng (§8), lỗi Discord chỉ ghi log, không thử lại.

## 7. HTTP

Đều yêu cầu đăng nhập (`requireMember`).

- `GET /api/badges?before={id}&limit={1..100, mặc định 50}` → `BadgeDto[]` mọi danh hiệu, mới nhất trước (`awardedAt` giảm dần, rồi `id` giảm dần); `before` = id dòng cuối trang trước (phân trang).
  - `BadgeDto { id, badgeKey, kind, periodId, title, icon, detail, awardedAt, member: { id, displayName, avatarUrl } }`.
- `GET /api/members/:id` → `PublicMemberDto { id, displayName, avatarUrl, joinedAt, left: boolean, badges: BadgeDto[] }` (mọi danh hiệu của người đó, mới nhất trước). Không có email, quyền hay Discord id. Không có → `NOT_FOUND`.
- Quản trị hạng mục: DTO hạng mục và API sửa/tạo thêm `badgeGroup` (`mvp` | `fun` | `none`), kiểm tra như các trường khác.

## 8. Discord

- Tin tổng kết tháng (kênh thông báo, `announce`), chia ≤ 2000 ký tự bằng `chunkLines`:
  ```
  🏅 Danh hiệu tháng 10/2026
  👑 SMVP: Tên A (7 lần MVP)
  🤡 Vua tấu hài: Tên B, Tên C (3 lần thắng hạng mục vui)
  🪿 Chiến thần phe Ngỗng: …
  …
  Xem tất cả: {PUBLIC_URL}/huy-hieu
  ```
  Tên người escape Markdown, `allowedMentions` không ping (như các tin hiện có).
- Cột mốc mới: một tin cho cả lượt, mỗi dòng `🎖️ **Tên** vừa đạt danh hiệu {icon} {title}!`.

## 9. Web

- Menu thêm **Huy hiệu** (`/huy-hieu`), sau "Tri ân".
- **Trang Huy hiệu**: tường vinh danh từ `GET /api/badges`, nhóm theo tháng của `awardedAt` (tiêu đề "Trao trong tháng 11/2026" — danh hiệu tháng 10 được trao ngày 4/11 nên nằm ở nhóm này; tên danh hiệu đã ghi rõ tháng), mỗi thẻ: icon, tên danh hiệu, `detail`, avatar + tên người (link tới trang thành viên); nút "Xem thêm" tải trang kế. Bên dưới mục **Cách nhận**: mọi danh hiệu trong danh mục (icon, tên, `howTo`), tách "Mỗi tháng" và "Cột mốc". Chưa có danh hiệu nào → "Chưa có danh hiệu nào — đầu tháng sau sẽ có SMVP đầu tiên!".
- **Trang thành viên** `/thanh-vien/:id`: avatar, tên, "Vào server {ngày}", nhãn "Đã rời server" nếu `left`, danh sách danh hiệu (mới nhất trên); không có → "Chưa có danh hiệu nào". Id lạ/không có → trang không tìm thấy.
- **Link tên**: tên người ở trang Huy hiệu, Bảng xếp hạng (Top 3 mỗi phe, bục 1-2-3, bảng) và Đại sảnh (người hoá thân) mở trang thành viên.
- **Hồ sơ**: mục "Danh hiệu của tôi" (cùng dữ liệu `GET /api/members/{id của tôi}`) + link "Xem trang công khai".
- **Quản trị → hạng mục vote**: ô chọn "Tính cho danh hiệu".
- Giao diện theo bộ nhận diện Sảnh đêm; không cuộn ngang ở 320px.

## 10. Kiểm thử và tiêu chí xong

- Luật tháng (DB thật): SMVP chỉ đếm nhóm Khen, Vua tấu hài chỉ nhóm Vui, đổi nhóm hạng mục có tác dụng ở lần trao sau; bằng nhau cùng nhận; dưới tối thiểu không trao (Đa diện cần 2 role); tháng tính theo ngày VN của trận (trận 23:30 VN ngày 31 thuộc tháng đó); Top phe khớp `getFactionTop` (×5); Chăm cày chỉ đếm `going` ở trận `ended`; tháng chỉ có vote, không có dòng `seasons` vẫn được trao; tháng có `seasons` chưa chốt thì chờ; chạy lại / hai lượt song song không trao trùng; `announcePending` xoá khi gửi được, giữ khi Discord lỗi.
- Cột mốc: đúng ngưỡng (9 trận chưa có, 10 có); trao bù lần đầu không đăng Discord, lượt sau mới đăng; không trao trùng.
- HTTP: phân trang `before`/`limit`, thứ tự mới nhất trước; trang thành viên không lộ email; 404; yêu cầu đăng nhập; quản trị hạng mục nhận/kiểm tra `badgeGroup`.
- Web: tường nhóm theo tháng + "Xem thêm"; Cách nhận đủ danh mục; trang thành viên; link tên ở ba trang; Hồ sơ có mục danh hiệu; ô "Tính cho danh hiệu".
- `npm run typecheck`, toàn bộ test, `npm run build` đạt.
