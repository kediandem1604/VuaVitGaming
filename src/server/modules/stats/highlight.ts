/**
 * Highlight kèm lần khai điểm (spec highlight §7): chủ lần khai, khi lần khai còn chờ duyệt,
 * tải lên một video/ảnh; app nhận diện loại file theo nội dung (không tin đuôi file hay
 * content-type), kiểm dung lượng theo cấp boost của server Discord, bot đăng file vào kênh
 * `#highlight`, rồi app ghi vị trí tin vào lần khai. File chỉ nằm trong bộ nhớ trong lúc
 * chuyển lên Discord — không lưu trên máy chủ.
 *
 * Thứ tự kiểm tra: tính năng bật → lần khai của mình và còn `pending` → loại file → dung
 * lượng → đăng lên Discord → ghi có điều kiện (`id`, `member_id`, `status = 'pending'`).
 * Lần khai bị duyệt/từ chối đúng lúc đang đăng (ghi không trúng dòng nào) → xoá tin vừa
 * đăng rồi `NOT_PENDING`. Đổi highlight → xoá tin cũ sau khi đã ghi xong. Hai lần xoá đều
 * "cố gắng": lỗi chỉ ghi log, vì ghi trước xoá sau nên lần khai không bao giờ trỏ tới tin
 * đã mất. Hai lần tải lên cùng lúc cho một lần khai có thể để lại một tin thừa trong kênh
 * — chấp nhận được (giao diện chặn bấm hai lần).
 */

import type { ReportDto } from '../../../shared/api-types.js';
import { highlightLimitMessage } from '../../../shared/highlight.js';
import type { Ctx } from '../../ctx.js';
import { appError } from '../../lib/errors.js';
import { dbToDateOnly } from '../../lib/time.js';
import { HighlightChannelError, HighlightRejectedTooLargeError } from '../../ports.js';
import type { HighlightPost } from '../../ports.js';
import { getReportDto, isId } from './reports.js';

export type HighlightExt = 'mp4' | 'mov' | 'webm' | 'png' | 'jpg' | 'gif';

// Chữ ký đầu file. MP4 và MOV cùng là ISO BMFF: `ftyp` ở byte 4, brand ở byte 8 — QuickTime
// dùng brand `qt  `, mọi brand khác (isom, mp42, M4V …) coi là MP4.
const FTYP = Buffer.from('ftyp');
const QUICKTIME_BRAND = Buffer.from('qt  ');
const WEBM_SIGNATURE = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);
const GIF87_SIGNATURE = Buffer.from('GIF87a');
const GIF89_SIGNATURE = Buffer.from('GIF89a');

/** Loại thật của file theo nội dung; không phải MP4/MOV/WebM/PNG/JPEG/GIF (kể cả rỗng) → null. */
export function detectHighlightKind(data: Buffer): { ext: HighlightExt } | null {
  if (hasAt(data, 4, FTYP)) return { ext: hasAt(data, 8, QUICKTIME_BRAND) ? 'mov' : 'mp4' };
  if (hasAt(data, 0, WEBM_SIGNATURE)) return { ext: 'webm' };
  if (hasAt(data, 0, PNG_SIGNATURE)) return { ext: 'png' };
  if (hasAt(data, 0, JPEG_SIGNATURE)) return { ext: 'jpg' };
  if (hasAt(data, 0, GIF87_SIGNATURE) || hasAt(data, 0, GIF89_SIGNATURE)) return { ext: 'gif' };
  return null;
}

function hasAt(buf: Buffer, offset: number, signature: Buffer): boolean {
  return buf.length >= offset + signature.length && buf.subarray(offset, offset + signature.length).equals(signature);
}

/**
 * Cho form Khai điểm: tính năng tắt (chưa đặt kênh) → `{ enabled: false, maxBytes: 0 }`;
 * bật → giới hạn hiện hành của server Discord (hỏi không được → `DISCORD_UNAVAILABLE`).
 */
export async function highlightConfig(ctx: Ctx): Promise<{ enabled: boolean; maxBytes: number }> {
  if (ctx.config.discord.highlightChannelId === null) return { enabled: false, maxBytes: 0 };
  return { enabled: true, maxBytes: await uploadLimit(ctx) };
}

/**
 * Thêm hoặc đổi highlight cho lần khai `reportId` của `memberId`; trả về DTO mới (có
 * `highlightUrl`). Lỗi theo thứ tự ở đầu file: `HIGHLIGHT_DISABLED`, `NOT_FOUND` (không có
 * hoặc của người khác — không lộ lần khai người khác), `NOT_PENDING`, `INVALID_HIGHLIGHT`,
 * `HIGHLIGHT_TOO_LARGE` ("Highlight tối đa N MB" theo giới hạn hiện hành — app tự chặn, hoặc
 * Discord chê file quá lớn), rồi lỗi khi đăng: bot thiếu quyền / kênh đã mất →
 * `HIGHLIGHT_CHANNEL_UNAVAILABLE` (báo admin), còn lại `DISCORD_UNAVAILABLE` (thử lại sau).
 * Đăng lỗi thì không ghi gì vào DB.
 */
