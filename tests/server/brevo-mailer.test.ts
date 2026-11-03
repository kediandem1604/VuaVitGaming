import { expect, test } from 'vitest';
import type { BrevoMailConfig } from '../../src/server/config.js';
import { BREVO_SEND_URL, createBrevoMailer, textToHtml } from '../../src/server/mail/brevo-mailer.js';
import type { FetchLike } from '../../src/server/mail/brevo-mailer.js';

const brevo: BrevoMailConfig = {
  provider: 'brevo',
  apiKey: 'xkeysib-bi-mat',
  sender: { name: 'GGD Hub', email: 'hoi@gmail.com' },
};

/** fetch giả: ghi lại từng lời gọi, trả phản hồi do test chọn. */
function stubFetch(respond: () => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return respond();
  };
  return { calls, fetchImpl };
}

const created = () => new Response(JSON.stringify({ messageId: '<abc@smtp-relay.mailin.fr>' }), { status: 201 });

test('posts the email to the Brevo transactional API with the API key and MAIL_FROM sender', async () => {
  const { calls, fetchImpl } = stubFetch(created);
  await createBrevoMailer(brevo, fetchImpl).send('an@example.com', 'Chủ đề', 'Nội dung\nDòng hai');

  expect(calls).toHaveLength(1);
  const [{ url, init }] = calls as [{ url: string; init: RequestInit }];
  expect(url).toBe(BREVO_SEND_URL);
  expect(url).toBe('https://api.brevo.com/v3/smtp/email');
  expect(init.method).toBe('POST');
  expect(init.headers).toEqual({ 'api-key': 'xkeysib-bi-mat', 'content-type': 'application/json', accept: 'application/json' });
  expect(JSON.parse(String(init.body))).toEqual({
    sender: { name: 'GGD Hub', email: 'hoi@gmail.com' },
    to: [{ email: 'an@example.com' }],
    subject: 'Chủ đề',
    textContent: 'Nội dung\nDòng hai',
    htmlContent: '<!doctype html><html><body><p>Nội dung<br>Dòng hai</p></body></html>',
  });
  // Có hạn chờ: một lần gọi treo không được chặn bộ hẹn giờ.
  expect(init.signal).toBeInstanceOf(AbortSignal);
});

test('the HTML copy escapes markup so text like mode names or notes cannot inject HTML', () => {
  expect(textToHtml('Mã phòng: <b>A&B</b> "x" \'y\'\r\nhttps://ggd.example/?a=1&b=2')).toBe(
    '<!doctype html><html><body><p>Mã phòng: &lt;b&gt;A&amp;B&lt;/b&gt; &quot;x&quot; &#39;y&#39;<br>https://ggd.example/?a=1&amp;b=2</p></body></html>',
  );
});

test('a sender without a name is sent as just the address', async () => {
  const { calls, fetchImpl } = stubFetch(created);
  await createBrevoMailer({ ...brevo, sender: { email: 'hoi@gmail.com' } }, fetchImpl).send('an@example.com', 'x', 'y');
  expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({ sender: { email: 'hoi@gmail.com' } });
});

test('an error response rejects with the status and Brevo message, never the API key', async () => {
  const { fetchImpl } = stubFetch(
    () => new Response(JSON.stringify({ code: 'unauthorized', message: 'Key not found' }), { status: 401 }),
  );
  const error = await createBrevoMailer(brevo, fetchImpl)
    .send('an@example.com', 'x', 'y')
    .catch((err: unknown) => err as Error);
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toBe('Brevo từ chối email (HTTP 401): unauthorized: Key not found');
  expect((error as Error).message).not.toContain('xkeysib');
});

test('a non-JSON error body is kept as text, cut short', async () => {
  const { fetchImpl } = stubFetch(() => new Response(`Bad gateway ${'x'.repeat(1000)}`, { status: 502 }));
  const error = (await createBrevoMailer(brevo, fetchImpl)
    .send('an@example.com', 'x', 'y')
    .catch((err: unknown) => err)) as Error;
  expect(error.message).toMatch(/^Brevo từ chối email \(HTTP 502\): Bad gateway x+$/);
  expect(error.message.length).toBeLessThan(400);

  const empty = stubFetch(() => new Response('', { status: 429 }));
  await expect(createBrevoMailer(brevo, empty.fetchImpl).send('an@example.com', 'x', 'y')).rejects.toThrow(
    'Brevo từ chối email (HTTP 429): không có nội dung',
  );
});

test('a network failure or timeout rejects with a readable message', async () => {
  const { fetchImpl } = stubFetch(() => {
    throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  });
  await expect(createBrevoMailer(brevo, fetchImpl).send('an@example.com', 'x', 'y')).rejects.toThrow(
    'Brevo: không gọi được API (The operation was aborted due to timeout)',
  );
});
