# Danh sách kiểm tra tay — GGD Hub

**Bắt buộc** chạy trên **một server Discord thử** (không phải server của hội) **trước khi mời cả hội** — phần nói chuyện với Discord thật (bot, nút, menu vote, lệnh slash, đăng nhập OAuth) chưa từng được chạy trước lần này, test tự động chỉ dùng bản giả. Chạy lại sau mỗi lần nâng cấp lớn, hoặc khi đổi cấu hình Discord/Gmail/database. Chốt mùa **không cần** kiểm tra tay (đã có test tự động `tests/server/seasons.test.ts`; không cần đổi giờ máy).

Thời gian ước tính: 60–90 phút (trong đó ~20 phút chờ nhắc giờ và email).

## 0. Chuẩn bị

- [ ] Server Discord thử có đủ 3 kênh (lịch chơi, vote, thông báo) và 2 role (`admin`, `mod`); ID đã điền vào biến môi trường.
- [ ] Discord Developer Portal → Bot → **Server Members Intent** đã bật; bot đã được mời với scope `bot applications.commands` và quyền View Channels, Send Messages, Embed Links, Read Message History.
- [ ] OAuth2 → Redirects có đúng `{PUBLIC_URL}/auth/callback`.
- [ ] Có **ít nhất 3 tài khoản Discord** để thử: **A** (role admin), **M** (role mod), **T** (thành viên thường). Thuận tiện nhất: rủ hai người bạn, hoặc dùng tài khoản phụ. Ít nhất một tài khoản có email Discord đã xác minh mà bạn đọc được.
- [ ] Ứng dụng đang chạy (Railway hoặc `npm run build` + `npm start` ở máy) với `.env`/biến trỏ vào server thử.

## 1. Khởi động

- [ ] Log có đủ, theo thứ tự: `prisma migrate deploy` xong → `Đã nạp dữ liệu tham chiếu.` → `Đang chạy tại cổng 3000` → `[bot] Đã đăng nhập Discord với tên …` → `[bot] Đã đăng ký 3 lệnh slash cho server …` → `Bot Discord đã kết nối`.
- [ ] Mở `{PUBLIC_URL}/healthz` → `{"ok":true,"discord":"ready"}`.
- [ ] (Railway) **Kiểm tra `TRUST_PROXY_HOPS`**: mở `{PUBLIC_URL}` từ **hai mạng khác nhau** (vd máy tính qua wifi và điện thoại qua 4G) → **Railway → Deployments → View Logs** → các dòng log yêu cầu của Fastify (`"msg":"incoming request"`) có `"remoteAddress":"…"` phải là **IP thật, khác nhau** của hai thiết bị (so với trang kiểu "What is my IP" mở trên từng thiết bị) — **không** phải cùng một IP của proxy (thường dạng `10.x.x.x` hay `100.64.x.x`). Sai ⇒ cả hội dùng chung **một** bucket 120 yêu cầu/phút và ai cũng bị "Bạn thao tác quá nhanh"; sửa `TRUST_PROXY_HOPS` (README mục 6.3) rồi kiểm tra lại.
- [ ] (Railway) **Settings → Deploy**: Replicas = `1`; ứng dụng và dịch vụ `Postgres` cùng vùng **Southeast Asia (Singapore)**.
- [ ] Trong server thử gõ `/` → thấy ba lệnh của bot: `/baocao`, `/bxh`, `/hoso` (chưa thấy thì `Ctrl+R` làm tươi Discord).
- [ ] Mở `{PUBLIC_URL}` → trang đăng nhập "GGD Hub — Cộng đồng Goose Goose Duck Việt Nam" với nút **Đăng nhập bằng Discord**.

## 2. Thành viên

- [ ] **T** vào server (hoặc đã ở sẵn khi bot khởi động) → trong vòng 1 phút nhận **DM**: `Chào mừng <tên> đến với hội Goose Goose Duck! 🪿`, `Mã thành viên của bạn: GGD-xxxx`, `Đăng nhập hệ thống: {PUBLIC_URL}`.
- [ ] Mã thành viên của người vào sau lớn hơn người vào trước (tăng dần, không trùng).
- [ ] **T** rời server → **A** đăng nhập web → **Quản trị → Thành viên** → lọc *Đã rời* thấy **T**. **T** vào lại → **Chào mừng trở lại, <tên>!**, mã **giữ nguyên**, trạng thái trở lại hoạt động.
- [ ] Một bot khác trong server (vd MEE6) **không** có hồ sơ trong danh sách thành viên.
- [ ] `/hoso` (bất kỳ ai) → trả lời chỉ mình thấy: `Mã thành viên: GGD-xxxx`, dòng role đang giữ (hoặc chưa giữ), `Hồ sơ trên web: {PUBLIC_URL}/ho-so`.

