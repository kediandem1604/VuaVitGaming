/**
 * Khung trang "Sảnh đêm" (spec §5.1–5.2). Thanh trên dính đầu trang, nền `night-950` mờ
 * 90% làm mờ phía sau: logo + chữ "GGD Hub" vàng viền tối (`text-raised`), cụm người dùng
 * (chip avatar + tên, nút Đăng xuất). Điều hướng là thanh dock cố định dưới cùng (icon
 * lucide 22px + nhãn ngắn 11px, mục đang mở màu vàng có chấm vàng trên icon) cho tới dưới
 * `lg` (1024px); từ `lg` trở lên là hàng viên thuốc (icon 16px + nhãn) nằm trong thanh trên.
 *
 * Vì sao `lg`, và vì sao tên người dùng ẩn từ `lg`: khung tối đa `max-w-5xl` cho 992px dùng
 * được ở MỌI màn hình từ 1056px (ở 1024 còn 977 vì thanh cuộn dọc). Đo bằng Baloo 2 đậm
 * 14px: 7 viên thuốc (icon 16 + nhãn, `px-2`, cách nhau 2px) ≈ 655px, logo 119, hai khoảng
 * cách 24, chip avatar + nút Đăng xuất 138 → ≈ 935px, còn ~45px dư ở 1024 và ~60px từ 1056.
 * Thêm tên cắt ở 128px thì cụm người dùng lên ~280px → ≈ 1080px, không bao giờ vừa; nên tên
 * chỉ hiện dưới `lg` (nơi thanh trên không có hàng link) và chip mang `title` để rê chuột
 * vẫn thấy tên. Hàng link vẫn có `overflow-x-auto` làm lưới an toàn: phông chữ rộng hơn dự
 * tính thì hàng này cuộn trong nó, không đè lên cụm người dùng, không cuộn trang.
 * Ở 768–1023 thanh dock vẫn thừa chỗ (≥ 110px mỗi mục).
 */

