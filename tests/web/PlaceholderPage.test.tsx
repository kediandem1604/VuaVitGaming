import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, test } from 'vitest';
import { ForbiddenPage, NotFoundPage } from '../../src/web/pages/PlaceholderPage';

afterEach(cleanup);

test.each([
  ['not found', NotFoundPage, 'Không tìm thấy trang'],
  ['forbidden', ForbiddenPage, 'Bạn không có quyền xem trang này'],
])('the %s page has a raised white title, a panel with a goose and a gold link home', (_, Page, title) => {
  render(
    <MemoryRouter>
      <Page />
    </MemoryRouter>,
  );
  const heading = screen.getByRole('heading', { level: 1, name: title });
  expect(heading).toHaveClass('text-raised', 'text-white');

  const home = screen.getByRole('link', { name: 'Về trang Hôm nay' });
  expect(home).toHaveAttribute('href', '/');
  expect(home).toHaveClass('btn-primary');

  const panel = home.closest('.panel') as HTMLElement;
  expect(panel).not.toBeNull();
  // Ngỗng nhỏ chỉ trang trí.
  expect(panel.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
});
