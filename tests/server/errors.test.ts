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
  expect(appError('HIGHLIGHT_DISABLED')).toMatchObject({ status: 409, message: 'Chưa bật tính năng highlight' });
  expect(appError('INVALID_HIGHLIGHT')).toMatchObject({
    status: 400,
    message: 'Highlight phải là video MP4, WebM, MOV hoặc ảnh PNG, JPG, GIF',
  });
  expect(appError('HIGHLIGHT_TOO_LARGE')).toMatchObject({ status: 400, message: 'Highlight quá lớn' });
  expect(appError('HIGHLIGHT_TOO_LARGE', 'Highlight tối đa 10 MB').message).toBe('Highlight tối đa 10 MB');
  expect(appError('HIGHLIGHT_BUSY')).toMatchObject({ status: 503, message: 'Máy chủ đang bận tải highlight khác, thử lại sau' });
  expect(appError('DISCORD_UNAVAILABLE')).toMatchObject({
    status: 503,
    message: 'Không đăng được highlight lên Discord, thử lại sau',
  });
});
