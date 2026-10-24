/**
 * Trang Quản trị (spec §8): các tab theo quyền — mod thấy Buổi chơi, Duyệt điểm,
 * Thành viên, Gửi lỗi; admin thấy thêm Hạng mục MVP, Role, Cài đặt. Tab đang mở nằm
 * trong `?tab=` để chia sẻ/tải lại được; giá trị lạ (hoặc tab admin với mod) thì về
 * tab mặc định. Mỗi tab là một file riêng trong thư mục này; App đã chặn thành viên
 * thường (`StaffOnly`), server vẫn kiểm tra quyền cho từng API.
 *
 * Giao diện Sảnh đêm (spec §6 Quản trị): thanh tab là dải chip cuộn ngang, tab đang chọn
 * nền `gold`; nội dung các tab ưu tiên dễ đọc hơn trang trí.
 */

import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { useCurrentMember } from '../../hooks/useMe';
import { cx } from '../../lib/cx';
import { CategoriesTab } from './CategoriesTab';
import { FailuresTab } from './FailuresTab';
import { MembersTab } from './MembersTab';
import { ReviewsTab } from './ReviewsTab';
import { RolesTab } from './RolesTab';
import { SessionsTab } from './SessionsTab';
import { SettingsTab } from './SettingsTab';

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
       */}
      <div role="tablist" aria-label="Mục quản trị" className="-mx-4 -my-1.5 flex gap-2 overflow-x-auto px-4 py-1.5 [scrollbar-width:thin]">
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

      <section role="tabpanel" id={`panel-${active.key}`} aria-labelledby={`tab-${active.key}`} className="flex flex-col gap-4">
        {active.render()}
      </section>
    </div>
  );
}
