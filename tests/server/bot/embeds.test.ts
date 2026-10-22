import { ButtonStyle, ComponentType } from 'discord.js';
import type { APIButtonComponentWithCustomId, APIEmbed } from 'discord.js';
import { expect, test } from 'vitest';
import { buildSessionMessage } from '../../../src/server/bot/embeds.js';
import type { SessionView } from '../../../src/server/ports.js';

/** 21:00 ngày 22/10/2026 giờ VN. */
const base: SessionView = {
  id: 42,
  startsAt: new Date('2026-10-22T14:00:00Z'),
  modeName: 'Cổ điển (Classic)',
  capacity: 16,
  roomCode: null,
  note: null,
  status: 'scheduled',
  attendees: [],
};

const attendee = (i: number, displayName = `Người ${i}`) => ({ memberId: i, displayName });

function embedOf(view: SessionView): APIEmbed {
  const msg = buildSessionMessage(view);
  expect(msg.embeds).toHaveLength(1);
  const embed = msg.embeds[0];
  if (!embed) throw new Error('Không có embed');
  return embed;
}

/** Hai nút của hàng đầu tiên, theo thứ tự Tham gia rồi Huỷ. */
function buttonsOf(view: SessionView): [APIButtonComponentWithCustomId, APIButtonComponentWithCustomId] {
  const msg = buildSessionMessage(view);
  expect(msg.components).toHaveLength(1);
  const row = msg.components[0];
  if (!row) throw new Error('Không có hàng nút');
  expect(row.type).toBe(ComponentType.ActionRow);
  expect(row.components).toHaveLength(2);
  const [join, leave] = row.components;
  if (!join || !leave || !('custom_id' in join) || !('custom_id' in leave)) throw new Error('Nút không có custom_id');
  return [join, leave];
}

test('session embed title, colour and empty attendee list', () => {
  const embed = embedOf(base);
  expect(embed.title).toBe('🪿 Buổi chơi Cổ điển (Classic) — 21:00 22/10');
  expect(embed.color).toBe(0x2f80ed);
  expect(embed.description).toBeUndefined();
  expect(embed.fields).toEqual([{ name: 'Người tham gia (0/16)', value: 'Chưa có ai' }]);
});

test('title uses VN wall-clock time, not UTC', () => {
  // 23:30 ngày 31/10 giờ VN = 16:30Z.
  const embed = embedOf({ ...base, startsAt: new Date('2026-10-31T16:30:00Z'), modeName: 'Săn ngỗng (Goose Hunt)' });
  expect(embed.title).toBe('🪿 Buổi chơi Săn ngỗng (Goose Hunt) — 23:30 31/10');
});

test('note becomes the description and room code its own field', () => {
  const embed = embedOf({ ...base, note: 'Mang theo mic', roomCode: 'ABCDEF', attendees: [attendee(1, 'An')] });
  expect(embed.description).toBe('Mang theo mic');
  expect(embed.fields).toEqual([
    { name: 'Người tham gia (1/16)', value: 'An' },
    { name: 'Mã phòng', value: 'ABCDEF' },
  ]);
});

test('attendees are joined with commas in order', () => {
  const embed = embedOf({ ...base, attendees: [attendee(3, 'C'), attendee(1, 'A'), attendee(2, 'B')] });
  expect(embed.fields?.[0]).toEqual({ name: 'Người tham gia (3/16)', value: 'C, A, B' });
});

test('session embed lists attendees within Discord limits', () => {
  const view = {
    ...base,
    capacity: 25,
    attendees: [...Array(25)].map((_, i) => ({ memberId: i, displayName: 'Tên rất là dài '.repeat(4) + i })),
  };
  const msg = buildSessionMessage(view);
  const embed = msg.embeds[0];
  if (!embed?.fields) throw new Error('Không có field');
  for (const f of embed.fields) expect(f.value.length).toBeLessThanOrEqual(1024);
  const list = embed.fields[0];
  if (!list) throw new Error('Không có field người tham gia');
  expect(list.name).toBe('Người tham gia (25/25)');
  expect(list.value).toMatch(/… và \d+ người nữa$/);

  // Số người hiện + số người ẩn = tổng; những người hiện là những người đầu danh sách.
  const hidden = Number(/và (\d+) người nữa$/.exec(list.value)?.[1]);
  const shown = list.value.slice(0, list.value.indexOf('…')).split(', ');
  expect(shown.length + hidden).toBe(25);
  expect(shown).toEqual(view.attendees.slice(0, shown.length).map((a) => a.displayName));
  // Cắt ít nhất có thể: thêm một tên nữa là vượt 1024.
  const oneMore = `${view.attendees
    .slice(0, shown.length + 1)
    .map((a) => a.displayName)
    .join(', ')}… và ${hidden - 1} người nữa`;
  expect(oneMore.length).toBeGreaterThan(1024);
});

