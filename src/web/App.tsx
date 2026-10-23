/**
 * Định tuyến: `/login` đứng một mình; mọi trang khác nằm trong `<Layout>` và chỉ
 * render khi đã tải được hồ sơ (`useMe`). Gặp 401 thì api client đã tự đưa về
 * `/login`, ở đây chỉ hiện dòng chờ.
 */

import type { ReactNode } from 'react';
import { BrowserRouter, Outlet, Route, Routes } from 'react-router';
import { ApiError, errorMessage } from './api';
import { Layout } from './components/Layout';
import { useCurrentMember, useMe } from './hooks/useMe';
import { LoginPage } from './pages/LoginPage';
import { MvpPage } from './pages/MvpPage';
import { ForbiddenPage, NotFoundPage, PlaceholderPage } from './pages/PlaceholderPage';
import { ProfilePage } from './pages/ProfilePage';
import { TodayPage } from './pages/TodayPage';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<Shell />}>
          <Route index element={<TodayPage />} />
          <Route path="dai-sanh" element={<PlaceholderPage title="Đại sảnh hoá thân" />} />
          <Route path="bang-xep-hang" element={<PlaceholderPage title="Bảng xếp hạng" />} />
          <Route path="tri-an" element={<MvpPage />} />
          <Route path="khai-diem" element={<PlaceholderPage title="Khai điểm" />} />
          <Route path="ho-so" element={<ProfilePage />} />
          <Route
            path="quan-tri"
            element={
              <StaffOnly>
                <PlaceholderPage title="Quản trị" />
              </StaffOnly>
            }
          />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

function Shell() {
  const me = useMe();

  // Có dữ liệu là giữ khung trang: một lần tải lại ngầm thất bại (TanStack vẫn
  // giữ `data` khi refetch lỗi) không được xoá cả trang và form người dùng đang gõ.
  if (me.data) {
    return (
      <Layout me={me.data}>
        <Outlet context={me.data} />
      </Layout>
    );
  }

  if (me.isError) {
    if (me.error instanceof ApiError && me.error.status === 401) {
      return <FullScreenNotice>Đang chuyển đến trang đăng nhập…</FullScreenNotice>;
    }
    return (
      <FullScreenNotice>
        <p role="alert">{errorMessage(me.error)}</p>
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
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center text-slate-600 dark:text-slate-400">
      {children}
    </div>
  );
}
