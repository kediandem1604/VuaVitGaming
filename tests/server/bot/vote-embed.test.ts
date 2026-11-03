import { ComponentType } from 'discord.js';
import type { APIEmbed, APIStringSelectComponent } from 'discord.js';
import { expect, test } from 'vitest';
import { parseCustomId } from '../../../src/server/bot/custom-ids.js';
import { buildVoteMessage } from '../../../src/server/bot/embeds.js';
import type { VotePrompt } from '../../../src/server/ports.js';

/** Vote của buổi Cổ điển 21:00 22/10, đóng lúc 07:00 ngày 23/10 giờ VN (= 00:00Z). */
const prompt: VotePrompt = {
  roundId: 7,
  categoryId: 3,
  categoryName: 'Giết nhiều nhất',
  description: null,
  sessionLabel: 'Cổ điển (Classic) 21:00 22/10',
  closesAt: new Date('2026-10-23T00:00:00Z'),
  nominees: [
    { memberId: 12, displayName: 'An' },
    { memberId: 5, displayName: 'Bình' },
    { memberId: 30, displayName: 'Chi' },
  ],
};

function embedOf(p: VotePrompt): APIEmbed {
  const msg = buildVoteMessage(p);
  expect(msg.embeds).toHaveLength(1);
  const embed = msg.embeds[0];
  if (!embed) throw new Error('Không có embed');
  return embed;
}

/** Menu chọn duy nhất của hàng duy nhất. */
function menuOf(p: VotePrompt): APIStringSelectComponent {
  const msg = buildVoteMessage(p);
  expect(msg.components).toHaveLength(1);
  const row = msg.components[0];
  if (!row) throw new Error('Không có hàng menu');
  expect(row.type).toBe(ComponentType.ActionRow);
  expect(row.components).toHaveLength(1);
  const menu = row.components[0];
  if (!menu || menu.type !== ComponentType.StringSelect) throw new Error('Không có menu chọn');
  return menu;
}

test('vote menu lists nominees with encoded id', () => {
  const menu = menuOf(prompt);
  expect(parseCustomId(menu.custom_id)).toEqual({ kind: 'vote', roundId: prompt.roundId, categoryId: prompt.categoryId });
  expect(menu.custom_id).toBe('vote:7:3');
  // Giá trị = memberId, nhãn = tên hiển thị, đúng thứ tự tham gia (không sắp lại).
  expect(menu.options.map((o) => Number(o.value))).toEqual(prompt.nominees.map((n) => n.memberId));
  expect(menu.options.map((o) => o.label)).toEqual(['An', 'Bình', 'Chi']);
  expect(menu).toMatchObject({ placeholder: 'Chọn người xứng đáng', min_values: 1, max_values: 1 });
});

test('vote embed has a gold title, the session label and the VN closing time', () => {
  const embed = embedOf(prompt);
  expect(embed.title).toBe('🏆 Giết nhiều nhất');
  expect(embed.color).toBe(0xf5b700);
  expect(embed.description).toBe('Buổi: Cổ điển (Classic) 21:00 22/10\nĐóng lúc 07:00 23/10');
  expect(embed.fields).toBeUndefined();
});

test('category description comes before the session lines', () => {
  const embed = embedOf({ ...prompt, categoryName: 'Pha đẻ trứng lộ liễu nhất (Cò gáy)', description: 'Cò gáy đẻ trứng bị bắt quả tang' });
  expect(embed.title).toBe('🏆 Pha đẻ trứng lộ liễu nhất (Cò gáy)');
  expect(embed.description).toBe(
    'Cò gáy đẻ trứng bị bắt quả tang\nBuổi: Cổ điển (Classic) 21:00 22/10\nĐóng lúc 07:00 23/10',
  );
  // Mô tả rỗng coi như không có.
  expect(embedOf({ ...prompt, description: '' }).description).toBe('Buổi: Cổ điển (Classic) 21:00 22/10\nĐóng lúc 07:00 23/10');
});

test('closing time uses VN wall-clock, not UTC', () => {
  // 23:30 ngày 31/10 giờ VN = 16:30Z.
  expect(embedOf({ ...prompt, closesAt: new Date('2026-10-31T16:30:00Z') }).description).toContain('Đóng lúc 23:30 31/10');
});

test('labels are clipped to 100 characters without splitting surrogate pairs', () => {
  const nominees = [
    { memberId: 1, displayName: 'x'.repeat(100) }, // vừa đúng giới hạn: giữ nguyên
    { memberId: 2, displayName: 'y'.repeat(101) }, // quá 1: cắt còn 99 + "…"
    { memberId: 3, displayName: `${'a'.repeat(98)}😀😀` }, // 102 đơn vị UTF-16; emoji thứ nhất không vừa 99 → bỏ cả cặp
  ];
  const [exact, over, emoji] = menuOf({ ...prompt, nominees }).options;
  expect(exact?.label).toBe('x'.repeat(100));
  expect(over?.label).toBe(`${'y'.repeat(99)}…`);
  expect(emoji?.label).toBe(`${'a'.repeat(98)}…`);
  for (const o of [exact, over, emoji]) expect(o?.label.length).toBeLessThanOrEqual(100);
});

test('at most 25 options, the first nominees in order', () => {
  const many = [...Array(30)].map((_, i) => ({ memberId: i + 1, displayName: `Người ${i + 1}` }));
  const menu = menuOf({ ...prompt, nominees: many });
  expect(menu.options).toHaveLength(25);
  expect(menu.options.map((o) => o.value)).toEqual(many.slice(0, 25).map((n) => String(n.memberId)));
});

test('a vote message needs at least one nominee (Discord rejects an empty menu)', () => {
  expect(() => buildVoteMessage({ ...prompt, nominees: [] })).toThrow();
});

test('builder is pure and returns plain JSON', () => {
  const snapshot = JSON.stringify(prompt);
  const msg = buildVoteMessage(prompt);
  expect(JSON.stringify(prompt)).toBe(snapshot);
  expect(JSON.parse(JSON.stringify(msg))).toEqual(msg);
  expect(buildVoteMessage(prompt)).toEqual(msg);
});
