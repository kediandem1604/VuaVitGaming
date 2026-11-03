# GGD Hub — Mượt hơn: tải nhanh và chuyển động thống nhất

- Ngày: 2026-10-28
- Trạng thái: Đã duyệt thiết kế trong chat
- Nhánh: `feat/ggd-hub-v1`

## 1. Mục tiêu

App cảm thấy nhanh và liền mạch trên điện thoại lẫn máy tính: tải ít hơn, chuyển trang gần như tức thì, không nháy trống khi đổi bộ lọc, mọi chuyển động cùng một "nhịp".

## 2. Hiện trạng (đo 2026-10-28)

- Một bundle JS ~478 KB (chưa nén), mọi trang tải hết, kể cả Quản trị.
- Caddy đã nén zstd/gzip (`deploy/server/Caddyfile`) — giữ nguyên.
- File tĩnh trả `Cache-Control: public, max-age=0` (`@fastify/static` mặc định) → lần nào cũng hỏi lại máy chủ.
- Đổi mùa/role: query mới chưa có dữ liệu → `QueryState` hiện trạng thái tải, bảng nháy trống.
- Gần như không có chuyển động (chỉ `lift` khi rê chuột, ngỗng nhún/chớp mắt).

## 3. Ngoài phạm vi

- Thư viện animation mới (framer-motion…), service worker/PWA offline, SSR.
- Đổi bố cục hay màu sắc.

## 4. Tải nhanh

1. **Cache file tĩnh:** `/assets/*` (tên có hash) → `Cache-Control: public, max-age=31536000, immutable`; `index.html` giữ `no-cache` (đã có); file tĩnh khác (favicon, ảnh role tải lên nếu phục vụ qua đây…) → `public, max-age=3600`. Font `.woff2` thuộc `/assets/` nên được cache dài.
2. **Tách theo trang:** mọi trang trong `src/web/App.tsx` (trừ trang chủ `TodayPage`, `LoginPage`, `NotFoundPage`) tải bằng `React.lazy` + `Suspense`; trang Quản trị và các tab của nó thành chunk riêng. Fallback của `Suspense` là khung xương trang (§4.5), không phải màn trống. Vite `build.rollupOptions.output.manualChunks`: tách `react`/`react-dom`/`react-router`/`@tanstack` thành chunk `vendor` để cache lâu dài qua các lần deploy.
3. **Tải trước:** rê chuột (≥ 80ms) hoặc chạm/focus vào link điều hướng (menu trên, dock dưới điện thoại, link trong trang tới trang khác) → gọi `import()` của trang đó và `queryClient.prefetchQuery` cho dữ liệu chính của trang (nếu biết khoá). Một helper dùng chung `src/web/lib/prefetch.ts`; không tải trước khi người dùng bật "tiết kiệm dữ liệu" (`navigator.connection.saveData`).
4. **Giữ dữ liệu cũ:** các query có tham số người dùng đổi (mùa, role, tab tổng điểm, bộ lọc thành viên, phân trang huy hiệu) dùng `placeholderData: keepPreviousData`; trong lúc tải mới, khối đó `aria-busy="true"` và mờ còn 60% (chuyển 120ms), không mất bố cục.
5. **Khung xương:** component `Skeleton` (khối bo góc `night-700`, ánh sáng chạy ngang 1.2s, tắt khi giảm chuyển động) và vài mẫu ghép sẵn: dòng danh sách, thẻ role, bảng xếp hạng, trang. `QueryState` nhận prop `skeleton` (mặc định khung dòng danh sách) thay cho trạng thái tải hiện tại. Chỉ hiện khung xương sau 150ms (tải nhanh hơn thì không nháy).
6. **Phản hồi tức thì:** bấm "Tham gia"/"Huỷ" buổi chơi và bấm vote → cập nhật cache ngay (`onMutate`), lỗi → trả lại như cũ và báo lỗi như hiện nay, xong → `invalidate`.

## 5. Chuyển động thống nhất

