/**
 * Che địa chỉ email trong chữ tự do (lỗi của mailer/Discord lưu nguyên văn trong
 * `notification_log.error`, vd `550 5.1.1 <user@example.com> …`). Spec §9: email chỉ
 * bản thân và admin thấy — mod xem danh sách gửi lỗi nhận bản đã che (ruling R35).
 */

/** Chữ thay cho mỗi địa chỉ. */
export const EMAIL_MASK = '[email ẩn]';

/**
 * `local@domain.tld`: không khoảng trắng / ngoặc / dấu nháy / `@` trong từng phần; ký
 * tự cuối của tên miền không phải dấu câu, để `user@example.com.` giữ lại dấu chấm kết
 * câu. Ngoặc bao quanh (`<…>`, `(…)`) được giữ nguyên.
 */
const EMAIL = /[^\s<>()@"']+@[^\s<>()@"']+\.[^\s<>()@"'.,;:]+/g;

/** Thay mọi địa chỉ email trong `text` bằng `[email ẩn]`; chữ khác giữ nguyên. */
export function maskEmails(text: string): string {
  return text.replace(EMAIL, EMAIL_MASK);
}
