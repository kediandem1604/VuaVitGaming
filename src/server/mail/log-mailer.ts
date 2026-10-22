import type { Mailer } from '../ports.js';

/** Mailer tạm cho tới khi có SMTP thật (Task 10): chỉ ghi log, không gửi gì. */
export const logMailer: Mailer = {
  async send(to, subject) {
    console.log(`[mail] to=${to} subject=${subject}`);
  },
};