## 3. Đăng nhập web và phân quyền

- [ ] **A** bấm **Đăng nhập bằng Discord** → Discord hỏi quyền `identify`, `email` → **Authorize** → về trang **Hôm nay**; thanh menu có **Quản trị**.
- [ ] **Hồ sơ** của A: mã thành viên đúng, **email** đã điền sẵn từ Discord, hai công tắc nhắc **Email** / **DM** đang bật. Sửa email, tắt một công tắc, tải lại trang → giữ nguyên.
- [ ] **Quản trị** của A có **7 tab**: Buổi chơi, Duyệt điểm, Thành viên, Gửi lỗi, Hạng mục, Role, Cài đặt.
- [ ] **M** đăng nhập → **Quản trị** chỉ **4 tab** (Buổi chơi, Duyệt điểm, Thành viên, Gửi lỗi); mở thẳng `{PUBLIC_URL}/quan-tri?tab=cai-dat` → rơi về tab Buổi chơi.
- [ ] **T** đăng nhập → **không** có mục Quản trị; mở thẳng `{PUBLIC_URL}/quan-tri` → trang không có quyền.
- [ ] Một tài khoản **không ở trong server** thử đăng nhập → quay về trang đăng nhập với dòng **Bạn cần vào server Discord trước**.
- [ ] Đổi role Discord của **T** sang `mod` (bot đang chạy) → T tải lại web → thấy **Quản trị** với 4 tab. Gỡ role → mất Quản trị. (Nếu không đổi ngay: đăng xuất rồi đăng nhập lại cũng phải cập nhật.)
- [ ] **Đăng xuất** → về trang đăng nhập; mở `{PUBLIC_URL}/api/me` → JSON lỗi 401.

## 4. Buổi chơi và điểm danh

Tạo buổi bắt đầu **sau 17 phút** để kịp thử cả hai mốc nhắc (T−15 và T) trong mục 5.

- [ ] **A** → **Quản trị → Buổi chơi**: ngày hôm nay, giờ = bây giờ + 17 phút, chế độ *Cổ điển (Classic)*, sức chứa **2**, mã phòng `ABCD`, ghi chú → **Tạo**. Trang báo thành công, buổi hiện trong danh sách ngày đó.
- [ ] Kênh lịch chơi có tin của bot: chế độ, giờ (giờ Việt Nam), `0/2`, nút **Tham gia** (xanh) và **Huỷ** (xám).
- [ ] **T** bấm **Tham gia** → trả lời chỉ T thấy `Đã đăng ký buổi HH:mm ✅`; tin đổi `1/2` và có tên T. Bấm **Tham gia** lần nữa → vẫn `1/2` (không trùng).
- [ ] **M** mở web **Hôm nay** → thấy buổi đó với `1/2` và tên T → bấm **Tham gia** trên web → tin Discord đổi `2/2`, nút Discord đổi thành **Đã đủ người** (mờ).
- [ ] **A** bấm nút trên Discord (đã đủ) → không vào được, báo **Đã đủ người**; trên web nút cũng báo đủ.
- [ ] **M** bấm **Huỷ** trên Discord → `Đã huỷ tham gia`, tin về `1/2`, nút **Tham gia** sáng lại. Rồi **M** tham gia lại (để nhận nhắc ở mục 5).
- [ ] Trang **Hôm nay** của T và M khớp Discord (số người, danh sách, nút).
- [ ] **Tạo thêm một buổi** khác (bắt đầu sau 30 phút, sức chứa 16) để thử huỷ ở mục 6 — **T** tham gia buổi này.

## 5. Nhắc giờ

