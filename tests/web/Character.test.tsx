import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import type { RoleDto } from '../../src/shared/api-types';
import { Character } from '../../src/web/components/Character';

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

const DUCK = '#E5484D';
const GOOSE = '#2F80ED';
const NEUTRAL = '#8E4EC6';
const GREY = '#9CA3AF';

const filled = (colour: string) => document.querySelector(`svg [fill="${colour}"]`);

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

test('body is tinted by faction', () => {
  const { unmount } = render(<Character role={swordsman} holderName="Kẹ" variant="current" />);
  expect(filled(DUCK)).not.toBeNull();
  expect(filled(GOOSE)).toBeNull();
  unmount();

  render(<Character role={{ ...swordsman, faction: 'goose' }} holderName="Kẹ" variant="current" />);
  expect(filled(GOOSE)).not.toBeNull();
  cleanup();

  render(<Character role={{ ...swordsman, faction: 'neutral' }} holderName="Kẹ" variant="current" />);
  expect(filled(NEUTRAL)).not.toBeNull();
});

test('previous holder is marked', () => {
  render(<Character role={swordsman} holderName="Ngỗng Một" variant="previous" />);
  expect(screen.getByLabelText('Kiếm sĩ: Ngỗng Một (mùa trước)')).toBeInTheDocument();
  expect(screen.getByText('Mùa trước')).toBeInTheDocument();
  expect(screen.getByText('Ngỗng Một')).toBeInTheDocument();
  // Thân vẫn mang màu phe nhưng mờ đi.
  expect(filled(DUCK)?.closest('[opacity="0.45"]')).not.toBeNull();
});

test('custom image replaces drawing', () => {
  render(<Character role={{ ...swordsman, hasImage: true }} holderName="Kẹ" variant="current" />);
  const img = document.querySelector('img');
  expect(img).toHaveAttribute('src', '/api/roles/61/image');
  expect(img).toHaveAttribute('alt', '');
  expect(img).toHaveAttribute('loading', 'lazy');
  // Không còn thân vẽ (không hình nào tô màu phe), bảng tên vẫn còn.
  expect(filled(DUCK)).toBeNull();
  expect(screen.getByText('Kẹ')).toBeInTheDocument();
  expect(screen.getByLabelText('Kiếm sĩ: Kẹ')).toBeInTheDocument();
});

test('empty variant says nobody holds the role', () => {
  render(<Character role={swordsman} holderName={null} variant="empty" />);
  expect(screen.getByLabelText('Kiếm sĩ: Chưa ai hoá thân')).toBeInTheDocument();
  const plate = screen.getByText('Chưa ai hoá thân');
  expect(plate.tagName).toBe('text');
  expect(plate).not.toHaveAttribute('fill', '#fff');
  expect(filled(GREY)).not.toBeNull();
  expect(filled(DUCK)).toBeNull();
  expect(screen.queryByText('Mùa trước')).not.toBeInTheDocument();
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

test('badge carries the role icon and size caps the width', () => {
  render(<Character role={swordsman} holderName="Kẹ" variant="current" size={96} />);
  expect(screen.getByText('⚔️')).toBeInTheDocument();
  const root = screen.getByRole('img', { name: 'Kiếm sĩ: Kẹ' });
  expect(root).toHaveStyle({ maxWidth: '96px' });
  // Không tự căn giữa: trong hàng flex, mx-auto sẽ đẩy phần tử bên cạnh ra mép (lỗi bảng xếp hạng ở 1024px).
  expect(root).not.toHaveClass('mx-auto');
});
