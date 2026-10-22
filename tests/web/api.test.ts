import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ApiError, apiGet, apiSend } from '../../src/web/api';

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let assign: ReturnType<typeof vi.fn>;

beforeEach(() => {
  assign = vi.fn();
  vi.stubGlobal('location', { pathname: '/ho-so', assign });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test('API error body becomes ApiError', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(jsonResponse(409, { error: { code: 'SESSION_FULL', message: 'Đã đủ người' } })),
  );
  const promise = apiSend('POST', '/api/x', {});
  await expect(promise).rejects.toBeInstanceOf(ApiError);
  await expect(promise).rejects.toMatchObject({ code: 'SESSION_FULL', message: 'Đã đủ người', status: 409 });
  expect(assign).not.toHaveBeenCalled();
});

test('401 sends user to login', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(jsonResponse(401, { error: { code: 'UNAUTHENTICATED', message: 'Bạn cần đăng nhập' } })),
  );
  await expect(apiGet('/api/me')).rejects.toMatchObject({ code: 'UNAUTHENTICATED', status: 401 });
  expect(assign).toHaveBeenCalledTimes(1);
  expect(assign).toHaveBeenCalledWith('/login');
});

test('401 on the login page does not redirect again', async () => {
  vi.stubGlobal('location', { pathname: '/login', assign });
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(jsonResponse(401, { error: { code: 'UNAUTHENTICATED', message: 'Bạn cần đăng nhập' } })),
  );
  await expect(apiGet('/api/me')).rejects.toMatchObject({ code: 'UNAUTHENTICATED', status: 401 });
  expect(assign).not.toHaveBeenCalled();
});

test('sends JSON with credentials', async () => {
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
  vi.stubGlobal('fetch', fetchMock);

  await expect(apiSend('PATCH', '/api/me', { notifyDm: false })).resolves.toEqual({ ok: true });

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toBe('/api/me');
  expect(init.method).toBe('PATCH');
  expect(init.credentials).toBe('include');
  expect(init.body).toBe(JSON.stringify({ notifyDm: false }));
  expect(new Headers(init.headers).get('content-type')).toBe('application/json');
});

test('GET sends credentials but no body or content-type', async () => {
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { id: 1 }));
  vi.stubGlobal('fetch', fetchMock);

  await expect(apiGet('/api/me')).resolves.toEqual({ id: 1 });

  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toBe('/api/me');
  expect(init.method).toBe('GET');
  expect(init.credentials).toBe('include');
  expect(init.body).toBeUndefined();
  expect(new Headers(init.headers).get('content-type')).toBeNull();
});

test('204 resolves undefined', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
  await expect(apiSend('POST', '/auth/logout')).resolves.toBeUndefined();
});

test('non-JSON error body becomes a generic ApiError', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response('<html>Bad Gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } })),
  );
  await expect(apiGet('/api/me')).rejects.toMatchObject({
    code: 'INTERNAL',
    message: 'Có lỗi xảy ra, thử lại sau',
    status: 502,
  });
  expect(assign).not.toHaveBeenCalled();
});
