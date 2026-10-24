import { expect, test } from 'vitest';
import { normalizeText } from '../../src/shared/text.js';

test('normalizeText lowercases, strips diacritics, maps đ → d and collapses whitespace', () => {
  expect(normalizeText('Đa đa')).toBe('da da');
  expect(normalizeText('Kiếm sĩ')).toBe('kiem si');
  expect(normalizeText('Cò gáy')).toBe('co gay');
  expect(normalizeText('Thợ khoá')).toBe('tho khoa');
  expect(normalizeText('  Người   Canada \t ')).toBe('nguoi canada');
  expect(normalizeText('ĐƯỜNG')).toBe('duong');
  expect(normalizeText('Cuckoo')).toBe('cuckoo');
  expect(normalizeText('')).toBe('');
  expect(normalizeText('   ')).toBe('');
});
