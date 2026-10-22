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

/** Transport SMTP từ cấu hình: TLS ngầm (`secure`) chỉ với cổng 465, cổng khác dùng STARTTLS. */
export function createSmtpTransport(smtp: Config['smtp']): Transporter<SMTPSentMessageInfo, SMTPTransportOptions> {
  return createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    auth: { user: smtp.user, pass: smtp.pass },
  });
}

export function createSmtpMailer(smtp: Config['smtp'], transport: MailTransport = createSmtpTransport(smtp)): Mailer {
  return {
    async send(to, subject, text) {
      await transport.sendMail({ from: smtp.from, to, subject, text });
    },
  };
}