Trước đó: **T** đã đăng nhập web ít nhất một lần (để có email) và bật cả hai kênh; **M** tắt **Email** trong Hồ sơ; một người nữa (hoặc T ở lần thử khác) **chưa từng đăng nhập web**.

- [ ] Đúng **T−15 phút** (trong vòng 1 phút sau mốc): T nhận **DM** `Còn 15 phút nữa là tới buổi chơi Cổ điển (Classic) lúc HH:mm…` **và email** tiêu đề `[GGD] Còn 15 phút: buổi Cổ điển (Classic) lúc HH:mm`.
- [ ] **M** (tắt email) chỉ nhận **DM**, không có email.
- [ ] Người **chưa từng đăng nhập web** chỉ nhận **DM**; **Quản trị → Gửi lỗi** **không** có dòng lỗi email cho người đó.
- [ ] Đúng **giờ bắt đầu**: DM `Buổi chơi Cổ điển (Classic) bắt đầu rồi, vào game thôi! 🦆`, có dòng `Mã phòng: ABCD`; email tiêu đề `[GGD] Vào game thôi! Buổi Cổ điển (Classic) HH:mm`.
- [ ] Không ai nhận **trùng** (mỗi mốc đúng một DM, một email).
- [ ] Người **tham gia sau mốc T−15** (vào lúc T−10) chỉ nhận nhắc đúng giờ, không nhận nhắc T−15.
- [ ] Một tài khoản **chặn DM từ thành viên server** tham gia buổi → đến mốc nhắc, **Gửi lỗi** có dòng cho người đó (kênh DM, nội dung lỗi); những người khác vẫn nhận bình thường.
- [ ] (Nếu chạy trên Railway) **Redeploy** giữa hai mốc nhắc → sau khi lên lại, mốc kế tiếp vẫn gửi, mốc đã gửi không gửi lại.

## 6. Huỷ buổi

- [ ] **A** → **Quản trị → Buổi chơi** → buổi thứ hai → **Huỷ buổi** → xác nhận.
- [ ] Tin Discord của buổi đổi thành *Đã huỷ*, không còn nút.
- [ ] **T** (đã đăng ký buổi đó) nhận DM `Buổi chơi Cổ điển (Classic) lúc HH:mm ngày dd/MM đã bị huỷ.`
- [ ] Trang **Hôm nay** hiện buổi đã huỷ (không còn nút tham gia); không có nhắc nào được gửi cho buổi đã huỷ.

## 7. Kết thúc buổi và vote MVP

Trước đó: **Quản trị → Hạng mục** có ít nhất một hạng mục *tuỳ chọn* (dữ liệu mẫu có sẵn, vd "Pha đẻ trứng lộ liễu nhất").

- [ ] **A** → buổi đầu (2 người: T, M) → **Kết thúc** → hộp thoại: hạng mục *luôn có* ("Giết nhiều nhất", "Pha xử lý ngu nhất", "Pha dí người ngu nhất") và hạng mục *theo chế độ* khớp Classic (nếu có) **đã tick sẵn**; hạng mục *tuỳ chọn* **chưa tick**. Tick thêm một hạng mục tuỳ chọn → **Kết thúc**.
- [ ] Bấm `Tab` trong hộp thoại → tiêu điểm chạy vòng trong hộp; `Esc` đóng hộp và tiêu điểm quay về nút **Kết thúc**.
- [ ] Buổi chuyển **Đã kết thúc**; tin Discord ở kênh lịch chơi cập nhật trạng thái, không còn nút.
- [ ] Kênh vote có **mỗi hạng mục một tin** (đủ số hạng mục đã tick), mỗi tin một menu **Chọn người xứng đáng**.
- [ ] Mở menu → **chỉ có T và M** (người có mặt). A (không tham gia) **không** có trong menu.
- [ ] **T** chọn **T** → `Không được tự vote`. **T** chọn **M** → xác nhận chỉ T thấy. **T** đổi sang… (chỉ còn M nên bỏ qua) — dùng **A** chọn M rồi đổi sang T → phiếu đổi, không cộng dồn.
- [ ] Một người **mới vào server khi bot đang tắt** (hoặc chưa có hồ sơ) vote → vote được, và xuất hiện trong **Thành viên** ngay sau đó.
- [ ] **Quản trị → Buổi chơi → Vote đang mở** liệt kê đợt vote này với giờ đóng = bây giờ + 12 giờ (hoặc theo Cài đặt).
- [ ] **Đóng vote sớm** → xác nhận → các tin vote **thay menu bằng kết quả**; kênh thông báo có `🏆 Kết quả tri ân buổi …` liệt kê từng hạng mục: `<tên> (n phiếu)`, hạng mục không ai vote ghi `Không ai được vote`, hoà thì ghi cả hai tên.
- [ ] Web **Hôm nay** → **Sảnh tri ân hôm nay** hiện đúng người thắng; trang **Tri ân** có ngày hôm nay.
- [ ] Tạo một buổi **không ai tham gia**, kết thúc → buổi *Đã kết thúc*, **không** có tin vote nào, không lỗi trong log.
- [ ] (Tuỳ chọn, 4 giờ) Để một buổi quá giờ bắt đầu 4 giờ không kết thúc → tự kết thúc và mở vote với hạng mục tick sẵn.

