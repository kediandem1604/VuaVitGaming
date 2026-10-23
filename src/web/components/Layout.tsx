/**
 * Khung trang: thanh trên (tên app, người dùng, đăng xuất). Điều hướng là thanh
 * cố định dưới cùng (icon + nhãn ngắn) cho tới dưới `lg` (1024px); từ `lg` trở
 * lên là hàng link chữ nằm trong thanh trên.
 *
 * Vì sao `lg` và vì sao không có emoji ở hàng trên: khung tối đa `max-w-5xl` cho
 * 992px dùng được; 7 link có emoji (~720px) + logo kèm đầu ngỗng (~115) + khoảng cách
 * (32) + cụm người dùng (≤ ~270 với tên cắt ở 128px) ≈ 1135px, không bao giờ vừa.
 * Link chỉ chữ, `px-2.5` ≈ 520px cho 7 mục → tổng ≈ 935px, còn ~55px dư ở 1024.
 * Ở 768–1023 thanh dưới cùng vẫn thừa chỗ (≥ 110px mỗi mục).
 */

import { useState, type ReactNode } from 'react';
import { NavLink } from 'react-router';
import type { MeDto } from '../../shared/api-types';
import { apiSend } from '../api';
import { cx } from '../lib/cx';
import { Avatar } from './Avatar';
import { DuckMark } from './DuckMark';

interface NavItem {
  to: string;
  icon: string;
  label: string;
  /** Nhãn ngắn cho thanh dưới cùng; bỏ trống thì dùng `label`. */
  short?: string;
  staffOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', icon: '🏠', label: 'Hôm nay' },
  { to: '/dai-sanh', icon: '👑', label: 'Đại sảnh' },
  { to: '/bang-xep-hang', icon: '📊', label: 'Bảng xếp hạng', short: 'Xếp hạng' },
  { to: '/tri-an', icon: '🏆', label: 'Tri ân' },
  { to: '/khai-diem', icon: '✍️', label: 'Khai điểm' },
  { to: '/ho-so', icon: '👤', label: 'Hồ sơ' },
  { to: '/quan-tri', icon: '🛠️', label: 'Quản trị', staffOnly: true },
];

interface LayoutProps {
  me: MeDto;
  children: ReactNode;
}

export function Layout({ me, children }: LayoutProps) {
  const items = NAV_ITEMS.filter((item) => !item.staffOnly || me.accessLevel !== 'member');
  const [logoutState, setLogoutState] = useState<'idle' | 'busy' | 'error'>('idle');

  const logout = async () => {
    setLogoutState('busy');
    try {
      await apiSend<undefined>('POST', '/auth/logout');
      window.location.assign('/login');
    } catch {
      setLogoutState('error');
    }
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
        <div className="mx-auto max-w-5xl px-4 py-2">
          <div className="flex items-center gap-4">
            <NavLink to="/" className="flex shrink-0 items-center gap-1.5 text-lg font-bold whitespace-nowrap text-goose">
              <DuckMark className="size-7" />
              GGD Hub
            </NavLink>

            {/*
              Hàng link chữ (≥ lg). `min-w-0 flex-1` để nó co theo chỗ còn lại và
              `overflow-x-auto` là lưới an toàn: nếu phông chữ rộng hơn dự tính thì
              hàng này cuộn trong nó, không đè lên cụm người dùng, không cuộn trang.
              `-m-1 p-1` chừa chỗ cho viền focus khỏi bị cắt.
            */}
            <nav
              aria-label="Điều hướng chính"
              className="-m-1 hidden min-w-0 flex-1 items-center gap-1 overflow-x-auto p-1 [scrollbar-width:thin] lg:flex"
            >
              {items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) =>
                    cx(
                      'rounded-lg px-2.5 py-1.5 text-sm font-medium whitespace-nowrap transition',
                      isActive
                        ? 'bg-goose/10 text-goose'
                        : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
                    )
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>

            <div className="ml-auto flex shrink-0 items-center gap-2">
              <Avatar name={me.displayName} url={me.avatarUrl} className="size-8 text-sm" />
              {/* Tên dài cắt bằng "…" ở 128px, không đẩy nút Đăng xuất. */}
              <span className="hidden max-w-32 truncate text-sm font-medium sm:block">{me.displayName}</span>
              <button
                type="button"
                className="btn-secondary whitespace-nowrap"
                disabled={logoutState === 'busy'}
                onClick={() => void logout()}
              >
                Đăng xuất
              </button>
            </div>
          </div>

          {/* Dòng riêng dưới hàng trên: hàng đó không xuống dòng, chen vào sẽ tràn ngang ở 375px. */}
          {logoutState === 'error' && (
            <p role="alert" className="pt-1 text-right text-xs text-duck">
              Không đăng xuất được, thử lại
            </p>
          )}
        </div>
      </header>

      {/* Chừa chỗ cho thanh dưới cùng khi nó còn hiện (< lg). */}
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-4 pb-24 lg:pb-8">{children}</main>

      <nav
        aria-label="Điều hướng chính"
        className="fixed inset-x-0 bottom-0 z-10 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] dark:border-slate-800 dark:bg-slate-900 lg:hidden"
      >
        <div className="mx-auto flex w-full max-w-xl">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                cx(
                  'flex min-w-0 flex-1 flex-col items-center gap-0.5 px-0.5 py-1.5 text-[10px] leading-tight font-medium',
                  isActive ? 'text-goose' : 'text-slate-500 dark:text-slate-400',
                )
              }
            >
              <span aria-hidden="true" className="text-xl leading-none">
                {item.icon}
              </span>
              {/* 320px / 7 mục ≈ 45px: nhãn dài nhất cắt bằng "…" thay vì tràn. */}
              <span className="max-w-full truncate">{item.short ?? item.label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
