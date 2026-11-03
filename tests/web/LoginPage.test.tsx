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

test('the lobby squad is decorative: every drawing is hidden from assistive tech', () => {
  const { container } = renderAt('/login');
  const drawings = container.querySelectorAll('svg');
  expect(drawings.length).toBeGreaterThan(0);
  for (const svg of drawings) expect(svg.closest('[aria-hidden="true"]')).not.toBeNull();
  expect(screen.getByRole('heading', { level: 1, name: 'GGD Hub' })).toBeInTheDocument();
});

test('the squad shows the five kits', () => {
  const { container } = renderAt('/login');
  const members = container.querySelectorAll('[data-member]');
  expect(Array.from(members, (m) => m.getAttribute('data-member')).sort()).toEqual(
    ['ninja', 'detective', 'crown', 'wizard', 'knife'].sort(),
  );
  // Mỗi con mặc đúng bộ đồ của kit (vẽ bằng KitArt, không phải hình riêng).
  for (const member of members) {
    const kit = member.getAttribute('data-member');
    expect(member.querySelector(`[data-kit="${kit}"]`)).not.toBeNull();
    expect(member.querySelector('[data-part="body"]')).not.toBeNull();
  }
});

test('a touched goose hops, and can hop again once the hop has finished', () => {
  const { container } = renderAt('/login');
  const goose = container.querySelector('[data-member="crown"]');
  if (goose === null) throw new Error('no crowned goose on the login page');
  expect(goose).not.toHaveAttribute('data-hopping');

  fireEvent.pointerDown(goose);
  expect(goose).toHaveAttribute('data-hopping');

  fireEvent.animationEnd(goose);
  expect(goose).not.toHaveAttribute('data-hopping');

  fireEvent.pointerDown(goose);
  expect(goose).toHaveAttribute('data-hopping');
});

test('?error=state and ?error=oauth show their own messages', () => {
  renderAt('/login?error=state');
  expect(screen.getByRole('alert')).toHaveTextContent('Phiên đăng nhập hết hạn, thử lại');
  cleanup();
  renderAt('/login?error=oauth');
  expect(screen.getByRole('alert')).toHaveTextContent('Không đăng nhập được với Discord, thử lại');
});
