import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

test('a failed logout shows its alert on its own line under the header row', async () => {
  const assign = vi.fn();
  vi.stubGlobal('location', { pathname: '/', assign });
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

  render(
    <MemoryRouter>
      <Layout me={me}>
        <p>nội dung</p>
      </Layout>
    </MemoryRouter>,
  );

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
