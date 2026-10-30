/**
 * Các trang tải lười (spec §4.2) và sổ tải trước của chúng (spec §4.3).
 *
 * Trang chủ `TodayPage`, `LoginPage` và hai trang thông báo (`PlaceholderPage`) nằm trong chunk
 * chính; mọi trang khác là `lazyPage` → chunk riêng, chỉ tải khi vào (hoặc tải trước khi người
 * dùng tỏ ý định). Trang Quản trị tải lười từng tab trong `AdminPage`.
 *
 * `registerPrefetchRoute(path, load, data)`: `load` là `preload` — import THÔ, cùng lời hứa với lần
 * render (không import hai lần) nhưng lỗi thì chỉ từ chối, không bao giờ tải lại trang (chỉ lần
 * render thật mới được tải lại, `lib/lazyPage.ts`). `data` nạp sẵn truy vấn chính của trang bằng tuỳ chọn dùng chung ở
 * `lib/queries.ts` — chỉ những truy vấn không phụ thuộc tham số (mùa, role… chưa biết trước).
 */

import type { QueryClient } from '@tanstack/react-query';
import { lazyPage } from './lib/lazyPage';
import { registerPrefetchRoute } from './lib/prefetch';
import { mvpDatesQuery, rolesQuery, seasonsQuery, titlesQuery } from './lib/queries';

export const HallPage = lazyPage(() => import('./pages/HallPage').then((m) => ({ default: m.HallPage })));
export const LeaderboardPage = lazyPage(() => import('./pages/LeaderboardPage').then((m) => ({ default: m.LeaderboardPage })));
export const MvpPage = lazyPage(() => import('./pages/MvpPage').then((m) => ({ default: m.MvpPage })));
export const BadgesPage = lazyPage(() => import('./pages/BadgesPage').then((m) => ({ default: m.BadgesPage })));
export const MemberPage = lazyPage(() => import('./pages/MemberPage').then((m) => ({ default: m.MemberPage })));
export const ReportPage = lazyPage(() => import('./pages/ReportPage').then((m) => ({ default: m.ReportPage })));
export const ProfilePage = lazyPage(() => import('./pages/ProfilePage').then((m) => ({ default: m.ProfilePage })));
export const AdminPage = lazyPage(() => import('./pages/admin/AdminPage').then((m) => ({ default: m.AdminPage })));

/** `prefetchQuery` còn tươi thì TanStack tự bỏ qua, nên gọi mỗi lần tỏ ý định cũng không tốn mạng. */
const seasons = (qc: QueryClient) => void qc.prefetchQuery(seasonsQuery);
const roles = (qc: QueryClient) => void qc.prefetchQuery(rolesQuery);

registerPrefetchRoute('/dai-sanh', HallPage.preload, seasons);
registerPrefetchRoute('/bang-xep-hang', LeaderboardPage.preload, (qc) => {
  seasons(qc);
  roles(qc);
});
registerPrefetchRoute('/tri-an', MvpPage.preload, (qc) => void qc.prefetchQuery(mvpDatesQuery));
registerPrefetchRoute('/huy-hieu', BadgesPage.preload);
registerPrefetchRoute('/khai-diem', ReportPage.preload, roles);
registerPrefetchRoute('/ho-so', ProfilePage.preload, (qc) => void qc.prefetchQuery(titlesQuery));
registerPrefetchRoute('/quan-tri', AdminPage.preload);
// Trang thành viên: một chunk cho mọi id (dữ liệu theo id thì để trang tự tải).
registerPrefetchRoute('/thanh-vien/:id', MemberPage.preload);
