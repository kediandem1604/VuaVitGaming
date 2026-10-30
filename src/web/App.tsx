/**
 * Định tuyến: `/login` đứng một mình; mọi trang khác nằm trong `<Layout>` và chỉ
 * render khi đã tải được hồ sơ (`useMe`). Gặp 401 thì api client đã tự đưa về
 * `/login`, ở đây chỉ hiện dòng chờ.
 *
 * Trang chủ (`TodayPage`) và hai trang thông báo nằm trong chunk chính; các trang khác là
 * chunk riêng (`routes.tsx`, spec §4.2). `Suspense` bọc `Outlet` nên header/dock của `Layout`
 * đứng yên trong lúc chunk về; fallback là khung xương trang, chỉ hiện sau 150ms.
 */

import { Suspense, type ReactNode } from 'react';
import { BrowserRouter, Outlet, Route, Routes, useLocation } from 'react-router';
import { ApiError, errorMessage } from './api';
import { HalloweenDecor } from './components/HalloweenDecor';
import { Layout } from './components/Layout';
import { PageErrorBoundary } from './components/PageErrorBoundary';
import { LoadingFallback, PageSkeleton } from './components/Skeleton';
import { useCurrentMember, useMe } from './hooks/useMe';
import { prefersReducedMotion } from './lib/motion';
import { useEndStaleNavigation } from './lib/navPending';
import { supportsViewTransitions, useDisplayedLocation } from './lib/viewTransition';
import { LoginPage } from './pages/LoginPage';
import { ForbiddenPage, NotFoundPage } from './pages/PlaceholderPage';
import { TodayPage } from './pages/TodayPage';
import { AdminPage, BadgesPage, HallPage, LeaderboardPage, MemberPage, MvpPage, ProfilePage, ReportPage } from './routes';

export function App() {
  return (
    <BrowserRouter>
      <HalloweenDecor />
      <RoutedApp />
    </BrowserRouter>
  );
}

/**
 * Cây route nhận vị trí qua `useDisplayedLocation` (spec §5.1): đổi `pathname` thì DOM đổi bên
 * trong `document.startViewTransition` (trang cũ mờ ra, trang mới mờ vào trượt lên; header/dock
 * đứng yên nhờ `view-transition-name` trong `Layout`); đổi query string thì đổi ngay. Mọi hook
 * `useLocation`/`useSearchParams`/`useParams` bên trong đều đọc vị trí hiển thị này.
 */
function RoutedApp() {
  // Ở đây (ngoài `<Routes>`) thấy vị trí router: lượt chuyển trang bị đè thì tắt "đang chuyển trang".
  useEndStaleNavigation();
  const displayed = useDisplayedLocation();
  return (
    <Routes location={displayed}>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<Shell />}>
        <Route index element={<TodayPage />} />
        <Route path="dai-sanh" element={<HallPage />} />
        <Route path="bang-xep-hang" element={<LeaderboardPage />} />
        <Route path="tri-an" element={<MvpPage />} />
        <Route path="huy-hieu" element={<BadgesPage />} />
        <Route path="thanh-vien/:id" element={<MemberPage />} />
        <Route path="khai-diem" element={<ReportPage />} />
        <Route path="ho-so" element={<ProfilePage />} />
        <Route
          path="quan-tri"
          element={
            <StaffOnly>
              <AdminPage />
            </StaffOnly>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

function Shell() {
  const me = useMe();
  // Vị trí hiển thị (xem `RoutedApp`): khoá trang để chạy hoạt ảnh vào khi không có View Transitions.
  const { pathname } = useLocation();

  // Có dữ liệu là giữ khung trang: một lần tải lại ngầm thất bại (TanStack vẫn
  // giữ `data` khi refetch lỗi) không được xoá cả trang và form người dùng đang gõ.
  if (me.data) {
    // Không có View Transitions (hoặc máy giảm chuyển động → chỉ mờ vào nhanh): trang mới mờ vào +
    // trượt 8px bằng CSS khi `pathname` đổi (`key`); đổi query string không gắn lại (spec §5.1).
    const cssEnter = !supportsViewTransitions() || prefersReducedMotion();
    return (
      <Layout me={me.data}>
        <div key={pathname} className={cssEnter ? 'page-enter' : undefined}>
          {/* Chunk vẫn hỏng sau lần tự tải lại → panel lỗi + "Tải lại trang"; `key` theo trang nên sang trang khác là thử lại. */}
          <PageErrorBoundary>
            <Suspense
              fallback={
                <LoadingFallback>
                  <PageSkeleton />
                </LoadingFallback>
              }
            >
              <Outlet context={me.data} />
            </Suspense>
          </PageErrorBoundary>
        </div>
      </Layout>
    );
  }

  if (me.isError) {
    if (me.error instanceof ApiError && me.error.status === 401) {
      return <FullScreenNotice>Đang chuyển đến trang đăng nhập…</FullScreenNotice>;
    }
    return (
      <FullScreenNotice>
        <p role="alert" className="font-bold text-duck-soft">
          {errorMessage(me.error)}
        </p>
        <button type="button" className="btn-secondary" onClick={() => void me.refetch()}>
          Thử lại
        </button>
      </FullScreenNotice>
    );
  }

  return <FullScreenNotice>Đang tải…</FullScreenNotice>;
}

/** Chỉ mod/admin; thành viên thường thấy thông báo không có quyền. */
function StaffOnly({ children }: { children: ReactNode }) {
  const me = useCurrentMember();
  return me.accessLevel === 'member' ? <ForbiddenPage /> : children;
}

function FullScreenNotice({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center text-night-300">
      {children}
    </div>
  );
}
