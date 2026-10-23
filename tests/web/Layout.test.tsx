import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import type { MeDto } from '../../src/shared/api-types';
import { Layout } from '../../src/web/components/Layout';

const me: MeDto = {
  id: 1,
  memberCode: 'GGD-0001',
  displayName: 'Ngỗng Một',
  avatarUrl: null,
  email: null,
  notifyEmail: true,
  notifyDm: true,
  accessLevel: 'member',
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const renderLayout = (who: MeDto, path = '/') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Layout me={who}>
        <p>nội dung</p>
      </Layout>
    </MemoryRouter>,
  );

test('Quản trị appears in both navs for mod/admin only', () => {
  renderLayout(me);
  expect(screen.queryByRole('link', { name: /Quản trị/ })).not.toBeInTheDocument();
  expect(screen.getAllByRole('link', { name: /Hồ sơ/ })).toHaveLength(2);
  cleanup();

  renderLayout({ ...me, accessLevel: 'admin' });
  expect(screen.getAllByRole('link', { name: /Quản trị/ })).toHaveLength(2);
});

test('the brand link shows the duck mark without changing its name', () => {
  renderLayout(me);
  const brand = screen.getByRole('link', { name: 'GGD Hub' });
  const mark = brand.querySelector('svg');
  expect(mark).not.toBeNull();
  expect(mark).toHaveAttribute('aria-hidden', 'true');
});

// jsdom không dựng bố cục, nên chỉ kiểm tra cấu trúc: hàng link trên, thanh dưới
// cùng và phần đệm nội dung phải đổi ở CÙNG một breakpoint (lg), nếu không sẽ có
// khoảng rộng vừa mất thanh dưới vừa chưa có hàng trên (hoặc có cả hai).
test('header nav, bottom bar and content padding switch at the same breakpoint', () => {
  renderLayout({ ...me, accessLevel: 'admin' });
  const [headerNav, bottomNav] = screen.getAllByRole('navigation', { name: 'Điều hướng chính' });
  const main = screen.getByRole('main');

  expect(headerNav?.className).toMatch(/\bhidden\b/);
  expect(headerNav?.className).toMatch(/\blg:flex\b/);
  expect(headerNav?.className).toMatch(/\bmin-w-0\b/);
  expect(headerNav?.className).toMatch(/\boverflow-x-auto\b/);
  expect(bottomNav?.className).toMatch(/\bfixed\b/);
  expect(bottomNav?.className).toMatch(/\blg:hidden\b/);
  expect(main.className).toMatch(/\blg:pb-/);

  // Tên hiển thị phải cắt bằng "…" (max-w + truncate), không đẩy nút Đăng xuất.
  const name = screen.getByText(me.displayName);
  expect(name.className).toMatch(/\bmax-w-\d+\b/);
  expect(name.className).toMatch(/\btruncate\b/);
});

test('navigation uses drawn icons, not emoji', () => {
  renderLayout({ ...me, accessLevel: 'admin' });
  const navs = screen.getAllByRole('navigation', { name: 'Điều hướng chính' });
  expect(navs).toHaveLength(2);
  for (const nav of navs) {
    // Emoji hiện mỗi máy một kiểu (spec §3.4) — thanh điều hướng chỉ còn chữ và icon vẽ.
    expect(nav.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
    const links = within(nav).getAllByRole('link');
    expect(links).toHaveLength(7);
    for (const link of links) {
      expect(link.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(1);
    }
  }
});

test('the open page is marked in gold in both navs', () => {
  renderLayout(me, '/ho-so');
  const [headerLink, dockLink] = screen.getAllByRole('link', { name: /Hồ sơ/ });
  expect(headerLink).toHaveAttribute('aria-current', 'page');
  expect(dockLink).toHaveAttribute('aria-current', 'page');
  // Hàng trên: viên thuốc nền vàng chữ `gold-ink`; thanh dưới: icon và nhãn vàng.
  expect(headerLink?.className).toMatch(/\bbg-gold\b/);
  expect(headerLink?.className).toMatch(/\btext-gold-ink\b/);
  expect(dockLink?.className).toMatch(/\btext-gold\b/);

  const [otherHeader, otherDock] = screen.getAllByRole('link', { name: /Hôm nay/ });
  expect(otherHeader).not.toHaveAttribute('aria-current');
  expect(otherHeader?.className).not.toMatch(/\bbg-gold\b/);
  expect(otherDock?.className).not.toMatch(/\btext-gold\b/);
});

test('a failed logout shows its alert on its own line under the header row', async () => {
  const assign = vi.fn();
  vi.stubGlobal('location', { pathname: '/', assign });
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

  renderLayout(me);

  const button = screen.getByRole('button', { name: 'Đăng xuất' });
  fireEvent.click(button);

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Không đăng xuất được, thử lại');
  expect(assign).not.toHaveBeenCalled();

  // Thông báo không được chen vào cụm người dùng hay hàng ngang đầu trang
  // (hàng đó không xuống dòng, ở 375px sẽ tràn ngang)…
  expect(button.parentElement).not.toContainElement(alert);
  expect(button.parentElement?.parentElement).not.toContainElement(alert);
  // …mà là khối riêng ngay dưới hàng chứa nút Đăng xuất.
  expect(alert.previousElementSibling).not.toBe(button);
  expect(alert.previousElementSibling).toContainElement(button);
});