**Thông số (CSS custom properties trong `src/web/styles.css`, kèm utility Tailwind):**
- `--dur-fast: 120ms`, `--dur-base: 200ms`, `--dur-slow: 320ms`.
- `--ease-out: cubic-bezier(0.2, 0, 0, 1)` (vào), `--ease-in: cubic-bezier(0.4, 0, 1, 1)` (ra), `--ease-spring: cubic-bezier(0.34, 1.4, 0.64, 1)` (chỉ cho nút lún/nảy nhẹ).
- Mọi `transition`/`animation` mới và cũ trong app dùng các biến này (thay số cứng).

**Áp dụng:**
1. **Chuyển trang:** đổi route → nếu trình duyệt có `document.startViewTransition` thì dùng View Transitions (nội dung `main` mờ ra 120ms, vào 200ms trượt lên 8px; header/dock đứng yên qua `view-transition-name`); không có thì `main` mờ vào + trượt 8px bằng CSS khi khoá route đổi. Không chạy khi chỉ đổi query string (vd `?tab=`).
2. **Lớp nổi** (popup `Select`, `Modal`, gợi ý `RolePicker`, menu): mở = scale 0.96→1 + mờ vào `--dur-base` `--ease-out`, gốc phóng ở phía mở; đóng = mờ ra `--dur-fast` `--ease-in`. Nền mờ của Modal mờ vào/ra.
3. **Tab** (Tổng điểm theo phe, Quản trị, các tablist khác): vạch chỉ báo trượt sang tab mới (`--dur-base`), nội dung tab mờ vào.
4. **Danh sách** lần hiện đầu tiên (bảng xếp hạng, Top 3, Tổng điểm, hàng chờ duyệt, huy hiệu, thành viên): từng dòng mờ + trượt 4px, so le 30ms, chỉ 8 dòng đầu; dữ liệu làm mới sau đó không chạy lại.
5. **Nút** (`btn-*`): nhấn `scale(0.97)` `--dur-fast`; nổi khi rê (`lift`) thống nhất `translateY(-2px)` `--dur-base`.
6. **Số liệu:** điểm trên bục/Top 3/Tổng điểm đổi giá trị → đếm lên trong `--dur-slow` (chỉ khi giá trị thay đổi lúc đang xem, không chạy khi tải lần đầu).
7. **Thông báo/lỗi** (`role="alert"` trong form): trượt xuống 4px + mờ vào.
8. **Giảm chuyển động:** `prefers-reduced-motion: reduce` → tắt mọi chuyển động trên (kể cả View Transitions, đếm số, ánh sáng khung xương), chỉ giữ mờ vào/ra `--dur-fast`.
9. Chỉ dùng `transform`/`opacity` (không animate layout); không chặn tương tác trong lúc chuyển động; không thêm thư viện.

## 6. Đo và tiêu chí xong

- Ghi lại trước/sau vào `docs/perf/2026-10-28-smooth-ui.md`: kích thước từng chunk (`npm run build`), tổng JS tải cho trang chủ và cho trang Bảng xếp hạng (chưa nén và gzip), header cache của `/assets/*`. Nếu chạy được Lighthouse (mobile) trên bản build cục bộ thì ghi điểm Performance, FCP, LCP, TBT trước/sau; không chạy được thì ghi rõ.
- JS tải cho trang chủ giảm ≥ 30% so với 478 KB chưa nén.
- Test: helper prefetch (rê ≥ 80ms mới tải, saveData thì không), `keepPreviousData` không nháy trống (đổi mùa vẫn thấy bảng cũ với `aria-busy`), Skeleton chỉ hiện sau 150ms, cập nhật lạc quan Tham gia/Huỷ và vote (thành công + trả lại khi lỗi), route lazy hiện khung xương rồi trang, giảm chuyển động tắt hiệu ứng (kiểm tra class/thuộc tính), header cache `/assets/*` (test server).
- Kiểm tra tay trên trình duyệt (pane trình duyệt có sẵn, API stub như các lần trước): chuyển trang, mở/đóng Select/Modal, tab, danh sách, 320px.
- `npm run typecheck`, toàn bộ test, `npm run build` đạt.
