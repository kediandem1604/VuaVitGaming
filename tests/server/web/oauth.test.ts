import { expect, test } from 'vitest';
import { createDiscordOAuthClient } from '../../../src/server/modules/auth/oauth.js';
import { testConfig } from '../../helpers/ctx.js';

type Call = { url: string; init: RequestInit | undefined };

/** fetch giả: ghi lại lời gọi, trả lời theo đường dẫn. Không bao giờ chạm mạng. */
function stubFetch(responses: Record<string, () => Response>): { fetchFn: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    const pathname = new URL(url).pathname;
    const respond = responses[pathname];
    if (!respond) throw new Error(`stubFetch: không có phản hồi cho ${pathname}`);
    return respond();
  }) as typeof fetch;
  return { fetchFn, calls };
}

const json = (body: unknown, status = 200) => () =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('authorizeUrl points at Discord with the right scope, redirect and state', () => {
  const client = createDiscordOAuthClient(testConfig());
  const url = new URL(client.authorizeUrl('abc-123'));
  expect(url.origin + url.pathname).toBe('https://discord.com/oauth2/authorize');
  expect(Object.fromEntries(url.searchParams)).toEqual({
    client_id: 'test-client-id',
    response_type: 'code',
    redirect_uri: 'http://localhost:3000/auth/callback',
    scope: 'identify email',
    state: 'abc-123',
    prompt: 'none',
  });
});

test('redirect URI tolerates a trailing slash on publicUrl', () => {
  const client = createDiscordOAuthClient({ ...testConfig(), publicUrl: 'https://ggd.example/' });
  expect(new URL(client.authorizeUrl('s')).searchParams.get('redirect_uri')).toBe('https://ggd.example/auth/callback');
});

test('exchange swaps the code for a token, then reads the user', async () => {
  const { fetchFn, calls } = stubFetch({
    '/api/oauth2/token': json({ access_token: 'tok-1', token_type: 'Bearer' }),
    '/api/users/@me': json({ id: '42', username: 'ke', email: 'ke@example.com', verified: true }),
  });
  const client = createDiscordOAuthClient(testConfig(), fetchFn);

  expect(await client.exchange('the-code')).toEqual({ discordId: '42', email: 'ke@example.com', emailVerified: true });

  expect(calls).toHaveLength(2);
  const [token, user] = calls;
  expect(token?.url).toBe('https://discord.com/api/oauth2/token');
  expect(token?.init?.method).toBe('POST');
  expect(new Headers(token?.init?.headers).get('content-type')).toBe('application/x-www-form-urlencoded');
  expect(Object.fromEntries(new URLSearchParams(String(token?.init?.body)))).toEqual({
    client_id: 'test-client-id',
    client_secret: 'test-client-secret',
    grant_type: 'authorization_code',
    code: 'the-code',
    redirect_uri: 'http://localhost:3000/auth/callback',
  });

  expect(user?.url).toBe('https://discord.com/api/users/@me');
  expect(new Headers(user?.init?.headers).get('authorization')).toBe('Bearer tok-1');
});

test('missing email or verification flag map to null / false', async () => {
  const { fetchFn } = stubFetch({
    '/api/oauth2/token': json({ access_token: 'tok' }),
    '/api/users/@me': json({ id: '7' }),
  });
  expect(await createDiscordOAuthClient(testConfig(), fetchFn).exchange('c')).toEqual({
    discordId: '7',
    email: null,
    emailVerified: false,
  });

  const nulls = stubFetch({
    '/api/oauth2/token': json({ access_token: 'tok' }),
    '/api/users/@me': json({ id: '7', email: null, verified: false }),
  });
  expect(await createDiscordOAuthClient(testConfig(), nulls.fetchFn).exchange('c')).toEqual({
    discordId: '7',
    email: null,
    emailVerified: false,
  });
});

test('non-2xx or malformed responses throw', async () => {
  const badToken = stubFetch({ '/api/oauth2/token': json({ error: 'invalid_grant' }, 400) });
  await expect(createDiscordOAuthClient(testConfig(), badToken.fetchFn).exchange('c')).rejects.toThrow();
  expect(badToken.calls).toHaveLength(1); // không gọi tiếp /users/@me

  const noToken = stubFetch({ '/api/oauth2/token': json({}) });
  await expect(createDiscordOAuthClient(testConfig(), noToken.fetchFn).exchange('c')).rejects.toThrow();

  const badUser = stubFetch({
    '/api/oauth2/token': json({ access_token: 'tok' }),
    '/api/users/@me': json({ message: '401: Unauthorized' }, 401),
  });
  await expect(createDiscordOAuthClient(testConfig(), badUser.fetchFn).exchange('c')).rejects.toThrow();

  const noId = stubFetch({
    '/api/oauth2/token': json({ access_token: 'tok' }),
    '/api/users/@me': json({ username: 'x' }),
  });
  await expect(createDiscordOAuthClient(testConfig(), noId.fetchFn).exchange('c')).rejects.toThrow();
});
