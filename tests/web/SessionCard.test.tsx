import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** `n` người tham gia tên `Người 1..n`, người lẻ không có ảnh. */
const people = (n: number): SessionAttendeeDto[] =>
  Array.from({ length: n }, (_, i) => ({
    memberId: i + 1,
    displayName: `Người ${i + 1}`,
    avatarUrl: i % 2 === 0 ? `https://cdn.example/${i + 1}.png` : null,
  }));

const seatRow = () => screen.getByRole('list', { name: 'Hàng ghế' });

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

test('shows Vietnam time, mode, seat count and note', () => {
  render(<SessionCard session={{ ...s, attendees: [a, b], note: 'Map mới' }} onToggle={vi.fn()} pending={false} />);
  expect(screen.getByText('21:00')).toBeInTheDocument();
  expect(screen.getByText('Cổ điển')).toBeInTheDocument();
  expect(screen.getByText('2/16 ghế đã có người')).toBeInTheDocument();
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

test('one seat per place, filled seats show who is coming', () => {
  render(<SessionCard session={{ ...s, capacity: 12, attendees: people(8) }} onToggle={vi.fn()} pending={false} />);

  const seats = within(seatRow()).getAllByRole('listitem');
  expect(seats).toHaveLength(12);
  expect(screen.getAllByLabelText('Ghế trống')).toHaveLength(4);
  // Mỗi ô có người là một avatar mang tên người đó (ảnh có alt, chữ cái đầu có aria-label).
  expect(within(seatRow()).getAllByRole('img')).toHaveLength(8);
  expect(within(seatRow()).getByRole('img', { name: 'Người 1' })).toBeInTheDocument();
  expect(within(seatRow()).getByRole('img', { name: 'Người 8' })).toBeInTheDocument();
  // Ghế có người đứng trước ghế trống.
  expect(within(seats[0] as HTMLElement).getByRole('img', { name: 'Người 1' })).toBeInTheDocument();
  expect(seats[11]).toHaveAttribute('aria-label', 'Ghế trống');
  expect(screen.getByText('8/12 ghế đã có người')).toBeInTheDocument();
});

test('more attendees than seats still shows everyone', () => {
  render(<SessionCard session={{ ...s, capacity: 3, attendees: people(5) }} onToggle={vi.fn()} pending={false} />);
  expect(within(seatRow()).getAllByRole('listitem')).toHaveLength(5);
  expect(screen.queryAllByLabelText('Ghế trống')).toHaveLength(0);
  expect(within(seatRow()).getByRole('img', { name: 'Người 5' })).toBeInTheDocument();
  expect(screen.getByText('5/3 ghế đã có người')).toBeInTheDocument();
});

test('an empty session still draws every seat', () => {
  render(<SessionCard session={{ ...s, capacity: 4, attendees: [] }} onToggle={vi.fn()} pending={false} />);
  expect(within(seatRow()).getAllByRole('listitem')).toHaveLength(4);
  expect(screen.getAllByLabelText('Ghế trống')).toHaveLength(4);
  expect(screen.getByText('0/4 ghế đã có người')).toBeInTheDocument();
});

test('scheduled sessions count down; cancelled and ended ones do not', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-23T10:45:00.000Z'));
  const startsAt = '2026-10-23T13:00:00.000Z';

  render(<SessionCard session={{ ...s, startsAt }} onToggle={vi.fn()} pending={false} />);
  expect(screen.getByText('còn 2 giờ 15 phút')).toBeInTheDocument();
  cleanup();

  render(<SessionCard session={{ ...s, startsAt, status: 'cancelled' }} onToggle={vi.fn()} pending={false} />);
  expect(screen.queryByText(/^còn /)).not.toBeInTheDocument();
  expect(screen.queryByText('Đang chơi')).not.toBeInTheDocument();
  cleanup();

  render(<SessionCard session={{ ...s, startsAt, status: 'ended' }} onToggle={vi.fn()} pending={false} />);
  expect(screen.queryByText(/^còn /)).not.toBeInTheDocument();
  expect(screen.queryByText('Đang chơi')).not.toBeInTheDocument();
});

test('a scheduled session past its start time says it is being played', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-23T13:30:00.000Z'));
  render(<SessionCard session={{ ...s, startsAt: '2026-10-23T13:00:00.000Z' }} onToggle={vi.fn()} pending={false} />);
  expect(screen.getByText('Đang chơi')).toBeInTheDocument();
  expect(screen.queryByText(/^còn /)).not.toBeInTheDocument();
});

test('the countdown ticks every minute and stops ticking once unmounted', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-23T10:45:00.000Z'));
  const { unmount } = render(<SessionCard session={{ ...s, startsAt: '2026-10-23T13:00:00.000Z' }} onToggle={vi.fn()} pending={false} />);
  expect(screen.getByText('còn 2 giờ 15 phút')).toBeInTheDocument();

  act(() => {
    vi.advanceTimersByTime(60_000);
  });
  expect(screen.getByText('còn 2 giờ 14 phút')).toBeInTheDocument();

  act(() => {
    vi.advanceTimersByTime(134 * 60_000);
  });
  expect(screen.getByText('Đang chơi')).toBeInTheDocument();

  unmount();
  expect(vi.getTimerCount()).toBe(0);
});

test('shows the reminder line only where the join button is', () => {
  render(<SessionCard session={s} onToggle={vi.fn()} pending={false} />);
  expect(screen.getByText('Nhắc qua email và DM trước 15 phút')).toBeInTheDocument();
  cleanup();
  render(<SessionCard session={{ ...s, status: 'ended' }} onToggle={vi.fn()} pending={false} />);
  expect(screen.queryByText('Nhắc qua email và DM trước 15 phút')).not.toBeInTheDocument();
});

test('shows the error message near the button', () => {
  render(<SessionCard session={s} onToggle={vi.fn()} pending={false} error="Đã đủ người" />);
  expect(screen.getByRole('alert')).toHaveTextContent('Đã đủ người');
});
