import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import type { RoleDto } from '../../src/shared/api-types';
import { EmptyState } from '../../src/web/components/EmptyState';
import { RoleCard } from '../../src/web/components/RoleCard';

const swordsman: RoleDto = {
  id: 61,
  key: 'swordsman',
  faction: 'duck',
  nameVi: 'Kiếm sĩ',
  nameEn: 'Swordsman',
  description: 'Vung kiếm chém mọi người đứng gần.',
  metricLabel: 'Số mạng chém',
  maxPerGame: 15,
  mapNote: 'Có từ v4.10 (08/2026)',
  modeKey: null,
  icon: '⚔️',
  hasImage: false,
  active: true,
  sortOrder: 31,
};

afterEach(cleanup);

test('the banner names the faction in capitals', () => {
  // Chữ trắng đặt trên bản `-strong` của màu phe (hoặc `third`), không đặt thẳng lên `goose`/`duck`.
  const cases: ReadonlyArray<[RoleDto['faction'], string, string]> = [
    ['goose', 'PHE NGỖNG', 'bg-goose-strong'],
    ['duck', 'PHE VỊT', 'bg-duck-strong'],
    ['neutral', 'PHE THỨ 3', 'bg-third'],
  ];
  for (const [faction, banner, background] of cases) {
    const { unmount } = render(<RoleCard role={{ ...swordsman, faction }} holderName="Kẹ" variant="current" score={31} />);
    const band = screen.getByText(banner);
    expect(band.className).toMatch(new RegExp(`\\b${background}\\b`));
    expect(band.className).toMatch(/\btext-white\b/);
    unmount();
  }
});

test('score line shows the score and the metric', () => {
  const { unmount } = render(<RoleCard role={swordsman} holderName="Kẹ" variant="current" score={31} />);
  expect(screen.getByText('31')).toBeInTheDocument();
  expect(screen.getByText('mạng chém')).toBeInTheDocument();
  // Toàn dòng đọc liền "31 mạng chém" (các trang kiểm bằng toHaveTextContent).
  expect(screen.getByText('31').parentElement).toHaveTextContent(/^31 mạng chém$/);
  unmount();

  render(<RoleCard role={swordsman} holderName="Kẹ" variant="current" score={null} />);
  expect(screen.queryByText('Số mạng chém')).not.toBeInTheDocument();
});

test('an empty role invites a report without nesting a link', () => {
  const { container } = render(<RoleCard role={swordsman} holderName={null} variant="empty" score={null} />);
  expect(screen.getByText('Khai điểm để giành')).toBeInTheDocument();
  expect(screen.queryByRole('link')).toBeNull();
  // Nhân vật là hình bóng "Chưa ai hoá thân"; thẻ viền nét đứt.
  expect(screen.getByRole('img', { name: 'Kiếm sĩ: Chưa ai hoá thân' })).toBeInTheDocument();
  expect(container.firstElementChild?.className).toMatch(/\bborder-dashed\b/);
  cleanup();

  render(<RoleCard role={swordsman} holderName="Kẹ" variant="current" score={31} />);
  expect(screen.queryByText('Khai điểm để giành')).not.toBeInTheDocument();
});

test('long names wrap inside the card', () => {
  const holder = 'Nguyễn Hoàng Minh Khang!'; // 24 ký tự
  expect(Array.from(holder)).toHaveLength(24);
  const lobbyist = { ...swordsman, nameVi: 'Người vận động hành lang' };
  const { container } = render(<RoleCard role={lobbyist} holderName={holder} variant="current" score={5} />);

  expect(container.firstElementChild?.className).toMatch(/\bmin-w-0\b/);
  expect(screen.getByText('Người vận động hành lang').className).toMatch(/\bbreak-words\b/);
});

test('extra content and className reach the card', () => {
  const { container } = render(
    <RoleCard role={swordsman} holderName="Kẹ" variant="previous" score={12} className="h-full" extra={<p>Có từ v4.10</p>} />,
  );
  expect(container.firstElementChild?.className).toMatch(/\bh-full\b/);
  expect(screen.getByText('Có từ v4.10')).toBeInTheDocument();
  // `variant` đi thẳng vào Character: mùa trước có nhãn "Mùa trước".
  expect(screen.getByText('Mùa trước')).toBeInTheDocument();
});

test('empty state shows its text beside a decorative goose', () => {
  const { container } = render(<EmptyState>Chưa có mùa nào</EmptyState>);
  expect(screen.getByText('Chưa có mùa nào')).toBeInTheDocument();
  const goose = container.querySelector('svg');
  expect(goose).not.toBeNull();
  expect(goose?.closest('[aria-hidden="true"]')).not.toBeNull();
  expect(goose?.querySelector('[data-part="body"]')).not.toBeNull();
  expect(container.firstElementChild?.className).toMatch(/\bpanel-inset\b/);
});
