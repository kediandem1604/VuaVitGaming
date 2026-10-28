/**
 * Trang Quản trị (spec §8): các tab theo quyền — mod thấy Buổi chơi, Duyệt điểm,
 * Thành viên, Gửi lỗi; admin thấy thêm Hạng mục MVP, Role, Cài đặt. Tab đang mở nằm
 * trong `?tab=` để chia sẻ/tải lại được; giá trị lạ (hoặc tab admin với mod) thì về
 * tab mặc định. Mỗi tab là một file riêng trong thư mục này; App đã chặn thành viên
 * thường (`StaffOnly`), server vẫn kiểm tra quyền cho từng API.
 *
 * Giao diện Sảnh đêm (spec §6 Quản trị): thanh tab là dải chip cuộn ngang, tab đang chọn
 * nền `gold`; nội dung các tab ưu tiên dễ đọc hơn trang trí.
 *
 * Mỗi tab là một chunk riêng (`lazyPage`, spec §4.2): trang này vốn đã là chunk riêng, tab nào
 * mở mới tải tab đó. Trong lúc chunk về, tabpanel hiện khung xương dòng (sau 150ms).
 */

import { Suspense, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { Delayed, SkeletonRows } from '../../components/Skeleton';
import { TabIndicator } from '../../components/TabIndicator';
import { useCurrentMember } from '../../hooks/useMe';
import { cx } from '../../lib/cx';
import { lazyPage } from '../../lib/lazyPage';

const SessionsTab = lazyPage(() => import('./SessionsTab').then((m) => ({ default: m.SessionsTab })));
const ReviewsTab = lazyPage(() => import('./ReviewsTab').then((m) => ({ default: m.ReviewsTab })));
const MembersTab = lazyPage(() => import('./MembersTab').then((m) => ({ default: m.MembersTab })));
const FailuresTab = lazyPage(() => import('./FailuresTab').then((m) => ({ default: m.FailuresTab })));
const CategoriesTab = lazyPage(() => import('./CategoriesTab').then((m) => ({ default: m.CategoriesTab })));
const RolesTab = lazyPage(() => import('./RolesTab').then((m) => ({ default: m.RolesTab })));
const SettingsTab = lazyPage(() => import('./SettingsTab').then((m) => ({ default: m.SettingsTab })));

const TAB_PARAM = 'tab';

interface TabDef {
  key: string;
  label: string;
  adminOnly: boolean;
  render: () => ReactNode;
}

const SESSIONS_TAB: TabDef = { key: 'buoi-choi', label: 'Buổi chơi', adminOnly: false, render: () => <SessionsTab /> };

const TABS: readonly TabDef[] = [
  SESSIONS_TAB,
  { key: 'duyet-diem', label: 'Duyệt điểm', adminOnly: false, render: () => <ReviewsTab /> },
  { key: 'thanh-vien', label: 'Thành viên', adminOnly: false, render: () => <MembersTab /> },
  { key: 'gui-loi', label: 'Gửi lỗi', adminOnly: false, render: () => <FailuresTab /> },
  { key: 'hang-muc', label: 'Hạng mục MVP', adminOnly: true, render: () => <CategoriesTab /> },
  { key: 'role', label: 'Role', adminOnly: true, render: () => <RolesTab /> },
  { key: 'cai-dat', label: 'Cài đặt', adminOnly: true, render: () => <SettingsTab /> },
];

export function AdminPage() {
  const me = useCurrentMember();
  const [params, setParams] = useSearchParams();

  const tabs = TABS.filter((tab) => !tab.adminOnly || me.accessLevel === 'admin');
  const requested = params.get(TAB_PARAM);
  const active = tabs.find((tab) => tab.key === requested) ?? SESSIONS_TAB;

  const select = (key: string) => {
    const next = new URLSearchParams(params);
    next.set(TAB_PARAM, key);
    setParams(next, { replace: true });
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Tiêu đề 30px ≥ 18px nên dùng được chữ nổi `text-raised` (spec §3.2). */}
      <h1 className="text-raised text-3xl leading-none font-extrabold text-white">Quản trị</h1>

      {/*
       * Dải chip cuộn ngang trong chính nó (không cuộn cả trang); `-mx-4 px-4` cho dải chạm
       * mép màn hình nhỏ, `-my-1.5 py-1.5` chừa chỗ cho viền focus 3px (+2px) không bị khung cuộn cắt.
       * `relative` để vạch chỉ báo (`TabIndicator`) trượt theo tab đang chọn, cuộn cùng dải (spec §5.3).
       */}
      <div role="tablist" aria-label="Mục quản trị" className="relative -mx-4 -my-1.5 flex gap-2 overflow-x-auto px-4 py-1.5 [scrollbar-width:thin]">
        <TabIndicator selectedId={`tab-${active.key}`} />
        {tabs.map((tab) => {
          const selected = tab.key === active.key;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              id={`tab-${tab.key}`}
              aria-selected={selected}
              aria-controls={`panel-${tab.key}`}
              className={cx('chip shrink-0 px-4 py-1.5 text-base hover:brightness-110', selected && 'bg-gold text-gold-ink')}
              onClick={() => select(tab.key)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* `key` theo tab để nội dung tab mới mờ vào (`tab-enter`, spec §5.3). */}
      <section key={active.key} role="tabpanel" id={`panel-${active.key}`} aria-labelledby={`tab-${active.key}`} className="tab-enter flex flex-col gap-4">
        <Suspense
          fallback={
            <Delayed>
              <SkeletonRows />
            </Delayed>
          }
        >
          {active.render()}
        </Suspense>
      </section>
    </div>
  );
}
