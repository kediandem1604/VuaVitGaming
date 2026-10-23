import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import type { RoleDto } from '../../src/shared/api-types';
import { Character } from '../../src/web/components/Character';
import { KitArt } from '../../src/web/components/goose/kits';
import { PALETTE } from '../../src/web/lib/palette';
import { KITS } from '../../src/web/lib/roleKits';

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

/** Role không có trong bảng §4.2 → mặc bộ `badge`. */
const goose: RoleDto = { ...swordsman, id: 1, key: 'goose', faction: 'goose', nameVi: 'Ngỗng', icon: '🪿' };

const DUCK = '#E5484D';
const GOOSE = '#2F80ED';
const NEUTRAL = '#8E4EC6';

const part = (name: string) => document.querySelector(`svg [data-part="${name}"]`);

afterEach(cleanup);

test('character shows holder above head', () => {
  render(<Character role={swordsman} holderName="Kẹ" variant="current" />);
  expect(screen.getByLabelText('Kiếm sĩ: Kẹ')).toBeInTheDocument();

  // Bảng tên là chữ SVG trắng đậm viền tối, cỡ 18 cho tên ngắn.
  const plate = screen.getByText('Kẹ');
  expect(plate.tagName).toBe('text');
  expect(plate).toHaveAttribute('font-size', '18');
  expect(plate).toHaveAttribute('fill', '#fff');
  expect(plate).toHaveAttribute('stroke-width', '4');
  expect(plate).toHaveAttribute('paint-order', 'stroke');

  expect(screen.queryByText('Mùa trước')).not.toBeInTheDocument();
  expect(document.querySelector('img')).toBeNull();
});

test('body is white and the faction shows in the glow under the feet', () => {
  const { unmount } = render(<Character role={swordsman} holderName="Kẹ" variant="current" />);
  expect(part('body')).toHaveAttribute('fill', '#FFFFFF');
  expect(part('glow')).toHaveAttribute('fill', DUCK);
  unmount();

  render(<Character role={{ ...swordsman, faction: 'goose' }} holderName="Kẹ" variant="current" />);
  expect(part('body')).toHaveAttribute('fill', '#FFFFFF');
  expect(part('glow')).toHaveAttribute('fill', GOOSE);
  cleanup();

  render(<Character role={{ ...swordsman, faction: 'neutral' }} holderName="Kẹ" variant="current" />);
  expect(part('glow')).toHaveAttribute('fill', NEUTRAL);
});

test('previous holder is marked', () => {
  render(<Character role={swordsman} holderName="Ngỗng Một" variant="previous" />);
  expect(screen.getByLabelText('Kiếm sĩ: Ngỗng Một (mùa trước)')).toBeInTheDocument();
  expect(screen.getByText('Mùa trước')).toBeInTheDocument();
  expect(screen.getByText('Ngỗng Một')).toBeInTheDocument();
  // Toàn bộ hình (thân, bộ đồ, vòng sáng) mờ đi; bảng tên nằm ngoài nên vẫn rõ.
  expect(part('figure')).toHaveAttribute('opacity', '0.45');
  expect(part('figure')).toContainElement(part('body') as SVGElement);
  expect(part('figure')).toContainElement(part('glow') as SVGElement);
  expect(part('figure')).not.toContainElement(screen.getByText('Ngỗng Một'));
});

test('custom image replaces drawing', () => {
  render(<Character role={{ ...swordsman, hasImage: true }} holderName="Kẹ" variant="current" />);
  const img = document.querySelector('img');
  expect(img).toHaveAttribute('src', '/api/roles/61/image');
  expect(img).toHaveAttribute('alt', '');
  expect(img).toHaveAttribute('loading', 'lazy');
  // Không còn thân vẽ hay bộ đồ; vòng sáng phe và bảng tên vẫn còn.
  expect(part('body')).toBeNull();
  expect(document.querySelector('[data-kit]')).toBeNull();
  expect(part('glow')).toHaveAttribute('fill', DUCK);
  expect(screen.getByText('Kẹ')).toBeInTheDocument();
  expect(screen.getByLabelText('Kiếm sĩ: Kẹ')).toBeInTheDocument();
});

test('empty variant says nobody holds the role', () => {
  render(<Character role={swordsman} holderName={null} variant="empty" />);
  expect(screen.getByLabelText('Kiếm sĩ: Chưa ai hoá thân')).toBeInTheDocument();
  const plate = screen.getByText('Chưa ai hoá thân');
  expect(plate.tagName).toBe('text');
  expect(plate).not.toHaveAttribute('fill', '#fff');
  // Hình bóng `night-600`, không mắt, không bộ đồ, không vòng sáng phe.
  expect(part('body')).toHaveAttribute('fill', PALETTE['night-600']);
  expect(document.querySelector('.goose-eyes')).toBeNull();
  expect(document.querySelector('[data-kit]')).toBeNull();
  expect(part('glow')).toBeNull();
  expect(screen.queryByText('Mùa trước')).not.toBeInTheDocument();
});

