/**
 * Mailer qua API HTTPS của Brevo (email giao dịch). Dùng khi host chặn SMTP ra ngoài —
 * Railway gói Free và Hobby chỉ cho SMTP từ gói Pro — vì API này đi qua cổng 443.
 *
 * Gói miễn phí của Brevo gửi được 300 email/ngày; người gửi (`MAIL_FROM`) phải là địa
 * chỉ đã xác minh trong Brevo (Senders), không cần tên miền riêng.
 *
 * `createBrevoMailer` nhận `fetch` tuỳ chọn để test cắm bản giả mà không cần mạng.
 */

import type { BrevoMailConfig } from '../config.js';
import type { Mailer } from '../ports.js';

export const BREVO_SEND_URL = 'https://api.brevo.com/v3/smtp/email';

/**
 * Mỗi lần gửi chờ tối đa chừng này: bộ hẹn giờ chạy các việc nối tiếp nhau, một lần gọi
 * API treo sẽ chặn cả nhắc DM lẫn đồng bộ Discord (giống `SMTP_TIMEOUT_MS`).
 */
export const BREVO_TIMEOUT_MS = 15_000;

/** Lỗi Brevo trả về giữ tối đa chừng này ký tự (cột `notification_log.error` giữ 500). */
const DETAIL_MAX_CHARS = 300;

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export function createBrevoMailer(brevo: BrevoMailConfig, fetchImpl: FetchLike = fetch): Mailer {
  return {
    async send(to, subject, text) {
      let res: Response;
      try {
        res = await fetchImpl(BREVO_SEND_URL, {
          method: 'POST',
          headers: { 'api-key': brevo.apiKey, 'content-type': 'application/json', accept: 'application/json' },
          // API ghi `htmlContent` là bắt buộc khi không dùng template: gửi kèm bản HTML của chính nội dung chữ.
          body: JSON.stringify({
            sender: brevo.sender,
            to: [{ email: to }],
            subject,
            textContent: text,
            htmlContent: textToHtml(text),
          }),
          signal: AbortSignal.timeout(BREVO_TIMEOUT_MS),
        });
      } catch (err) {
        throw new Error(`Brevo: không gọi được API (${messageOf(err)})`);
      }
      if (res.ok) return;
      throw new Error(`Brevo từ chối email (HTTP ${res.status}): ${await errorDetail(res)}`);
    },
  };
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Nội dung chữ → HTML tương đương: escape ký tự đặc biệt, xuống dòng thành `<br>`. */
export function textToHtml(text: string): string {
  const escaped = text.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch).replace(/\r?\n/g, '<br>');
  return `<!doctype html><html><body><p>${escaped}</p></body></html>`;
}

/** `code: message` từ thân lỗi JSON của Brevo; không phải JSON thì lấy nguyên văn (đã cắt). */
async function errorDetail(res: Response): Promise<string> {
  let raw = '';
  try {
    raw = await res.text();
  } catch {
    return 'không đọc được nội dung lỗi';
  }
  let detail = raw.trim();
  try {
    const body = JSON.parse(raw) as { code?: unknown; message?: unknown };
    const parts = [body.code, body.message].filter((part): part is string => typeof part === 'string' && part !== '');
    if (parts.length > 0) detail = parts.join(': ');
  } catch {
    // Không phải JSON: giữ nguyên văn.
  }
  return (detail || 'không có nội dung').slice(0, DETAIL_MAX_CHARS);
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
