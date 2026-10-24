import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import type { SessionAttendeeDto, SessionDto } from '../../src/shared/api-types';
import { SessionCard } from '../../src/web/components/SessionCard';
import { reminderChannels, type ReminderChannels } from '../../src/web/lib/reminders';

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

/** Nhắc qua cả email và Discord — mặc định cho các test không xét dòng nhắc. */
const both: ReminderChannels = { email: true, discord: true };

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
  render(<SessionCard reminders={both} session={{ ...s, capacity: 2, attendees: [a, b], myStatus: null }} onToggle={vi.fn()} pending={false} />);
  expect(screen.getByRole('button', { name: 'Đã đủ người' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Tham gia' })).not.toBeInTheDocument();
});

test('open session offers join and calls onToggle(true)', () => {
  const onToggle = vi.fn();
  render(<SessionCard reminders={both} session={s} onToggle={onToggle} pending={false} />);
  fireEvent.click(screen.getByRole('button', { name: 'Tham gia' }));
  expect(onToggle).toHaveBeenCalledTimes(1);
  expect(onToggle).toHaveBeenCalledWith(true);
});

test('attending member sees cancel', () => {
  const onToggle = vi.fn();
  render(<SessionCard reminders={both} session={{ ...s, attendees: [a, b], myStatus: 'going' }} onToggle={onToggle} pending={false} />);
  const button = screen.getByRole('button', { name: 'Huỷ tham gia' });
  expect(button).toBeEnabled();
  fireEvent.click(button);
  expect(onToggle).toHaveBeenCalledWith(false);
});

test('a going member on a full session can still leave', () => {
  render(<SessionCard reminders={both} session={{ ...s, capacity: 2, attendees: [a, b], myStatus: 'going' }} onToggle={vi.fn()} pending={false} />);
  expect(screen.getByRole('button', { name: 'Huỷ tham gia' })).toBeEnabled();
  expect(screen.queryByText('Đã đủ người')).not.toBeInTheDocument();
});

test('room code shown when present', () => {
  render(<SessionCard reminders={both} session={{ ...s, roomCode: 'ABCD' }} onToggle={vi.fn()} pending={false} />);
  expect(screen.getByText('Mã phòng: ABCD')).toBeInTheDocument();
  cleanup();
  render(<SessionCard reminders={both} session={s} onToggle={vi.fn()} pending={false} />);
  expect(screen.queryByText(/Mã phòng/)).not.toBeInTheDocument();
});

test('shows Vietnam time, mode, seat count and note', () => {
  render(<SessionCard reminders={both} session={{ ...s, attendees: [a, b], note: 'Map mới' }} onToggle={vi.fn()} pending={false} />);
  expect(screen.getByText('21:00')).toBeInTheDocument();
  expect(screen.getByText('Cổ điển')).toBeInTheDocument();
  expect(screen.getByText('2/16 ghế đã có người')).toBeInTheDocument();
  expect(screen.getByText('Map mới')).toBeInTheDocument();
});

test('pending disables the button and shows progress text', () => {
  const onToggle = vi.fn();
  render(<SessionCard reminders={both} session={s} onToggle={onToggle} pending={true} />);
  const button = screen.getByRole('button', { name: 'Đang xử lý…' });
  expect(button).toBeDisabled();
  fireEvent.click(button);
  expect(onToggle).not.toHaveBeenCalled();
});

test('cancelled and ended sessions show a badge and no button', () => {
  render(<SessionCard reminders={both} session={{ ...s, status: 'cancelled' }} onToggle={vi.fn()} pending={false} />);
  expect(screen.getByText('Đã huỷ')).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  cleanup();
  render(<SessionCard reminders={both} session={{ ...s, status: 'ended', myStatus: 'going' }} onToggle={vi.fn()} pending={false} />);
  expect(screen.getByText('Đã kết thúc')).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  cleanup();
  render(<SessionCard reminders={both} session={s} onToggle={vi.fn()} pending={false} />);
  expect(screen.queryByText('Đã huỷ')).not.toBeInTheDocument();
  expect(screen.queryByText('Đã kết thúc')).not.toBeInTheDocument();
});

test('one seat per place, filled seats show who is coming', () => {
  render(<SessionCard reminders={both} session={{ ...s, capacity: 12, attendees: people(8) }} onToggle={vi.fn()} pending={false} />);

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
  render(<SessionCard reminders={both} session={{ ...s, capacity: 3, attendees: people(5) }} onToggle={vi.fn()} pending={false} />);
  expect(within(seatRow()).getAllByRole('listitem')).toHaveLength(5);
  expect(screen.queryAllByLabelText('Ghế trống')).toHaveLength(0);
  expect(within(seatRow()).getByRole('img', { name: 'Người 5' })).toBeInTheDocument();
  expect(screen.getByText('5/3 ghế đã có người')).toBeInTheDocument();
});

test('an empty session still draws every seat', () => {
  render(<SessionCard reminders={both} session={{ ...s, capacity: 4, attendees: [] }} onToggle={vi.fn()} pending={false} />);
  expect(within(seatRow()).getAllByRole('listitem')).toHaveLength(4);
  expect(screen.getAllByLabelText('Ghế trống')).toHaveLength(4);
  expect(screen.getByText('0/4 ghế đã có người')).toBeInTheDocument();
});

test('scheduled sessions count down; cancelled and ended ones do not', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-23T10:45:00.000Z'));
  const startsAt = '2026-10-23T13:00:00.000Z';

  render(<SessionCard reminders={both} session={{ ...s, startsAt }} onToggle={vi.fn()} pending={false} />);
  expect(screen.getByText('còn 2 giờ 15 phút')).toBeInTheDocument();
  cleanup();

  render(<SessionCard reminders={both} session={{ ...s, startsAt, status: 'cancelled' }} onToggle={vi.fn()} pending={false} />);
  expect(screen.queryByText(/^còn /)).not.toBeInTheDocument();
  expect(screen.queryByText('Đang chơi')).not.toBeInTheDocument();
  cleanup();

  render(<SessionCard reminders={both} session={{ ...s, startsAt, status: 'ended' }} onToggle={vi.fn()} pending={false} />);
  expect(screen.queryByText(/^còn /)).not.toBeInTheDocument();
  expect(screen.queryByText('Đang chơi')).not.toBeInTheDocument();
});