test('nameplate={false} draws only the figure', () => {
  const { unmount } = render(<Character role={swordsman} holderName="Kẹ" variant="current" nameplate={false} />);
  // Không bảng tên: không còn phần tử `text` nào trong SVG, nhãn đọc chỉ là tên role.
  expect(screen.getByRole('img', { name: 'Kiếm sĩ' })).toBeInTheDocument();
  expect(screen.queryByText('Kẹ')).toBeNull();
  expect(document.querySelector('svg text')).toBeNull();
  // Hình vẫn đủ: bộ đồ, vòng sáng phe, nhún nhẹ.
  expect(document.querySelector('[data-kit="sword"]')).not.toBeNull();
  expect(part('glow')).toHaveAttribute('fill', DUCK);
  expect(part('figure')).toHaveClass('goose-idle');
  unmount();

  // Biến thể `previous` cũng bỏ nhãn "Mùa trước" nhưng vẫn mờ hình.
  render(<Character role={swordsman} holderName="Ngỗng Một" variant="previous" nameplate={false} />);
  expect(screen.getByRole('img', { name: 'Kiếm sĩ' })).toBeInTheDocument();
  expect(screen.queryByText('Mùa trước')).toBeNull();
  expect(screen.queryByText('Ngỗng Một')).toBeNull();
  expect(part('figure')).toHaveAttribute('opacity', '0.45');
});

test('long names are truncated and shrunk on the nameplate', () => {
  render(<Character role={swordsman} holderName={'a'.repeat(30)} variant="current" />);
  const plate = screen.getByText('a'.repeat(23) + '…');
  expect(plate).toHaveAttribute('font-size', '12');
  // Vẫn rộng hơn ô 120 → ép chữ khít bằng textLength thay vì tràn.
  expect(plate).toHaveAttribute('textLength');
  expect(plate).toHaveAttribute('lengthAdjust', 'spacingAndGlyphs');
  // Tên ngắn không bị ép.
  expect(screen.queryByText('Kẹ')).toBeNull();
});

test('medium-length names use the middle size and are not squeezed', () => {
  render(<Character role={swordsman} holderName="Ngỗng Một" variant="current" />);
  const plate = screen.getByText('Ngỗng Một');
  expect(plate).toHaveAttribute('font-size', '18');
  expect(plate).not.toHaveAttribute('textLength');
});

test('default badge carries the role icon and size caps the width', () => {
  render(<Character role={goose} holderName="Kẹ" variant="current" size={96} />);
  expect(screen.getByText('🪿')).toBeInTheDocument();
  expect(document.querySelector('[data-kit="badge"]')).not.toBeNull();
  const root = screen.getByRole('img', { name: 'Ngỗng: Kẹ' });
  expect(root).toHaveStyle({ maxWidth: '96px' });
  // Không tự căn giữa: trong hàng flex, mx-auto sẽ đẩy phần tử bên cạnh ra mép (lỗi bảng xếp hạng ở 1024px).
  expect(root).not.toHaveClass('mx-auto');
});

test('the kit of the role is the front layer root, drawn after the body', () => {
  render(<Character role={swordsman} holderName="Kẹ" variant="current" />);
  const kit = document.querySelector('[data-kit="sword"]');
  expect(kit).not.toBeNull();
  // Thân vẽ trước (đứng trước trong DOM) để bộ đồ che lên thân.
  expect(part('body')!.compareDocumentPosition(kit!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test.each(KITS)('kit %s has a <g data-kit> front root', (kit) => {
  render(
    <svg>
      <KitArt kit={kit} role={{ key: 'goose', icon: '🪿', faction: 'goose' }} layer="front" />
    </svg>,
  );
  const root = document.querySelector(`[data-kit="${kit}"]`);
  expect(root?.tagName).toBe('g');
});

test('idle bob and blink hooks are on the figure and the eyes', () => {
  render(<Character role={swordsman} holderName="Kẹ" variant="current" />);
  expect(part('figure')).toHaveClass('goose-idle');
  expect(document.querySelector('.goose-eyes')).not.toBeNull();
});

/** Nội dung mọi khối `@media (prefers-reduced-motion: no-preference) { … }` trong styles.css, nối lại. */
function reducedMotionBlocks(css: string): string {
  const marker = '@media (prefers-reduced-motion: no-preference)';
  let out = '';
  for (let from = css.indexOf(marker); from !== -1; from = css.indexOf(marker, from + 1)) {
    const open = css.indexOf('{', from);
    let depth = 0;
    let i = open;
    for (; i < css.length; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}' && --depth === 0) break;
    }
    out += css.slice(open + 1, i);
  }
  return out;
}

test('the goose animations only run when the machine allows motion', () => {
  // Môi trường jsdom cho `import.meta.url` dạng http, nên đi từ `__dirname` của vitest.
  const css = readFileSync(resolve(__dirname, '../../src/web/styles.css'), 'utf8');
  const guarded = reducedMotionBlocks(css);
  expect(guarded).toMatch(/\.goose-idle\s*\{[^}]*animation:/);
  expect(guarded).toMatch(/\.goose-eyes\s*\{[^}]*animation:/);
  // Hai lớp chỉ được khai báo trong khối đó — không có bản nào chạy ngoài khối.
  expect(css.match(/\.goose-idle\s*\{/g)).toHaveLength(1);
  expect(css.match(/\.goose-eyes\s*\{/g)).toHaveLength(1);
});
