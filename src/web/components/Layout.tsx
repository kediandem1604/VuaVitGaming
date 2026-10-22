/**
 * Khung trang: thanh trên (tên app, người dùng, đăng xuất); điều hướng nằm ngang
 * trong thanh trên ở màn rộng (≥ 768px) và là thanh cố định dưới cùng ở điện thoại.
 */

import { useState, type ReactNode } from 'react';
import { NavLink } from 'react-router';
import type { MeDto } from '../../shared/api-types';
import { apiSend } from '../api';
import { cx } from '../lib/cx';
import { Avatar } from './Avatar';

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
            <NavLink to="/" className="shrink-0 text-lg font-bold text-goose">
              GGD Hub
            </NavLink>

            <nav aria-label="Điều hướng chính" className="hidden min-w-0 flex-1 gap-1 md:flex">
              {items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) =>
                    cx(
                      'rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap transition',
                      isActive
                        ? 'bg-goose/10 text-goose'
                        : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
                    )
                  }
                >
                  <span aria-hidden="true">{item.icon} </span>
                  {item.label}
                </NavLink>
              ))}
            </nav>

            <div className="ml-auto flex min-w-0 shrink-0 items-center gap-2">
              <Avatar name={me.displayName} url={me.avatarUrl} className="size-8 text-sm" />
              <span className="hidden max-w-40 truncate text-sm font-medium sm:inline">{me.displayName}</span>
              <button
                type="button"
                className="btn-secondary"
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

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-4 pb-24 md:pb-8">{children}</main>

      <nav
        aria-label="Điều hướng chính"
        className="fixed inset-x-0 bottom-0 z-10 flex border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] dark:border-slate-800 dark:bg-slate-900 md:hidden"
      >
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              cx(
                'flex min-w-0 flex-1 flex-col items-center gap-0.5 py-1.5 text-[10px] leading-tight font-medium whitespace-nowrap',
                isActive ? 'text-goose' : 'text-slate-500 dark:text-slate-400',
              )
            }
          >
            <span aria-hidden="true" className="text-xl leading-none">
              {item.icon}
            </span>
            <span>{item.short ?? item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
