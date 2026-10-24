import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import type { HallOfDayDto } from '../../src/shared/api-types';
import { DailyHall } from '../../src/web/components/DailyHall';

const hall: HallOfDayDto = {
  date: '2026-10-22',
  sessions: [
    {
      sessionId: 7,
      label: 'Cổ điển 21:00',
      awards: [
        {
          categoryName: 'Giết nhiều nhất',
          winners: [
            { memberId: 1, displayName: 'Ngỗng Một', avatarUrl: 'https://cdn.example/a.png', voteCount: 3 },
            { memberId: 2, displayName: 'Vịt Hai', avatarUrl: null, voteCount: 3 },
          ],
        },
        { categoryName: 'Pha xử lý ngu nhất', winners: [] },
      ],
    },
    {
      sessionId: 8,
      label: 'Săn ngỗng 23:00',
      awards: [
        {
          categoryName: 'Ngỗng chạy giỏi nhất',
          winners: [{ memberId: 3, displayName: 'Ngỗng Ba', avatarUrl: null, voteCount: 1 }],
        },
      ],
    },
  ],
};

afterEach(cleanup);

test('a tie shows every winner with their vote count', () => {
  render(<DailyHall data={hall} />);
  const award = screen.getByText('Giết nhiều nhất').closest('li');
  expect(award).not.toBeNull();
  expect(within(award as HTMLElement).getByText('Ngỗng Một')).toBeInTheDocument();
  expect(within(award as HTMLElement).getByText('Vịt Hai')).toBeInTheDocument();
  expect(within(award as HTMLElement).getAllByText('3 phiếu')).toHaveLength(2);
  // Avatar người thắng chỉ trang trí (tên đã viết bên cạnh): ảnh alt rỗng, chữ cái đầu aria-hidden.
  expect(within(award as HTMLElement).queryByRole('img', { name: 'Ngỗng Một' })).toBeNull();
  expect((award as HTMLElement).querySelector('img')).toHaveAttribute('alt', '');
  expect(within(award as HTMLElement).queryByRole('img', { name: 'Vịt Hai' })).toBeNull();
  expect(within(award as HTMLElement).getByText('V')).toHaveAttribute('aria-hidden', 'true');
});

test('a category nobody voted in says so', () => {
  render(<DailyHall data={hall} />);
  const award = screen.getByText('Pha xử lý ngu nhất').closest('li');
  expect(within(award as HTMLElement).getByText('Không ai được vote')).toBeInTheDocument();
});

test('each session block carries its label and singular counts read fine', () => {
  render(<DailyHall data={hall} />);
  expect(screen.getByRole('heading', { level: 3, name: 'Cổ điển 21:00' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 3, name: 'Săn ngỗng 23:00' })).toBeInTheDocument();
  expect(screen.getByText('1 phiếu')).toBeInTheDocument();
});

test('an empty day shows the given empty message in the shared empty-state box', () => {
  render(<DailyHall data={{ date: '2026-10-22', sessions: [] }} emptyMessage="Chưa có kết quả vote hôm nay" />);
  const empty = screen.getByText('Chưa có kết quả vote hôm nay');
  expect(empty).toBeInTheDocument();
  expect(empty.closest('.panel-inset')).not.toBeNull();
  expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument();
});

test('each session is a panel with a gold title; each award is an inset row with a trophy and gold winners', () => {
  render(<DailyHall data={hall} />);
  const title = screen.getByRole('heading', { level: 3, name: 'Cổ điển 21:00' });
  expect(title).toHaveClass('text-gold');
  expect(title.closest('.panel')).not.toBeNull();

  const award = screen.getByText('Giết nhiều nhất').closest('li') as HTMLElement;
  expect(award).toHaveClass('panel-inset');
  // Icon cúp chỉ trang trí.
  expect(award.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(1);
  expect(screen.getByText('Ngỗng Một')).toHaveClass('text-gold');
  expect(screen.getByText('Vịt Hai')).toHaveClass('text-gold');

  // Hạng mục không ai được vote vẫn là một dòng có cúp, nhưng không có danh sách người thắng.
  const nobody = screen.getByText('Pha xử lý ngu nhất').closest('li') as HTMLElement;
  expect(nobody).toHaveClass('panel-inset');
  expect(nobody.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(1);
  expect(within(nobody).queryByRole('list')).not.toBeInTheDocument();
});