## 8. Khai điểm, duyệt, hoá thân

- [ ] **T** gõ `/baocao` → ở ô `role` gõ `co gay` (không dấu) → gợi ý có `🪿 Cò gáy — …`; chọn, `so_lieu` = 3 → gửi → trả lời chỉ T thấy `Đã gửi: 🪿 Cò gáy — 3 … ngày dd/MM. Chờ mod duyệt nhé!`.
- [ ] `/baocao` với `so_lieu` **vượt giới hạn** của role (vd 999) → bị từ chối, thông báo tiếng Việt, không tạo lần khai.
- [ ] `/baocao` với `ngay` cách hôm nay **hơn 3 ngày** → bị từ chối.
- [ ] Web **Khai điểm** của T: gõ `kiem si` → chọn **Kiếm sĩ**; ô số liệu mang tên chỉ số của role với `max`; ngày mặc định hôm nay (chỉ chọn được 3 ngày lùi); chọn buổi đã kết thúc; gửi → **Đã gửi, chờ mod duyệt**; lần khai hiện ở *Lần khai của tôi* với trạng thái **Chờ duyệt** và nút **Sửa**.
- [ ] **T** sửa lần khai đang chờ (đổi số liệu) → cập nhật tại chỗ.
- [ ] **M** → **Quản trị → Duyệt điểm**: thấy lần khai của T (cũ nhất trước). **Từ chối** không ghi lý do → **Cần ghi lý do từ chối**, không gửi. Ghi lý do → từ chối → T nhận **DM** có `… bị từ chối: <lý do>`; trạng thái trên web của T: **Bị từ chối** kèm lý do.
- [ ] **M** **Duyệt** lần khai Cò gáy của T → biến mất khỏi hàng chờ.
- [ ] Kênh thông báo có `👑 <tên T> đã hoá thân Cò gáy mùa YYYY-MM!` (lần đầu có người dẫn đầu role này trong mùa).
- [ ] **Đại sảnh hoá thân** → tab **Phe Ngỗng** → ô **Cò gáy** mang tên T trên đầu nhân vật, điểm `3` + tên chỉ số. **Bảng xếp hạng** → chọn Cò gáy → T hạng 1 với 👑. `/bxh` role Cò gáy → embed top 10 có T.
- [ ] **A** khai Cò gáy = 5 → **M** duyệt → kênh thông báo có 👑 **đổi sang A**; Đại sảnh và BXH đổi theo. **T** khai thêm 3 (tổng 6) → duyệt → 👑 đổi lại về T.
- [ ] **M** tự khai một lần → trong **Duyệt điểm** của M **không** duyệt được lần khai của chính mình; **A** duyệt được (và A duyệt được lần khai của chính A).
- [ ] Hai mod cùng mở hàng chờ, một người duyệt trước → người sau bấm → thông báo lần khai đã được xử lý, hàng chờ tải lại (không lỗi 500).

## 9. Quản trị (admin)