export async function attachHighlight(ctx: Ctx, memberId: number, reportId: number, upload: { data: Buffer }): Promise<ReportDto> {
  if (ctx.config.discord.highlightChannelId === null) throw appError('HIGHLIGHT_DISABLED');

  const report = isId(reportId)
    ? await ctx.db.statReport.findUnique({
        where: { id: reportId },
        select: {
          id: true,
          memberId: true,
          status: true,
          value: true,
          playedOn: true,
          highlightChannelId: true,
          highlightMessageId: true,
          member: { select: { displayName: true } },
          role: { select: { nameVi: true, icon: true, metricLabel: true } },
        },
      })
    : null;
  if (!report || report.memberId !== memberId) throw appError('NOT_FOUND');
  if (report.status !== 'pending') throw appError('NOT_PENDING');

  const kind = detectHighlightKind(upload.data);
  if (kind === null) throw appError('INVALID_HIGHLIGHT');

  const maxBytes = await uploadLimit(ctx);
  if (upload.data.length === 0 || upload.data.length > maxBytes) {
    throw appError('HIGHLIGHT_TOO_LARGE', highlightLimitMessage(maxBytes));
  }

  const post: HighlightPost = {
    memberName: report.member.displayName,
    roleLabel: `${report.role.icon} ${report.role.nameVi}`,
    valueText: `${report.value} ${report.role.metricLabel}`,
    playedOnText: toDmy(dbToDateOnly(report.playedOn)),
    fileName: `highlight-${report.id}.${kind.ext}`,
    data: upload.data,
  };
  let posted: { channelId: string; messageId: string };
  try {
    posted = await ctx.notifier.postHighlight(post);
  } catch (err) {
    console.error(`[highlight] Không đăng được highlight của lần khai ${report.id} lên Discord: ${messageOf(err)}`);
    // Lỗi không tự hết khi thử lại thì không bảo người dùng "thử lại sau".
    if (err instanceof HighlightChannelError) throw appError('HIGHLIGHT_CHANNEL_UNAVAILABLE');
    if (err instanceof HighlightRejectedTooLargeError) throw appError('HIGHLIGHT_TOO_LARGE', highlightLimitMessage(maxBytes));
    throw appError('DISCORD_UNAVAILABLE');
  }

  // Khoá lạc quan: chỉ ghi khi lần khai vẫn của người này và vẫn chờ duyệt — mod duyệt/từ
  // chối trong lúc file đang tải lên thì không gắn highlight vào lần khai đã xử lý.
  const { count } = await ctx.db.statReport.updateMany({
    where: { id: report.id, memberId, status: 'pending' },
    data: { highlightChannelId: posted.channelId, highlightMessageId: posted.messageId },
  });
  if (count === 0) {
    await tryDeleteMessage(ctx, posted, 'tin highlight vừa đăng');
    throw appError('NOT_PENDING');
  }

  if (report.highlightChannelId !== null && report.highlightMessageId !== null) {
    await tryDeleteMessage(ctx, { channelId: report.highlightChannelId, messageId: report.highlightMessageId }, 'tin highlight cũ');
  }
  return getReportDto(ctx, report.id);
}

/** Giới hạn tải lên của server Discord; hỏi không được (bot sập) → `DISCORD_UNAVAILABLE`. */
async function uploadLimit(ctx: Ctx): Promise<number> {
  try {
    return await ctx.notifier.highlightUploadLimit();
  } catch (err) {
    console.error(`[highlight] Không hỏi được giới hạn tải lên của server Discord: ${messageOf(err)}`);
    throw appError('DISCORD_UNAVAILABLE');
  }
}

/** Xoá một tin Discord "cố gắng": lỗi chỉ ghi log (tin đã mất thì adapter tự coi là xong). */
async function tryDeleteMessage(ctx: Ctx, location: { channelId: string; messageId: string }, what: string): Promise<void> {
  try {
    await ctx.notifier.deleteMessage(location.channelId, location.messageId);
  } catch (err) {
    console.error(`[highlight] Không xoá được ${what} ${location.messageId} trong kênh ${location.channelId}: ${messageOf(err)}`);
  }
}

/** `YYYY-MM-DD` → `dd/mm/yyyy` (chỉ đổi chỗ, không tính toán ngày — việc đó của `lib/time.ts`). */
function toDmy(vnDate: string): string {
  return vnDate.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$3/$2/$1');
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
