import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { ROLES } from '../../src/server/seed/roles';
import type { RoleDto } from '../../src/shared/api-types';
import { Character } from '../../src/web/components/Character';
import { KitArt } from '../../src/web/components/goose/kits';
import { birdCrestColour, kitForRole, KITS, type Kit } from '../../src/web/lib/roleKits';

/** Dựng `RoleDto` từ seed: `id` là vị trí trong `ROLES` + 1, không có ảnh tuỳ chỉnh. */
function roleFromSeed(key: string): RoleDto {
  const index = ROLES.findIndex((r) => r.key === key);
  if (index === -1) throw new Error(`Seed không có role ${key}`);
  return { ...ROLES[index]!, id: index + 1, hasImage: false };
}

/** Role đầu tiên trong seed mặc bộ `kit`. */
function firstKeyFor(kit: Kit): string {
  const seed = ROLES.find((r) => kitForRole(r.key) === kit);
  if (!seed) throw new Error(`Seed không có role nào mặc bộ ${kit}`);
  return seed.key;
}

const part = (name: string) => document.querySelector(`svg [data-part="${name}"]`);

/** Các bộ có phần vẽ sau thân: ba lô, áo choàng, đôi cánh, cánh/đuôi chim. */
const WITH_BACK: Kit[] = ['explorer', 'vampire', 'heart', 'bird'];

afterEach(cleanup);

test.each(KITS.filter((k) => k !== 'badge'))('%s draws its own art instead of the badge', (kit) => {
  const key = firstKeyFor(kit);
  render(<Character role={roleFromSeed(key)} holderName="Kẹ" variant="current" />);
  const art = document.querySelector(`[data-kit="${kit}"]`);
  expect(art).not.toBeNull();
  expect(art!.childElementCount).toBeGreaterThan(0);
  // Bộ riêng không còn huy hiệu emoji mặc định.
  expect(screen.queryByText(roleFromSeed(key).icon)).toBeNull();
});

test('every seeded role renders a labelled character', () => {
  for (const seed of ROLES) {
    const { unmount } = render(<Character role={roleFromSeed(seed.key)} holderName="Kẹ" variant="current" />);
    expect(screen.getByRole('img', { name: `${seed.nameVi}: Kẹ` })).toBeInTheDocument();
    unmount();
  }
});

test('the crest colour differs between birds', () => {
  const crestOf = (key: string) => {
    render(<Character role={roleFromSeed(key)} holderName="Kẹ" variant="current" />);
    const crest = document.querySelector('[data-kit="bird"] [data-part="crest"]');
    expect(crest).not.toBeNull();
    const fill = crest!.getAttribute('fill');
    cleanup();
    return fill;
  };
  const raven = crestOf('raven');
  const pigeon = crestOf('pigeon');
  expect(raven).toBe(birdCrestColour('raven'));
  expect(pigeon).toBe(birdCrestColour('pigeon'));
  expect(raven).not.toBe(pigeon);
});

test('goose roles wear their own outfit inside their kit instead of the shared one', () => {
  const markup = (key: string) => {
    render(<Character role={roleFromSeed(key)} holderName="Kẹ" variant="current" />);
    const html = document.querySelector(`[data-kit="${kitForRole(key)}"]`)!.innerHTML;
    cleanup();
    return html;
  };
  // Cùng bộ `police` mà mỗi role một kiểu; vai Ngỗng thường không còn huy hiệu emoji.
  const police = ['vigilante', 'sheriff', 'bodyguard', 'avenger', 'soldier', 'demon_hunter'].map(markup);
  expect(new Set(police).size).toBe(police.length);
  render(<Character role={roleFromSeed('goose')} holderName="Kẹ" variant="current" />);
  expect(document.querySelector('[data-kit="badge"]')!.childElementCount).toBeGreaterThan(0);
  expect(screen.queryByText('🪿')).toBeNull();
});

test('kits never draw over an uploaded image or an empty slot', () => {
  const swordsman = roleFromSeed('swordsman');
  render(<Character role={{ ...swordsman, hasImage: true }} holderName="Kẹ" variant="current" />);
  expect(document.querySelector('[data-kit]')).toBeNull();
  expect(document.querySelector('[data-kit-back]')).toBeNull();
  cleanup();

  render(<Character role={swordsman} holderName={null} variant="empty" />);
  expect(document.querySelector('[data-kit]')).toBeNull();
  expect(document.querySelector('[data-kit-back]')).toBeNull();
});

test.each(WITH_BACK)('%s draws its back part before the body and its front part after', (kit) => {
  render(<Character role={roleFromSeed(firstKeyFor(kit))} holderName="Kẹ" variant="current" />);
  const back = document.querySelector(`[data-kit-back="${kit}"]`);
  const front = document.querySelector(`[data-kit="${kit}"]`);
  const body = part('body')!;
  expect(back).not.toBeNull();
  expect(back!.childElementCount).toBeGreaterThan(0);
  expect(body.compareDocumentPosition(back!) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  expect(body.compareDocumentPosition(front!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test.each(KITS.filter((k) => !WITH_BACK.includes(k)))('%s has no back layer', (kit) => {
  render(
    <svg>
      <KitArt kit={kit} role={{ key: firstKeyFor(kit), icon: '🪿', faction: 'goose' }} layer="back" />
    </svg>,
  );
  expect(document.querySelector('svg')!.childElementCount).toBe(0);
});

test('the ninja mask leaves the body eyes visible through an even-odd hole', () => {
  render(<Character role={roleFromSeed('ninja')} holderName="Kẹ" variant="current" />);
  // Mặt nạ không vẽ lại mắt: mắt của thân vẫn là nhóm chớp duy nhất và nằm trước mặt nạ trong DOM.
  const eyes = document.querySelectorAll('.goose-eyes');
  expect(eyes).toHaveLength(1);
  const mask = document.querySelector('[data-kit="ninja"] [data-part="mask"]');
  expect(mask).not.toBeNull();
  expect(mask).toHaveAttribute('fill-rule', 'evenodd');
});
