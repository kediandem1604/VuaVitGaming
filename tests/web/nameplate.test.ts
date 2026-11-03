import { expect, test } from 'vitest';
import { nameplateFontSize, truncateName } from '../../src/web/lib/nameplate';

test('font shrinks with length', () => {
  expect(nameplateFontSize('Kẹ')).toBe(18);
  expect(nameplateFontSize('Tên mười một')).toBe(15); // 11–16 ký tự
  expect(nameplateFontSize('Một cái tên khá là dài')).toBe(12);
  expect(truncateName('a'.repeat(30))).toBe('a'.repeat(23) + '…');
});

test('thresholds are inclusive at 10 and 16 characters', () => {
  expect(nameplateFontSize('a'.repeat(10))).toBe(18);
  expect(nameplateFontSize('a'.repeat(11))).toBe(15);
  expect(nameplateFontSize('a'.repeat(16))).toBe(15);
  expect(nameplateFontSize('a'.repeat(17))).toBe(12);
});

test('names within the limit are untouched and max is configurable', () => {
  expect(truncateName('a'.repeat(24))).toBe('a'.repeat(24));
  expect(truncateName('Ngỗng Một')).toBe('Ngỗng Một');
  expect(truncateName('abcdef', 4)).toBe('abc…');
});

test('counts code points, so emoji are not split in half', () => {
  // 30 emoji = 30 code point nhưng 60 đơn vị UTF-16: cắt theo `.length` sẽ bể emoji thứ 12.
  expect(truncateName('🦆'.repeat(30))).toBe('🦆'.repeat(23) + '…');
  expect(nameplateFontSize('🦆'.repeat(10))).toBe(18);
  expect(nameplateFontSize('🦆'.repeat(11))).toBe(15);
});
