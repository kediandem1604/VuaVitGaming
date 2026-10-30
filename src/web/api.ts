/**
 * Gọi API của chính app: luôn gửi cookie phiên, JSON vào/ra (trừ hai route tải file thô),
 * thân lỗi `{ error: { code, message } }` thành `ApiError`. Gặp 401 ở ngoài trang đăng
 * nhập thì đưa người dùng về `/login` (và vẫn ném lỗi cho nơi gọi).
 */

import type { ApiErrorBody } from '../shared/api-types';
import { HIGHLIGHT_CONTENT_TYPES } from '../shared/highlight';

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
 * tệp; server trả 204. Lỗi và 401 xử lý như mọi lời gọi khác.
 */
export async function apiPutBlob(path: string, body: Blob): Promise<void> {
  const res = await putRaw(path, body, body.type);
  if (res.ok) return;
  throw await failure(res);
}

/**
 * `PUT` một tệp (highlight kèm lần khai) dưới dạng body thô và đọc JSON trả về. `Content-Type`
 * mặc định là `file.type`; truyền `contentType` khi trình duyệt để trống (xem
 * `highlightContentType`). Lỗi và 401 xử lý như mọi lời gọi khác.
 */
export async function apiUpload<T>(path: string, file: File, contentType: string = file.type): Promise<T> {
  const res = await putRaw(path, file, contentType);
  if (res.ok) return (await res.json()) as T;
  throw await failure(res);
}

/** Hai route tải file (ảnh role, highlight) là ngoại lệ duy nhất của guard "chỉ nhận JSON" trên server. */
function putRaw(path: string, body: Blob, contentType: string): Promise<Response> {
  return fetch(path, {
    method: 'PUT',
    credentials: 'include',
    headers: { accept: 'application/json', 'content-type': contentType },
    body,
  });
}

/**
 * Đuôi file (chữ thường) → content-type highlight, dùng khi trình duyệt không cho biết
 * `file.type` (Safari trên iPhone thường để trống với video .MOV).
 */
const HIGHLIGHT_TYPE_BY_EXTENSION: Readonly<Record<string, string>> = {
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
};

/**
 * Giá trị `accept` cho ô chọn highlight: content-type lẫn đuôi file (cùng bảng với
 * `highlightContentType` nên không lệch nhau) — bộ chọn trên iPhone cần đuôi để đưa ra video.
 */
export const HIGHLIGHT_ACCEPT = [...HIGHLIGHT_CONTENT_TYPES, ...Object.keys(HIGHLIGHT_TYPE_BY_EXTENSION).map((ext) => `.${ext}`)].join(',');

/**
 * Content-type gửi kèm highlight: `file.type` nếu thuộc danh sách; trình duyệt để trống thì
 * đoán theo đuôi file; còn lại (loại khác, không có đuôi) → `null` = không hỗ trợ, không tải lên.
 */
export function highlightContentType(file: File): string | null {
  if (HIGHLIGHT_CONTENT_TYPES.includes(file.type)) return file.type;
  if (file.type !== '') return null;
  const dot = file.name.lastIndexOf('.');
  if (dot === -1) return null;
  return HIGHLIGHT_TYPE_BY_EXTENSION[file.name.slice(dot + 1).toLowerCase()] ?? null;
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
