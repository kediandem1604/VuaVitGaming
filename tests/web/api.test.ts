import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ApiError, apiGet, apiPutBlob, apiSend, apiUpload, highlightContentType } from '../../src/web/api';

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

test('apiPutBlob sends the blob raw with its own content type and credentials', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchMock);
  const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' });

  await expect(apiPutBlob('/api/admin/roles/1/image', png)).resolves.toBeUndefined();

  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toBe('/api/admin/roles/1/image');
  expect(init.method).toBe('PUT');
  expect(init.credentials).toBe('include');
  expect(init.body).toBe(png);
  expect(new Headers(init.headers).get('content-type')).toBe('image/png');
});

test('apiPutBlob turns an error body into ApiError and 401 into a login redirect', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(jsonResponse(400, { error: { code: 'INVALID_IMAGE', message: 'Ảnh phải là PNG, JPG hoặc WebP, tối đa 1 MB' } })),
  );
  await expect(apiPutBlob('/api/admin/roles/1/image', new Blob(['x'], { type: 'image/png' }))).rejects.toMatchObject({
    code: 'INVALID_IMAGE',
    message: 'Ảnh phải là PNG, JPG hoặc WebP, tối đa 1 MB',
    status: 400,
  });
  expect(assign).not.toHaveBeenCalled();

  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(jsonResponse(401, { error: { code: 'UNAUTHENTICATED', message: 'Bạn cần đăng nhập' } })),
  );
  await expect(apiPutBlob('/api/admin/roles/1/image', new Blob(['x'], { type: 'image/png' }))).rejects.toMatchObject({ status: 401 });
  expect(assign).toHaveBeenCalledWith('/login');
});

test('highlightContentType falls back to the file extension when the browser gives no type', () => {
  // Safari trên iPhone thường để trống `type` với video .MOV — đoán theo đuôi, không phân biệt hoa thường.
  expect(highlightContentType(new File(['x'], 'clip.MOV', { type: '' }))).toBe('video/quicktime');
  expect(highlightContentType(new File(['x'], 'anh.JPEG', { type: '' }))).toBe('image/jpeg');
  expect(highlightContentType(new File(['x'], 'clip.mp4', { type: 'video/mp4' }))).toBe('video/mp4');
  expect(highlightContentType(new File(['x'], 'anh.png', { type: 'image/png' }))).toBe('image/png');
  // Có `type` nhưng ngoài danh sách thì không đoán theo đuôi nữa.
  expect(highlightContentType(new File(['x'], 'clip.mp4', { type: 'application/octet-stream' }))).toBeNull();
  expect(highlightContentType(new File(['x'], 'a.pdf', { type: 'application/pdf' }))).toBeNull();
  expect(highlightContentType(new File(['x'], 'a.pdf', { type: '' }))).toBeNull();
  expect(highlightContentType(new File(['x'], 'khong-duoi', { type: '' }))).toBeNull();
});

test('apiUpload sends the file as the raw body with its content type', async () => {
  // Mỗi lời gọi một Response mới: body chỉ đọc được một lần.
  const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(200, { id: 3, highlightUrl: 'https://discord.com/channels/1/2/3' })));
  vi.stubGlobal('fetch', fetchMock);
  const clip = new File([new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70])], 'clip.mp4', { type: 'video/mp4' });

  await expect(apiUpload('/api/reports/3/highlight', clip)).resolves.toEqual({ id: 3, highlightUrl: 'https://discord.com/channels/1/2/3' });

  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toBe('/api/reports/3/highlight');
  expect(init.method).toBe('PUT');
  expect(init.credentials).toBe('include');
  expect(init.body).toBe(clip);
  expect(new Headers(init.headers).get('content-type')).toBe('video/mp4');

  // Loại truyền vào ghi đè `file.type` (trình duyệt để trống với .MOV).
  await apiUpload('/api/reports/3/highlight', new File(['x'], 'clip.MOV', { type: '' }), 'video/quicktime');
  const [, movInit] = fetchMock.mock.calls[1] as [string, RequestInit];
  expect(new Headers(movInit.headers).get('content-type')).toBe('video/quicktime');
});

test('apiUpload turns an error body into ApiError and 401 into a login redirect', async () => {
  const clip = () => new File(['x'], 'clip.mp4', { type: 'video/mp4' });
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(jsonResponse(400, { error: { code: 'HIGHLIGHT_TOO_LARGE', message: 'Highlight tối đa 10 MB' } })),
  );
  await expect(apiUpload('/api/reports/3/highlight', clip())).rejects.toMatchObject({
    code: 'HIGHLIGHT_TOO_LARGE',
    message: 'Highlight tối đa 10 MB',
    status: 400,
  });
  expect(assign).not.toHaveBeenCalled();

  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(jsonResponse(401, { error: { code: 'UNAUTHENTICATED', message: 'Bạn cần đăng nhập' } })),
  );
  await expect(apiUpload('/api/reports/3/highlight', clip())).rejects.toMatchObject({ status: 401 });
  expect(assign).toHaveBeenCalledWith('/login');
});