import { ChartColumn, Crown, House, PenLine, Trophy, User, Wrench, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { NavLink } from 'react-router';
import type { MeDto } from '../../shared/api-types';
import { apiSend } from '../api';
import { cx } from '../lib/cx';
import { Avatar } from './Avatar';
import { DuckMark } from './DuckMark';

interface NavItem {
  to: string;
  /** Icon lucide (spec §3.4): emoji hiện mỗi máy một kiểu nên không dùng ở thanh điều hướng. */
  icon: LucideIcon;
  label: string;
  /** Nhãn ngắn cho thanh dock dưới cùng; bỏ trống thì dùng `label`. */
  short?: string;
  staffOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', icon: House, label: 'Hôm nay' },
  { to: '/dai-sanh', icon: Crown, label: 'Đại sảnh' },
  { to: '/bang-xep-hang', icon: ChartColumn, label: 'Bảng xếp hạng', short: 'Xếp hạng' },
  { to: '/tri-an', icon: Trophy, label: 'Tri ân' },
  { to: '/khai-diem', icon: PenLine, label: 'Khai điểm' },
  { to: '/ho-so', icon: User, label: 'Hồ sơ' },
  { to: '/quan-tri', icon: Wrench, label: 'Quản trị', staffOnly: true },
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
      <header className="sticky top-0 z-10 border-b-2 border-night-800 bg-night-950/90 backdrop-blur">
        <div className="mx-auto max-w-5xl px-4 py-2">
          <div className="flex items-center gap-3">
            {/* Chữ "GGD Hub" 20px ≥ 18px nên dùng được `text-raised` (spec §3.2). */}
            <NavLink to="/" className="flex shrink-0 items-center gap-1.5 rounded-full whitespace-nowrap">
              <DuckMark className="size-8" />
              <span className="text-raised text-xl leading-none font-extrabold text-gold">GGD Hub</span>
            </NavLink>

            {/*
              Hàng viên thuốc (≥ lg). `min-w-0 flex-1` để nó co theo chỗ còn lại và
              `overflow-x-auto` là lưới an toàn: chỗ chật thì hàng này cuộn trong nó,
              không đè lên cụm người dùng, không cuộn trang. `-m-1 p-1` chừa chỗ cho
              viền focus khỏi bị cắt.
            */}
            <nav
              aria-label="Điều hướng chính"
              className="-m-1 hidden min-w-0 flex-1 items-center gap-0.5 overflow-x-auto p-1 [scrollbar-width:thin] lg:flex"
            >
              {items.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/'}
                    className={({ isActive }) =>
                      cx(
                        'flex items-center gap-1 rounded-full px-2 py-1 text-sm font-bold whitespace-nowrap',
                        isActive ? 'bg-gold text-gold-ink' : 'text-night-200 hover:bg-night-700',
                      )
                    }
                  >
                    <Icon aria-hidden="true" className="size-4 shrink-0" />
                    {item.label}
                  </NavLink>
                );
              })}
            </nav>

            <div className="ml-auto flex shrink-0 items-center gap-2">
              {/*
                Chip người dùng; tên hiện từ sm tới dưới lg, cắt bằng "…" ở 128px, không đẩy nút
                Đăng xuất. Từ lg chỉ còn avatar (bảy mục điều hướng đã kín hàng) và dưới sm cũng
                vậy, nhưng tên vẫn nằm trong cây truy cập (`sr-only`, không phải `hidden`) và ở
                `title` của chip. `sm:truncate` đứng sau `sm:not-sr-only` trong CSS nên thắng phần
                `overflow`/`white-space` mà `not-sr-only` đặt lại.
              */}
              <span
                title={me.displayName}
                className="flex items-center gap-2 rounded-full border-2 border-night-700 bg-night-800 p-0.5 sm:pr-3 lg:pr-0.5"
              >
                <Avatar name={me.displayName} url={me.avatarUrl} className="size-7 text-xs" />
                <span className="sr-only max-w-32 text-sm font-bold text-white sm:not-sr-only sm:block sm:truncate lg:sr-only">
                  {me.displayName}
                </span>
              </span>
              <button
                type="button"
                className="btn-secondary px-3 py-1 text-sm whitespace-nowrap"
                disabled={logoutState === 'busy'}
                onClick={() => void logout()}
              >
                Đăng xuất
              </button>
            </div>
          </div>

          {/* Dòng riêng dưới hàng trên: hàng đó không xuống dòng, chen vào sẽ tràn ngang ở 375px. */}
          {logoutState === 'error' && (
            <p role="alert" className="pt-1 text-right text-xs font-bold text-duck-soft">
              Không đăng xuất được, thử lại
            </p>
          )}
        </div>
      </header>

      {/* Chừa chỗ cho thanh dock khi nó còn hiện (< lg). */}
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-4 pb-24 lg:pb-8">{children}</main>

      {/* Thanh dock: khay tối bo hai góc trên 20px (spec §5.2). */}
      <nav
        aria-label="Điều hướng chính"
        className="fixed inset-x-0 bottom-0 z-10 rounded-t-[20px] border-t-2 border-night-700 bg-night-950 pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        <div className="mx-auto flex w-full max-w-xl">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  cx(
                    'flex min-w-0 flex-1 flex-col items-center gap-0.5 px-0.5 pt-1 pb-1.5 text-[11px] leading-tight font-bold',
                    isActive ? 'text-gold' : 'text-night-300',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {/* Chấm vàng trên icon của mục đang mở; mục khác giữ chỗ bằng chấm trong suốt để icon không nhảy. */}
                    <span aria-hidden="true" className={cx('size-1.5 rounded-full', isActive ? 'bg-gold' : 'bg-transparent')} />
                    <Icon aria-hidden="true" className="size-[22px] shrink-0" strokeWidth={2.25} />
                    {/*
                      320px / 7 mục ≈ 46px, trừ lề còn 42px cho nhãn: nhãn dài cắt bằng "…" thay vì
                      tràn. `tracking-tight` (−0,275px mỗi chữ ở 11px) để "Hôm nay", "Đại sảnh" vừa
                      ở 320px và cả "Khai điểm" (49px) vừa từ 360px.
                    */}
                    <span className="max-w-full truncate tracking-tight">{item.short ?? item.label}</span>
                  </>
                )}
              </NavLink>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
