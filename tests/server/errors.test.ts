import { expect, test } from 'vitest';
import { AppError, appError } from '../../src/server/lib/errors.js';

test('default Vietnamese message and status', () => {
  const e = appError('SESSION_FULL');
  expect(e.status).toBe(409);
  expect(e.message).toBe('Đã đủ người');
});

test('custom message overrides', () => {
  expect(appError('VALUE_OUT_OF_RANGE', 'Giá trị phải từ 0 đến 15').message).toBe('Giá trị phải từ 0 đến 15');
  // Trạng thái vẫn lấy từ bảng mặc định.
  expect(appError('VALUE_OUT_OF_RANGE', 'Giá trị phải từ 0 đến 15').status).toBe(400);
});

test('is a real Error carrying its code', () => {
  const e = appError('NOT_FOUND');
  expect(e).toBeInstanceOf(Error);
  expect(e).toBeInstanceOf(AppError);
  expect(e.code).toBe('NOT_FOUND');
  expect(e.name).toBe('AppError');
  expect(e.status).toBe(404);
  expect(e.message).toBe('Không tìm thấy');
  expect(() => {
    throw e;
  }).toThrow(AppError);
});

test('table spot checks', () => {
  expect(appError('UNAUTHENTICATED')).toMatchObject({ status: 401, message: 'Bạn cần đăng nhập' });
  expect(appError('FORBIDDEN')).toMatchObject({ status: 403, message: 'Bạn không có quyền làm việc này' });
  expect(appError('NOT_MEMBER')).toMatchObject({ status: 403, message: 'Bạn cần vào server Discord trước' });
  expect(appError('RATE_LIMITED')).toMatchObject({ status: 429, message: 'Bạn đã khai quá 30 lần hôm nay' });
  expect(appError('SELF_REVIEW')).toMatchObject({ status: 403, message: 'Mod không được tự duyệt lần khai của mình' });
  expect(appError('INVALID_IMAGE')).toMatchObject({
    status: 400,
    message: 'Ảnh phải là PNG, JPG hoặc WebP, tối đa 1 MB',
  });
});
