import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, test } from 'vitest';
import { LoginPage } from '../../src/web/pages/LoginPage';

afterEach(cleanup);

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <LoginPage />
    </MemoryRouter>,
  );

test('shows the Discord login link', () => {
  renderAt('/login');
  const link = screen.getByRole('link', { name: 'Đăng nhập bằng Discord' });
  expect(link).toHaveAttribute('href', '/auth/login');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('?error=not_member explains that the user must join the server', () => {
  renderAt('/login?error=not_member');
  expect(screen.getByRole('alert')).toHaveTextContent('Bạn cần vào server Discord trước');
});

test('?error=state and ?error=oauth show their own messages', () => {
  renderAt('/login?error=state');
  expect(screen.getByRole('alert')).toHaveTextContent('Phiên đăng nhập hết hạn, thử lại');
  cleanup();
  renderAt('/login?error=oauth');
  expect(screen.getByRole('alert')).toHaveTextContent('Không đăng nhập được với Discord, thử lại');
});
