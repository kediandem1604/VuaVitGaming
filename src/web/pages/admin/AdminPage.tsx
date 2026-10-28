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
 * Mỗi tab là một chunk riêng (`lazyPage`, spec §4.2): trang này vốn đã là chunk riêng. Khi trang
 * mở, mọi tab người này được xem tải trước (trừ khi "tiết kiệm dữ liệu" — khi đó rê chuột/focus
 * vào chip mới tải), để đổi tab không phải chờ. Tabpanel có `key` theo tab nên mỗi tab là một
 * `Suspense` mới: chunk chưa về thì chip đích vẫn sáng ngay và tabpanel hiện khung xương dòng
 * (sau 150ms, kèm `role="status"` "Đang tải…") thay vì giữ tab cũ.
 */

import { Suspense, useEffect, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { PageErrorBoundary } from '../../components/PageErrorBoundary';
import { LoadingFallback, SkeletonRows } from '../../components/Skeleton';
import { TabIndicator } from '../../components/TabIndicator';
import { useCurrentMember } from '../../hooks/useMe';
import { cx } from '../../lib/cx';
import { lazyPage } from '../../lib/lazyPage';
import { saveDataOn } from '../../lib/prefetch';

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
  /** Import thô chunk của tab (lỗi chỉ từ chối, không tải lại trang). */
  preload: () => Promise<unknown>;
}

const SESSIONS_TAB: TabDef = { key: 'buoi-choi', label: 'Buổi chơi', adminOnly: false, render: () => <SessionsTab />, preload: SessionsTab.preload };

const TABS: readonly TabDef[] = [
  SESSIONS_TAB,
  { key: 'duyet-diem', label: 'Duyệt điểm', adminOnly: false, render: () => <ReviewsTab />, preload: ReviewsTab.preload },
  { key: 'thanh-vien', label: 'Thành viên', adminOnly: false, render: () => <MembersTab />, preload: MembersTab.preload },
  { key: 'gui-loi', label: 'Gửi lỗi', adminOnly: false, render: () => <FailuresTab />, preload: FailuresTab.preload },
  { key: 'hang-muc', label: 'Hạng mục MVP', adminOnly: true, render: () => <CategoriesTab />, preload: CategoriesTab.preload },
  { key: 'role', label: 'Role', adminOnly: true, render: () => <RolesTab />, preload: RolesTab.preload },
  { key: 'cai-dat', label: 'Cài đặt', adminOnly: true, render: () => <SettingsTab />, preload: SettingsTab.preload },
];

/** Tải trước một tab; lỗi nuốt — lần render thật sẽ tự tải (và `lazyPage` lo chunk hỏng). */
const warm = (tab: TabDef) => void tab.preload().catch(() => undefined);

export function AdminPage() {
  const me = useCurrentMember();
  const [params, setParams] = useSearchParams();

  const tabs = TABS.filter((tab) => !tab.adminOnly || me.accessLevel === 'admin');
  const requested = params.get(TAB_PARAM);
  const active = tabs.find((tab) => tab.key === requested) ?? SESSIONS_TAB;
  
  const canSeeAdmin = me.accessLevel === 'admin';
  useEffect(() => {
    if (saveDataOn()) return;
    for (const tab of TABS) if (!tab.adminOnly || canSeeAdmin) warm(tab);
  }, [canSeeAdmin]);

  const select = (tab: TabDef) => {
    warm(tab);
    const next = new URLSearchParams(params);
    next.set(TAB_PARAM, tab.key);
    setParams(next, { replace: true });
  };
  const intent = (tab: TabDef) => () => {
    if (!saveDataOn()) warm(tab);
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
              onClick={() => select(tab)}
              onPointerEnter={intent(tab)}
              onFocus={intent(tab)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* `key` theo tab để nội dung tab mới mờ vào (`tab-enter`, spec §5.3). */}
      <section
        key={active.key}
        role="tabpanel"
        id={`panel-${active.key}`}
        aria-labelledby={`tab-${active.key}`}
        className="tab-enter flex flex-col gap-4"
      >
        <PageErrorBoundary>
          <Suspense
            fallback={
              <LoadingFallback>
                <SkeletonRows />
              </LoadingFallback>
            }
          >
            {active.render()}
          </Suspense>
        </PageErrorBoundary>
      </section>
    </div>
  );
}