test('a list that fits exactly is not truncated', () => {
  // 10 tên × 100 ký tự + 9 dấu ", " = 1018 ≤ 1024.
  const attendees = [...Array(10)].map((_, i) => attendee(i, String(i).repeat(100)));
  const embed = embedOf({ ...base, attendees });
  expect(embed.fields?.[0]?.value).toBe(attendees.map((a) => a.displayName).join(', '));
  expect(embed.fields?.[0]?.value.length).toBe(1018);
});

test('open session has Tham gia (success) and Huỷ (secondary) buttons with attendance custom ids', () => {
  const [join, leave] = buttonsOf({ ...base, attendees: [attendee(1)] });
  expect(join).toEqual({
    type: ComponentType.Button,
    style: ButtonStyle.Success,
    label: 'Tham gia',
    custom_id: 'att:join:42',
  });
  expect(leave).toEqual({
    type: ComponentType.Button,
    style: ButtonStyle.Secondary,
    label: 'Huỷ',
    custom_id: 'att:leave:42',
  });
});

test('full session disables join', () => {
  const full = { ...base, capacity: 2, attendees: [attendee(1), attendee(2)] };
  const [join, leave] = buttonsOf(full);
  expect(join).toMatchObject({ disabled: true, label: 'Đã đủ người', custom_id: 'att:join:42' });
  expect(leave).toMatchObject({ label: 'Huỷ', custom_id: 'att:leave:42' });
  expect(leave.disabled).toBeFalsy();
  expect(embedOf(full).fields?.[0]?.name).toBe('Người tham gia (2/2)');

  // Quá sức chứa (dữ liệu cũ) cũng coi là đủ; còn một chỗ thì vẫn bấm được.
  expect(buttonsOf({ ...full, attendees: [attendee(1), attendee(2), attendee(3)] })[0].disabled).toBe(true);
  expect(buttonsOf({ ...full, attendees: [attendee(1)] })[0].disabled).toBeFalsy();
});

test('cancelled/ended session has no buttons', () => {
  const cancelled = buildSessionMessage({ ...base, status: 'cancelled', attendees: [attendee(1, 'An')] });
  expect(cancelled.components).toEqual([]);
  expect(cancelled.embeds[0]?.title).toBe('❌ ĐÃ HUỶ — 🪿 Buổi chơi Cổ điển (Classic) — 21:00 22/10');
  expect(cancelled.embeds[0]?.color).toBe(0x6b7280);
  // Danh sách người đã đăng ký vẫn hiện để mọi người biết ai bị ảnh hưởng.
  expect(cancelled.embeds[0]?.fields?.[0]).toEqual({ name: 'Người tham gia (1/16)', value: 'An' });

  const ended = buildSessionMessage({ ...base, status: 'ended' });
  expect(ended.components).toEqual([]);
  expect(ended.embeds[0]?.title).toBe('✅ Đã kết thúc — 🪿 Buổi chơi Cổ điển (Classic) — 21:00 22/10');
  expect(ended.embeds[0]?.color).toBe(0x22c55e);
});

test('builder is pure and returns plain JSON', () => {
  const view = { ...base, attendees: [attendee(1, 'An')] };
  const snapshot = JSON.stringify(view);
  const msg = buildSessionMessage(view);
  expect(JSON.stringify(view)).toBe(snapshot);
  expect(JSON.parse(JSON.stringify(msg))).toEqual(msg);
  expect(buildSessionMessage(view)).toEqual(msg);
});