test('a scheduled session past its start time says it is being played', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-23T13:30:00.000Z'));
  render(<SessionCard reminders={both} session={{ ...s, startsAt: '2026-10-23T13:00:00.000Z' }} onToggle={vi.fn()} pending={false} />);
  expect(screen.getByText('Đang chơi')).toBeInTheDocument();
  expect(screen.queryByText(/^còn /)).not.toBeInTheDocument();
});

test('the countdown ticks every minute and stops ticking once unmounted', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-23T10:45:00.000Z'));
  const { unmount } = render(<SessionCard reminders={both} session={{ ...s, startsAt: '2026-10-23T13:00:00.000Z' }} onToggle={vi.fn()} pending={false} />);
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

/** Buổi `s` dời sang tương lai xa: chưa tới giờ nên dòng nhắc còn hiện. */
const upcoming: SessionDto = { ...s, startsAt: '2099-01-01T14:00:00.000Z' };

/** Thẻ buổi với kênh nhắc cho trước; trong router vì dòng "đã tắt nhắc" có link sang Hồ sơ. */
const renderWithReminders = (reminders: ReminderChannels, session: SessionDto = upcoming) =>
  render(
    <MemoryRouter>
      <SessionCard session={session} onToggle={vi.fn()} pending={false} reminders={reminders} />
    </MemoryRouter>,
  );

/** Dòng nhắc giờ (đoạn văn chứa chữ "nhắc"), hoặc null. */
const reminderLine = () =>
  screen.queryByText((_, el) => el?.tagName === 'P' && /nhắc/i.test(el.textContent ?? ''));

test('the reminder line names both channels when email and Discord DMs are on', () => {
  renderWithReminders({ email: true, discord: true });
  expect(reminderLine()).toHaveTextContent(/^Nhắc trước giờ chơi qua email và Discord$/);
  // Số phút nhắc là cài đặt của admin: dòng này không được ghi số phút cố định.
  expect(reminderLine()?.textContent).not.toMatch(/\d/);
  expect(reminderLine()).toHaveClass('text-sm');
});

test('the reminder line names only email when Discord DMs are off', () => {
  renderWithReminders({ email: true, discord: false });
  expect(reminderLine()).toHaveTextContent(/^Nhắc trước giờ chơi qua email$/);
});

test('the reminder line names only Discord when email is off or missing', () => {
  renderWithReminders({ email: false, discord: true });
  expect(reminderLine()).toHaveTextContent(/^Nhắc trước giờ chơi qua Discord$/);
  cleanup();
  // Đã bật email nhưng chưa có địa chỉ thì server không gửi email được.
  renderWithReminders(reminderChannels({ email: null, notifyEmail: true, notifyDm: true }));
  expect(reminderLine()).toHaveTextContent(/^Nhắc trước giờ chơi qua Discord$/);
});

test('with both reminders off the line points to the profile page', () => {
  renderWithReminders({ email: false, discord: false });
  expect(reminderLine()).toHaveTextContent(/^Bạn đã tắt nhắc giờ — đổi ở Hồ sơ$/);
  expect(screen.getByRole('link', { name: 'Hồ sơ' })).toHaveAttribute('href', '/ho-so');
  cleanup();
  renderWithReminders(reminderChannels({ email: 'a@example.com', notifyEmail: false, notifyDm: false }));
  expect(screen.getByRole('link', { name: 'Hồ sơ' })).toBeInTheDocument();
});

test('the reminder line is hidden once the session is live, and on cancelled or ended sessions', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-23T12:59:00.000Z'));
  const session = { ...s, startsAt: '2026-10-23T13:00:00.000Z' };
  renderWithReminders(both, session);
  expect(reminderLine()).toHaveTextContent('Nhắc trước giờ chơi qua email và Discord');

  // Tới giờ: chip thành "Đang chơi" và dòng nhắc biến mất cùng lúc (cùng một đồng hồ).
  act(() => {
    vi.advanceTimersByTime(60_000);
  });
  expect(screen.getByText('Đang chơi')).toBeInTheDocument();
  expect(reminderLine()).toBeNull();
  // Nút Huỷ/Tham gia vẫn còn khi đang chơi.
  expect(screen.getByRole('button', { name: 'Tham gia' })).toBeInTheDocument();
  cleanup();

  renderWithReminders(both, { ...session, status: 'cancelled' });
  expect(reminderLine()).toBeNull();
  cleanup();
  renderWithReminders(both, { ...session, status: 'ended' });
  expect(reminderLine()).toBeNull();
});

test('shows the error message near the button', () => {
  render(<SessionCard reminders={both} session={s} onToggle={vi.fn()} pending={false} error="Đã đủ người" />);
  expect(screen.getByRole('alert')).toHaveTextContent('Đã đủ người');
});
