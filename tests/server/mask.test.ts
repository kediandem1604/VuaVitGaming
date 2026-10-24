import { expect, test } from 'vitest';
import { EMAIL_MASK, maskEmails } from '../../src/server/lib/mask.js';

test('maskEmails replaces every address, keeping the surrounding text', () => {
  expect(maskEmails('550 5.1.1 <user@example.com> không tồn tại')).toBe(`550 5.1.1 <${EMAIL_MASK}> không tồn tại`);
  expect(maskEmails('Gửi tới a.b-c+tag@mail.example.co.uk và d@e.vn thất bại')).toBe(`Gửi tới ${EMAIL_MASK} và ${EMAIL_MASK} thất bại`);
  expect(maskEmails('"Tên" <ten@example.com>')).toBe(`"Tên" <${EMAIL_MASK}>`);
});

test('maskEmails leaves trailing punctuation and non-addresses alone', () => {
  expect(maskEmails('Hộp thư user@example.com. Thử lại sau')).toBe(`Hộp thư ${EMAIL_MASK}. Thử lại sau`);
  expect(maskEmails('(user@example.com)')).toBe(`(${EMAIL_MASK})`);
  expect(maskEmails('Người nhận chặn DM')).toBe('Người nhận chặn DM');
  expect(maskEmails('ký hiệu @ lẻ và ten@khongcodau')).toBe('ký hiệu @ lẻ và ten@khongcodau');
  expect(maskEmails('')).toBe('');
});
