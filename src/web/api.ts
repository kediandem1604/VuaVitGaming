/**
 * Gọi API của chính app: luôn gửi cookie phiên, JSON vào/ra, thân lỗi
 * `{ error: { code, message } }` thành `ApiError`. Gặp 401 ở ngoài trang đăng
 * nhập thì đưa người dùng về `/login` (và vẫn ném lỗi cho nơi gọi).
 */

import type { ApiErrorBody } from '../shared/api-types';

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

export type MutatingMethod = 'POST' | 'PATCH' | 'PUT' | 'DELETE';

const GENERIC_MESSAGE = 'Có lỗi xảy ra, thử lại sau';
const LOGIN_PATH = '/login';

export function apiGet<T>(path: string): Promise<T> {
  return request<T>('GET', path, undefined);
}

export function apiSend<T>(method: MutatingMethod, path: string, body?: unknown): Promise<T> {
  return request<T>(method, path, body);
}

/** Thông báo cho người dùng từ một lỗi bất kỳ (lỗi mạng, lỗi lạ → câu chung). */
export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : GENERIC_MESSAGE;
}

/**
 * `PUT` một tệp nhị phân (ảnh role) dưới dạng body thô với content-type của chính
 * tệp — route ảnh là ngoại lệ duy nhất của guard "chỉ nhận JSON". Lỗi và 401 xử lý
 * như mọi lời gọi khác.
 */
export async function apiPutBlob(path: string, body: Blob): Promise<void> {
  const res = await fetch(path, {
    method: 'PUT',
    credentials: 'include',
    headers: { accept: 'application/json', 'content-type': body.type },
    body,
  });
  if (res.ok) return;
  throw await failure(res);
}

async function request<T>(method: 'GET' | MutatingMethod, path: string, body: unknown): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  const init: RequestInit = { method, credentials: 'include', headers };
  if (method !== 'GET') {
    // Server chỉ nhận thao tác ghi dưới /api khi là JSON (chống CSRF) và chấp nhận
    // body rỗng, nên thao tác ghi luôn mang content-type dù có body hay không.
    headers['content-type'] = 'application/json';
    if (body !== undefined) init.body = JSON.stringify(body);
  }

  const res = await fetch(path, init);
  if (res.status === 204) return undefined as T;
  if (res.ok) return (await res.json()) as T;
  throw await failure(res);
}

/** Phản hồi lỗi → `ApiError`; 401 ngoài trang đăng nhập thì đưa về `/login` trước khi ném. */
async function failure(res: Response): Promise<ApiError> {
  const error = await toApiError(res);
  if (res.status === 401 && window.location.pathname !== LOGIN_PATH) window.location.assign(LOGIN_PATH);
  return error;
}

async function toApiError(res: Response): Promise<ApiError> {
  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    return new ApiError('INTERNAL', GENERIC_MESSAGE, res.status);
  }
  if (isApiErrorBody(parsed)) return new ApiError(parsed.error.code, parsed.error.message, res.status);
  return new ApiError('INTERNAL', GENERIC_MESSAGE, res.status);
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false;
  const error: unknown = (value as { error: unknown }).error;
  if (typeof error !== 'object' || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return typeof code === 'string' && typeof message === 'string';
}
