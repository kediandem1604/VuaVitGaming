import { createTransport } from 'nodemailer';
import { expect, test, vi } from 'vitest';
import { createSmtpMailer, createSmtpTransport } from '../../src/server/mail/smtp-mailer.js';
import { testConfig } from '../helpers/ctx.js';

/** `from: 'GGD Hub <test@example.com>'`, cổng 465. */
const smtp = testConfig().smtp;

/** Transport giả: ghi lại từng lời gọi `sendMail`, không gửi gì. */
function stubTransport() {
  const calls: unknown[] = [];
  return {
    calls,
    async sendMail(message: unknown): Promise<{ messageId: string }> {
      calls.push(message);
      return { messageId: 'stub' };
    },
  };
}

test('smtp mailer uses MAIL_FROM', async () => {
  const transport = stubTransport();
  await createSmtpMailer(smtp, transport).send('an@example.com', 'Chủ đề', 'Nội dung\nDòng hai');
  expect(transport.calls).toEqual([
    { from: 'GGD Hub <test@example.com>', to: 'an@example.com', subject: 'Chủ đề', text: 'Nội dung\nDòng hai' },
  ]);
});

test('works with a real nodemailer transport (jsonTransport, no network)', async () => {
  const transport = createTransport({ jsonTransport: true });
  const sendMail = vi.spyOn(transport, 'sendMail');

  await createSmtpMailer(smtp, transport).send('an@example.com', 'Chủ đề', 'Nội dung');

  const info = (await sendMail.mock.results[0]?.value) as { message: string };
  expect(JSON.parse(info.message)).toMatchObject({
    from: { name: 'GGD Hub', address: 'test@example.com' },
    to: [{ address: 'an@example.com' }],
    subject: 'Chủ đề',
    text: 'Nội dung',
  });
});

test('send failure propagates to the caller', async () => {
  const transport = {
    async sendMail(): Promise<never> {
      throw new Error('SMTP từ chối');
    },
  };
  await expect(createSmtpMailer(smtp, transport).send('an@example.com', 'x', 'y')).rejects.toThrow('SMTP từ chối');
});

test('default transport is SMTP with TLS only on port 465', () => {
  expect(createSmtpTransport(smtp).options).toMatchObject({
    host: 'smtp.test',
    port: 465,
    secure: true,
    requireTLS: false,
    auth: { user: 'test-user', pass: 'test-pass' },
  });
  // Cổng khác 465: STARTTLS bắt buộc (không bao giờ gửi mật khẩu qua kênh thường).
  const starttls = { secure: false, requireTLS: true };
  expect(createSmtpTransport({ ...smtp, port: 587 }).options).toMatchObject({ port: 587, ...starttls });
  expect(createSmtpTransport({ ...smtp, port: 25 }).options).toMatchObject({ port: 25, ...starttls });
  // Không truyền transport → tự tạo transport SMTP; chưa kết nối gì khi tạo.
  expect(() => createSmtpMailer(smtp)).not.toThrow();
});

test('default transport times out instead of hanging the scheduler', () => {
  const timeouts = { connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 15_000 };
  expect(createSmtpTransport(smtp).options).toMatchObject(timeouts);
  expect(createSmtpTransport({ ...smtp, port: 587 }).options).toMatchObject(timeouts);
});
