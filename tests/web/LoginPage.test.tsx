import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

test('the duck squad is decorative: every drawing is hidden from assistive tech', () => {
  const { container } = renderAt('/login');
  const drawings = container.querySelectorAll('svg');
  expect(drawings.length).toBeGreaterThan(0);
  for (const svg of drawings) expect(svg.closest('[aria-hidden="true"]')).not.toBeNull();
  expect(screen.getByRole('heading', { level: 1, name: 'GGD Hub' })).toBeInTheDocument();
});

test('a touched duck hops, and can hop again once the hop has finished', () => {
  const { container } = renderAt('/login');
  const duck = container.querySelector('[data-duck]');
  if (duck === null) throw new Error('no duck on the login page');
  expect(duck).not.toHaveAttribute('data-hopping');

  fireEvent.pointerDown(duck);
  expect(duck).toHaveAttribute('data-hopping');

  fireEvent.animationEnd(duck);
  expect(duck).not.toHaveAttribute('data-hopping');

  fireEvent.pointerDown(duck);
  expect(duck).toHaveAttribute('data-hopping');
});

test('?error=state and ?error=oauth show their own messages', () => {
  renderAt('/login?error=state');
  expect(screen.getByRole('alert')).toHaveTextContent('Phiên đăng nhập hết hạn, thử lại');
  cleanup();
  renderAt('/login?error=oauth');
  expect(screen.getByRole('alert')).toHaveTextContent('Không đăng nhập được với Discord, thử lại');
});
