import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { SessionAttendeeDto, SessionDto } from '../../src/shared/api-types';
import { SessionCard } from '../../src/web/components/SessionCard';

const a: SessionAttendeeDto = { memberId: 1, displayName: 'Ngỗng Một', avatarUrl: 'https://cdn.example/a.png' };
const b: SessionAttendeeDto = { memberId: 2, displayName: 'Vịt Hai', avatarUrl: null };

const s: SessionDto = {
  id: 7,
  // 14:00Z = 21:00 giờ Việt Nam.
  startsAt: '2026-10-22T14:00:00.000Z',
  modeName: 'Cổ điển',
  capacity: 16,
  roomCode: null,
  note: null,
  status: 'scheduled',
  attendees: [a],
  myStatus: null,
};

afterEach(cleanup);

test('full session disables join with label', () => {
  render(<SessionCard session={{ ...s, capacity: 2, attendees: [a, b], myStatus: null }} onToggle={vi.fn()} pending={false} />);
  expect(screen.getByRole('button', { name: 'Đã đủ người' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Tham gia' })).not.toBeInTheDocument();
});

test('open session offers join and calls onToggle(true)', () => {
  const onToggle = vi.fn();
  render(<SessionCard session={s} onToggle={onToggle} pending={false} />);
  fireEvent.click(screen.getByRole('button', { name: 'Tham gia' }));
  expect(onToggle).toHaveBeenCalledTimes(1);
  expect(onToggle).toHaveBeenCalledWith(true);
});

test('attending member sees cancel', () => {
  const onToggle = vi.fn();
  render(<SessionCard session={{ ...s, attendees: [a, b], myStatus: 'going' }} onToggle={onToggle} pending={false} />);
  const button = screen.getByRole('button', { name: 'Huỷ tham gia' });
  expect(button).toBeEnabled();
  fireEvent.click(button);
  expect(onToggle).toHaveBeenCalledWith(false);
});

test('a going member on a full session can still leave', () => {
  render(<SessionCard session={{ ...s, capacity: 2, attendees: [a, b], myStatus: 'going' }} onToggle={vi.fn()} pending={false} />);
  expect(screen.getByRole('button', { name: 'Huỷ tham gia' })).toBeEnabled();
  expect(screen.queryByText('Đã đủ người')).not.toBeInTheDocument();
});

test('room code shown when present', () => {
  render(<SessionCard session={{ ...s, roomCode: 'ABCD' }} onToggle={vi.fn()} pending={false} />);
  expect(screen.getByText('Mã phòng: ABCD')).toBeInTheDocument();
  cleanup();
  render(<SessionCard session={s} onToggle={vi.fn()} pending={false} />);
  expect(screen.queryByText(/Mã phòng/)).not.toBeInTheDocument();
});

test('shows Vietnam time, mode, count and note', () => {
  render(<SessionCard session={{ ...s, attendees: [a, b], note: 'Map mới' }} onToggle={vi.fn()} pending={false} />);
  expect(screen.getByText('21:00')).toBeInTheDocument();
  expect(screen.getByText('Cổ điển')).toBeInTheDocument();
  expect(screen.getByText('2/16')).toBeInTheDocument();
  expect(screen.getByText('Map mới')).toBeInTheDocument();
});

test('pending disables the button and shows progress text', () => {
  const onToggle = vi.fn();
  render(<SessionCard session={s} onToggle={onToggle} pending={true} />);
  const button = screen.getByRole('button', { name: 'Đang xử lý…' });
  expect(button).toBeDisabled();
  fireEvent.click(button);
  expect(onToggle).not.toHaveBeenCalled();
});

test('cancelled and ended sessions show a badge and no button', () => {
  render(<SessionCard session={{ ...s, status: 'cancelled' }} onToggle={vi.fn()} pending={false} />);
  expect(screen.getByText('Đã huỷ')).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  cleanup();
  render(<SessionCard session={{ ...s, status: 'ended', myStatus: 'going' }} onToggle={vi.fn()} pending={false} />);
  expect(screen.getByText('Đã kết thúc')).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  cleanup();
  render(<SessionCard session={s} onToggle={vi.fn()} pending={false} />);
  expect(screen.queryByText('Đã huỷ')).not.toBeInTheDocument();
  expect(screen.queryByText('Đã kết thúc')).not.toBeInTheDocument();
});

test('attendee avatars carry the display name and overflow past 8 collapses to +X', () => {
  const many: SessionAttendeeDto[] = Array.from({ length: 11 }, (_, i) => ({
    memberId: i + 1,
    displayName: `Người ${i + 1}`,
    avatarUrl: i % 2 === 0 ? `https://cdn.example/${i + 1}.png` : null,
  }));
  render(<SessionCard session={{ ...s, capacity: 16, attendees: many }} onToggle={vi.fn()} pending={false} />);

  const list = screen.getByRole('list', { name: 'Người tham gia' });
  expect(within(list).getAllByRole('img')).toHaveLength(8);
  expect(within(list).getByRole('img', { name: 'Người 1' })).toBeInTheDocument();
  expect(within(list).getByRole('img', { name: 'Người 2' })).toBeInTheDocument();
  expect(within(list).queryByRole('img', { name: 'Người 9' })).not.toBeInTheDocument();
  expect(within(list).getByText('+3')).toBeInTheDocument();
});

test('shows the error message near the button', () => {
  render(<SessionCard session={s} onToggle={vi.fn()} pending={false} error="Đã đủ người" />);
  expect(screen.getByRole('alert')).toHaveTextContent('Đã đủ người');
});