- [ ] **Cài đặt**: đổi *Nhắc trước* thành 20 → **Đã lưu**; nhập 3 → báo khoảng hợp lệ, không gửi. Trả về 15.
- [ ] **Hạng mục**: thêm hạng mục *theo chế độ* cho Săn ngỗng → tạo buổi Săn ngỗng → kết thúc → hạng mục đó **tick sẵn**; buổi Classic **không** có. Ẩn hạng mục → không còn trong hộp kết thúc.
- [ ] **Role → Thêm role**: thêm một role thử (key `thu_nghiem`, phe Vịt, giới hạn 5) → **Đã thêm**, role hiện cuối nhóm **Phe Vịt** và có trong **Khai điểm**; thêm lại cùng key → **Key đã tồn tại**. Đổi **Phe** của role đó sang Phe thứ 3 → **Lưu** → role chuyển nhóm; rồi tắt role đó.
- [ ] **Cài đặt → Chế độ chơi**: đổi tên tiếng Việt của một chế độ → **Đã lưu** → form tạo buổi hiện tên mới; tắt chế độ đó → không còn trong form tạo buổi; bật lại.
- [ ] **Role**: tải ảnh PNG ≤ 1 MB cho một role → **Đại sảnh** và **BXH** hiện ảnh mới (không phải ảnh cũ); **Xoá ảnh** → về nhân vật vẽ. Thử file 2 MB hoặc `.gif` → **Ảnh phải là PNG, JPG hoặc WebP, tối đa 1 MB**, không gửi.
- [ ] **Thành viên**: tìm `kẹ`/`ke` (không dấu) đều ra; lọc *Đã rời*; **M** mở cùng tab → **không thấy cột email**; **A** thấy.
- [ ] **Gửi lỗi** (M đang xem): nội dung lỗi có địa chỉ email thì hiện `[email ẩn]`; **A** thấy địa chỉ thật.

## 10. Khả năng chịu lỗi (Discord)

- [ ] **Xoá tay tin buổi chơi** trong kênh lịch chơi (buổi còn mở) → một người bấm **Tham gia** trên web (bất kỳ thay đổi nào của buổi) → bot thấy tin cũ đã mất và **đăng tin mới ngay** (nút hoạt động, số người đúng); các thay đổi sau đó sửa vào tin mới.
- [ ] **Xoá tay một tin vote** đang mở → vote các hạng mục còn lại vẫn được; **Đóng vote sớm** vẫn thành công, kết quả vẫn đăng ở kênh thông báo, không lỗi trong log.
- [ ] Tạm **tắt quyền Send Messages** của bot ở kênh lịch chơi → tạo buổi trên web → buổi **vẫn được tạo** (hiện trên Hôm nay, tham gia được trên web); bật lại quyền → trong ~1 phút tin được đăng bù.
- [ ] Tạm **đổi `DISCORD_TOKEN` thành sai** rồi redeploy (hoặc ở máy: khởi động với token sai) → log `Không kết nối được Discord: …`, nhưng `Đang chạy tại cổng 3000` vẫn có, web đăng nhập/xem được, `/healthz` → `{"ok":true,"discord":"down"}` (mã 200). Trả token đúng → `"discord":"ready"`.

## 11. Mùa giải (không cần đổi giờ máy)

- [ ] Chốt mùa, từ chối lần khai còn chờ, lưu người giữ role, chạy lại không trùng: **đã có test tự động** — chỉ cần `npm test` xanh.
- [ ] (Tuỳ chọn, theo lịch thật) Ngày **3** sau **09:00**: nếu mùa trước còn lần khai chờ, kênh thông báo có một lời nhắc mod (chỉ một lần). Ngày **4** sau **00:05**: kênh thông báo có **bảng tổng kết mùa**; **Đại sảnh** mùa mới hiện người giữ mùa trước ở trạng thái mờ ghi *Mùa trước*; lần khai cho ngày thuộc mùa đã chốt bị từ chối.

## 12. Điện thoại và truy cập

- [ ] Mở web trên điện thoại (hoặc thu trình duyệt về 320 px): Hôm nay, Đại sảnh, BXH, Khai điểm, Quản trị (mọi tab) **không** phải cuộn ngang.
- [ ] Chế độ tối của hệ điều hành → giao diện đổi theo, chữ đọc được.
- [ ] Dùng bàn phím đi hết trang đăng nhập → Hôm nay → Quản trị: mọi nút/liên kết có viền tiêu điểm.

---

Kết quả: ghi ngày, phiên bản (commit), ai kiểm tra, và các mục chưa đạt vào cuối file này hoặc vào issue.
