/**
 * Mailer thật qua SMTP (nodemailer). Mọi email đi từ `MAIL_FROM`.
 *
 * `createSmtpMailer` nhận một transport tuỳ chọn để test cắm bản giả (hoặc
 * `jsonTransport` của nodemailer) mà không cần mạng; không truyền thì tạo
 * transport SMTP từ cấu hình.
 */

import { createTransport } from 'nodemailer';
import type { SMTPSentMessageInfo, SMTPTransportOptions, Transporter } from 'nodemailer';
import type { Config } from '../config.js';
import type { Mailer } from '../ports.js';

/** Phần của transporter nodemailer mà mailer dùng — một transporter thật luôn khớp. */
export interface MailTransport {
  sendMail(message: { from: string; to: string; subject: string; text: string }): Promise<unknown>;
}

/**
 * Mỗi bước SMTP (nối, chào, im lặng) chờ tối đa chừng này: bộ hẹn giờ chạy các
 * việc nối tiếp nhau, một SMTP treo sẽ chặn cả nhắc DM lẫn đồng bộ Discord.
 */
export const SMTP_TIMEOUT_MS = 15_000;

/**
 * Transport SMTP từ cấu hình: TLS ngầm (`secure`) chỉ với cổng 465; cổng khác bắt
 * buộc STARTTLS (`requireTLS`) để mật khẩu không bao giờ đi qua kênh thường.
 */
export function createSmtpTransport(smtp: Config['smtp']): Transporter<SMTPSentMessageInfo, SMTPTransportOptions> {
  return createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    requireTLS: smtp.port !== 465,
    auth: { user: smtp.user, pass: smtp.pass },
    connectionTimeout: SMTP_TIMEOUT_MS,
    greetingTimeout: SMTP_TIMEOUT_MS,
    socketTimeout: SMTP_TIMEOUT_MS,
  });
}

export function createSmtpMailer(smtp: Config['smtp'], transport: MailTransport = createSmtpTransport(smtp)): Mailer {
  return {
    async send(to, subject, text) {
      await transport.sendMail({ from: smtp.from, to, subject, text });
    },
  };
}
