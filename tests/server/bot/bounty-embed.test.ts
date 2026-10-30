import { ComponentType } from 'discord.js';
import type { APIStringSelectComponent } from 'discord.js';
import { expect, test } from 'vitest';
import { parseCustomId } from '../../../src/server/bot/custom-ids.js';
import { buildBountyBoardMessage } from '../../../src/server/bot/embeds.js';
import type { BountyBoardView } from '../../../src/server/ports.js';

type Item = BountyBoardView['bounties'][number];

const item = (id: number, o: Partial<Item> = {}): Item => ({ id, title: `Mục ${id}`, description: null, points: 5, icon: '🎯', ...o });

/** Buổi Cổ điển 21:00 22/10 giờ VN. */
const view = (o: Partial<BountyBoardView> = {}): BountyBoardView => ({
  sessionId: 9,
  startsAt: new Date('2026-10-22T14:00:00Z'),
  modeName: 'Cổ điển (Classic)',
  status: 'scheduled',
  bounties: [item(1, { title: 'Giết 3 ngỗng', points: 10, icon: '🦆', description: 'Trong một ván' }), item(2, { title: 'Sống sót', points: 3 })],
  ...o,
});

function menuOf(v: BountyBoardView): APIStringSelectComponent {
  const msg = buildBountyBoardMessage(v);
  expect(msg.components).toHaveLength(1);
  const menu = msg.components[0]?.components[0];
  if (!menu || menu.type !== ComponentType.StringSelect) throw new Error('Không có menu');
  return menu;
}

test('title, item lines with description, and a multi-select menu keyed by session', () => {
  const msg = buildBountyBoardMessage(view());
  expect(msg.embeds).toHaveLength(1);
  expect(msg.embeds[0]?.title).toBe('🎯 Treo thưởng — Cổ điển (Classic) 21:00 22/10');
  expect(msg.embeds[0]?.description).toBe('🦆 **Giết 3 ngỗng** +10\nTrong một ván\n🎯 **Sống sót** +3');
  expect(msg.embeds[0]?.footer).toBeUndefined();

  const menu = menuOf(view());
  expect(parseCustomId(menu.custom_id)).toEqual({ kind: 'bounty', sessionId: 9 });
  expect(menu.placeholder).toBe('Tôi đã hoàn thành…');
  expect(menu.min_values).toBe(1);
  expect(menu.max_values).toBe(2);
  expect(menu.options).toEqual([
    { label: '🦆 Giết 3 ngỗng', value: '1', description: '+10' },
    { label: '🎯 Sống sót', value: '2', description: '+3' },
  ]);
});

test('names with Discord markdown are escaped in the list but shown verbatim in the menu', () => {
  const v = view({ bounties: [item(1, { title: 'Vịt *bay* _nhanh_', description: 'a|b' })] });
  const msg = buildBountyBoardMessage(v);
  expect(msg.embeds[0]?.description).toBe('🎯 **Vịt \\*bay\\* \\_nhanh\\_** +5\na\\|b');
  expect(menuOf(v).options[0]?.label).toBe('🎯 Vịt *bay* _nhanh_');
});

test('a description is one line and cannot turn into a heading, quote or list', () => {
  const v = view({ bounties: [item(1, { title: 'A', description: '# To\nvà rõ' }), item(2, { title: 'B', description: '> trích' }), item(3, { title: 'C', description: '1. một' })] });
  expect(buildBountyBoardMessage(v).embeds[0]?.description).toBe(
    '🎯 **A** +5\n\\# To và rõ\n🎯 **B** +5\n\\> trích\n🎯 **C** +5\n\\1. một',
  );
});

test('more than 25 bounties: the menu has the first 25 and the message says so', () => {
  const many = Array.from({ length: 27 }, (_, i) => item(i + 1));
  const msg = buildBountyBoardMessage(view({ bounties: many }));
  const menu = menuOf(view({ bounties: many }));
  expect(menu.options.map((o) => o.value)).toEqual(many.slice(0, 25).map((b) => String(b.id)));
  expect(menu.max_values).toBe(25);
  expect(msg.embeds[0]?.footer?.text).toBe('Menu chỉ có 25/27 mục đầu — nhận các mục còn lại trên web');
  // Danh sách vẫn ghi đủ 27 mục.
  expect(msg.embeds[0]?.description?.split('\n')).toHaveLength(27);
});

test('a list longer than the embed limit is cut with a count of the rest', () => {
  const long = Array.from({ length: 30 }, (_, i) => item(i + 1, { title: 'T'.repeat(80), description: 'D'.repeat(200) }));
  const description = buildBountyBoardMessage(view({ bounties: long })).embeds[0]?.description ?? '';
  expect(description.length).toBeLessThanOrEqual(4096);
  const shown = description.split('\n').filter((l) => l.startsWith('🎯 ')).length;
  expect(shown).toBeLessThan(30);
  expect(description.endsWith(`… và ${30 - shown} mục nữa`)).toBe(true);
});

test('menu labels and descriptions stay within 100 characters', () => {
  const v = view({ bounties: [item(1, { title: 'x'.repeat(80), icon: '🦆'.repeat(15) })] });
  const option = menuOf(v).options[0];
  expect(option?.label.length).toBeLessThanOrEqual(100);
  expect(option?.label.endsWith('…')).toBe(true);
});

test('a cancelled session says Buổi đã huỷ and has no menu', () => {
  const msg = buildBountyBoardMessage(view({ status: 'cancelled' }));
  expect(msg.embeds[0]?.title).toBe('🎯 Treo thưởng — Cổ điển (Classic) 21:00 22/10');
  expect(msg.embeds[0]?.description).toBe('Buổi đã huỷ');
  expect(msg.components).toEqual([]);
});

test('builder is pure and returns plain JSON', () => {
  const msg = buildBountyBoardMessage(view());
  expect(JSON.parse(JSON.stringify(msg))).toEqual(msg);
});
