/**
 * Ảnh tuỳ chỉnh của role (spec §4.8): PNG/JPG/WebP, tối đa 1 MiB, nhận dạng theo
 * chữ ký đầu file chứ không tin content-type; lưu thẳng trong PostgreSQL (ổ đĩa
 * Railway không giữ file khi deploy lại). Hai cột `image` và `imageMime` luôn được
 * ghi/xoá cùng nhau — `service.ts` dựa vào đó để suy `hasImage` mà không tải blob.
 */

import type { Ctx } from '../../ctx.js';
import { appError } from '../../lib/errors.js';

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp';

/** 1 MiB. */
const MAX_IMAGE_BYTES = 1_048_576;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);
const RIFF = Buffer.from('RIFF');
const WEBP = Buffer.from('WEBP');

/** Định dạng thật của ảnh theo chữ ký đầu file; không phải PNG/JPEG/WebP → null. */
export function detectImageMime(buf: Buffer): ImageMime | null {
  if (hasAt(buf, 0, PNG_SIGNATURE)) return 'image/png';
  if (hasAt(buf, 0, JPEG_SIGNATURE)) return 'image/jpeg';
  if (hasAt(buf, 0, RIFF) && hasAt(buf, 8, WEBP)) return 'image/webp';
  return null;
}

function hasAt(buf: Buffer, offset: number, signature: Buffer): boolean {
  return buf.length >= offset + signature.length && buf.subarray(offset, offset + signature.length).equals(signature);
}

/** Lưu ảnh cho role; quá 1 MiB hoặc không phải ảnh → `INVALID_IMAGE`; role không có → `NOT_FOUND`. */
export async function setRoleImage(ctx: Ctx, roleId: number, buf: Buffer): Promise<void> {
  const mime = buf.length <= MAX_IMAGE_BYTES ? detectImageMime(buf) : null;
  if (mime === null) throw appError('INVALID_IMAGE');
  await updateImage(ctx, roleId, { image: toBytes(buf), imageMime: mime });
}

/**
 * Prisma 6 nhận Bytes là `Uint8Array` trên `ArrayBuffer` thường, còn `Buffer` của Node
 * khai báo `ArrayBufferLike` (có thể là SharedArrayBuffer) nên không gán thẳng được.
 * Trường hợp thường: tạo view cùng bộ nhớ, không sao chép.
 */
function toBytes(buf: Buffer): Uint8Array<ArrayBuffer> {
  const { buffer, byteOffset, byteLength } = buf;
  if (buffer instanceof ArrayBuffer) return new Uint8Array(buffer, byteOffset, byteLength);
  return new Uint8Array(buf);
}

/** Bỏ ảnh tuỳ chỉnh (về nhân vật SVG mặc định); role không có → `NOT_FOUND`. */
export async function clearRoleImage(ctx: Ctx, roleId: number): Promise<void> {
  await updateImage(ctx, roleId, { image: null, imageMime: null });
}

/** Ảnh và mime đã lưu; role không có hoặc không có ảnh → null. */
export async function getRoleImage(ctx: Ctx, roleId: number): Promise<{ buf: Buffer; mime: string } | null> {
  const row = await ctx.db.role.findUnique({ where: { id: roleId }, select: { image: true, imageMime: true } });
  if (!row || row.image === null || row.imageMime === null) return null;
  // Prisma 6 trả Bytes dưới dạng Uint8Array; bọc lại thành Buffer không sao chép.
  return { buf: Buffer.from(row.image.buffer, row.image.byteOffset, row.image.byteLength), mime: row.imageMime };
}

async function updateImage(ctx: Ctx, roleId: number, data: { image: Uint8Array<ArrayBuffer> | null; imageMime: ImageMime | null }): Promise<void> {
  const { count } = await ctx.db.role.updateMany({ where: { id: roleId }, data });
  if (count === 0) throw appError('NOT_FOUND');
}
