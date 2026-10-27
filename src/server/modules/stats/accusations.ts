/**
 * Báo cáo người chơi (spec điểm role §6): người khai gửi kèm một lần khai của mình một báo cáo
 * "{người} (đang chơi {role}) đã bắn {người bị bắn} thuộc {phe}" trong ngày chơi của lần khai.
 * File này giữ phần riêng của báo cáo; `reports.ts` gọi tới trong đúng giao dịch của việc khai,
 * sửa, duyệt và huỷ duyệt.
 *
 * Vụ: hai báo cáo cùng (người bị báo cáo, role, người bị bắn, ngày chơi) là một vụ. Một báo cáo
 * `pending` được HIỆN (mod quyết trên khung báo cáo) khi nó là báo cáo `pending` sớm nhất của vụ
 * (theo `createdAt`, rồi `id`) VÀ vụ chưa có báo cáo `approved` mà mục trừ điểm còn `approved`;
 * còn lại là báo cáo trùng bị ẩn. Báo cáo chỉ `pending` khi lần khai của nó còn `pending` — mọi
 * thay đổi trạng thái lần khai kéo theo báo cáo trong cùng giao dịch.
 *
 * Duyệt (trong giao dịch khoá dòng mùa của `reviewReport`, nên hai lần duyệt cùng mùa xếp hàng):
 * báo cáo hiện + "đúng" → báo cáo `approved`, tạo mục trừ điểm (`source = 'accusation'`, đã duyệt,
 * `penaltyValue = 1`) cho người bị báo cáo, mọi báo cáo `pending` khác của vụ → `superseded`; bác →
 * `rejected` kèm lý do. Báo cáo trùng bị ẩn vì vụ đã bị trừ điểm: lần khai được duyệt → `superseded`,
 * bị từ chối → `rejected` cùng lý do. Báo cáo trùng bị ẩn vì còn báo cáo `pending` sớm hơn (đang chờ
 * quyết): KHÔNG duyệt được lần khai của nó (`reviewReport` chặn 409 — báo cáo sớm nhất phải được quyết
 * trước, bị bác thì báo cáo này hiện lên); từ chối thì báo cáo → `rejected` cùng lý do. Huỷ duyệt lần khai người báo cáo kéo theo huỷ mục trừ điểm (nếu nó còn
 * `approved` — đã huỷ riêng trước thì thôi, không lỗi).
 */

import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { AccusationDto, AccusationInputDto, Faction } from '../../../shared/api-types.js';
import { appError } from '../../lib/errors.js';
import { dbToDateOnly, formatVnDay } from '../../lib/time.js';

/** Lý do ghi vào báo cáo trùng khi vụ đã được duyệt trước. */
export const SUPERSEDED_REASON = 'Đã có người báo cáo trước';

/** Tên phe trong câu "(phe …)" của ghi chú mục trừ điểm và DM. */
const FACTION_NAME: Record<Faction, string> = { goose: 'Ngỗng', duck: 'Vịt', neutral: 'thứ 3' };

const INT32_MAX = 2_147_483_647;
const idSchema = z.number().int().min(1).max(INT32_MAX);

const inputSchema = z
  .object({
    accusedId: idSchema,
    accusedRoleId: idSchema,
    victimId: idSchema,
    victimFaction: z.enum(['goose', 'duck', 'neutral']),
  })
  .strict();

type Db = Prisma.TransactionClient;

// ---------------------------------------------------------------------------
// Gửi
// ---------------------------------------------------------------------------

/**
 * Kiểm tra báo cáo gửi kèm lần khai của `reporterId` (spec §6), theo thứ tự: đủ bốn trường đúng
 * kiểu → không tự báo cáo → người bị bắn khác người bị báo cáo → người bị báo cáo là thành viên
 * đang hoạt động → role đang bật và có chỉ số phạt → người bị bắn là thành viên đang hoạt động.
 * Sai → `VALIDATION` với lời nhắn cụ thể. Trả về báo cáo đã chuẩn hoá.
 */
export async function validateAccusation(db: Db, reporterId: number, raw: unknown): Promise<AccusationInputDto> {
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) throw appError('VALIDATION', 'Báo cáo cần đủ người bị báo cáo, role, người bị bắn và phe');
  const a = parsed.data;

  if (a.accusedId === reporterId) throw appError('VALIDATION', 'Không thể tự báo cáo chính mình');
  if (a.victimId === a.accusedId) throw appError('VALIDATION', 'Người bị bắn phải khác người bị báo cáo');

  const accused = await db.member.findUnique({ where: { id: a.accusedId }, select: { status: true } });
  if (accused?.status !== 'active') throw appError('VALIDATION', 'Người bị báo cáo không còn trong server');

  const role = await db.role.findUnique({ where: { id: a.accusedRoleId }, select: { active: true, penaltyPoints: true } });
  if (!role?.active || role.penaltyPoints === null) throw appError('VALIDATION', 'Role bị báo cáo phải đang bật và có điểm trừ');

  const victim = await db.member.findUnique({ where: { id: a.victimId }, select: { status: true } });
  if (victim?.status !== 'active') throw appError('VALIDATION', 'Người bị bắn không còn trong server');

  return a;
}

/** Tạo báo cáo `pending` kèm lần khai vừa tạo/sửa; `createdAt` = giờ gửi báo cáo (xếp thứ tự trong vụ). */
export async function createAccusation(
  db: Db,
  report: { id: number; memberId: number; playedOn: Date },
  a: AccusationInputDto,
  now: Date,
): Promise<void> {
  await db.playerAccusation.create({
    data: {
      reportId: report.id,
      reporterId: report.memberId,
      accusedId: a.accusedId,
      accusedRoleId: a.accusedRoleId,
      victimId: a.victimId,
      victimFaction: a.victimFaction,
      playedOn: report.playedOn,
      createdAt: now,
    },
  });
}

/**
 * Đồng bộ báo cáo khi sửa lần khai còn chờ duyệt (đã cập nhật lần khai trong cùng giao dịch):
 * `undefined` = giữ nguyên (chỉ theo ngày chơi mới của lần khai); `null` = bỏ báo cáo; một báo cáo
 * → giữ nguyên nếu trùng hệt (để không mất chỗ sớm nhất trong vụ), khác thì thay bằng báo cáo mới.
 */
export async function syncAccusationOnEdit(
  db: Db,
  report: { id: number; memberId: number; playedOn: Date },
  next: AccusationInputDto | null | undefined,
  now: Date,
): Promise<void> {
  const existing = await db.playerAccusation.findUnique({ where: { reportId: report.id } });
  if (next === undefined) {
    if (existing && existing.playedOn.getTime() !== report.playedOn.getTime()) {
      await db.playerAccusation.update({ where: { id: existing.id }, data: { playedOn: report.playedOn } });
    }
    return;
  }
  if (
    existing &&
    next !== null &&
    existing.accusedId === next.accusedId &&
    existing.accusedRoleId === next.accusedRoleId &&
    existing.victimId === next.victimId &&
    existing.victimFaction === next.victimFaction &&
    existing.playedOn.getTime() === report.playedOn.getTime()
  ) {
    return;
  }
  if (existing) await db.playerAccusation.delete({ where: { id: existing.id } });
  if (next !== null) await createAccusation(db, report, next, now);
}

// ---------------------------------------------------------------------------
// Vụ và báo cáo trùng
// ---------------------------------------------------------------------------

interface CaseFields {
  id: number;
  status: string;
  accusedId: number;
  accusedRoleId: number;
  victimId: number;
  playedOn: Date;
}

function caseKey(a: Omit<CaseFields, 'id' | 'status'>): string {
  return `${a.accusedId}:${a.accusedRoleId}:${a.victimId}:${dbToDateOnly(a.playedOn)}`;
}

/**
 * Vì sao một báo cáo `pending` bị ẩn: `waitingFor` = người gửi báo cáo `pending` sớm hơn đang được
 * hiện của vụ (báo cáo này chờ báo cáo đó được quyết); `null` = vụ đã bị trừ điểm.
 */
export interface HiddenAccusation {
  waitingFor: { reporterName: string } | null;
}

/**
 * Những báo cáo `pending` trong `accs` đang bị ẩn vì trùng (id → lý do): vụ đã có báo cáo `approved`
 * với mục trừ điểm còn `approved`, hoặc có báo cáo `pending` sớm hơn (`createdAt`, rồi `id`). Một truy vấn.
 */
export async function hiddenAccusations(db: Db, accs: CaseFields[]): Promise<Map<number, HiddenAccusation>> {
  const pending = accs.filter((a) => a.status === 'pending');
  if (pending.length === 0) return new Map();

  const cases = new Map(pending.map((a) => [caseKey(a), a]));
  const rows = await db.playerAccusation.findMany({
    where: {
      OR: [...cases.values()].map((a) => ({
        accusedId: a.accusedId,
        accusedRoleId: a.accusedRoleId,
        victimId: a.victimId,
        playedOn: a.playedOn,
      })),
      status: { in: ['pending', 'approved'] },
    },
    select: {
      id: true,
      status: true,
      accusedId: true,
      accusedRoleId: true,
      victimId: true,
      playedOn: true,
      penaltyReport: { select: { status: true } },
      reporter: { select: { displayName: true } },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });

  // Mỗi vụ: báo cáo được hiện (pending sớm nhất, kèm tên người gửi), hoặc không ai nếu vụ đã bị trừ điểm.
  const shown = new Map<string, { id: number; reporterName: string } | null>();
  for (const r of rows) {
    const key = caseKey(r);
    if (r.status === 'approved') {
      if (r.penaltyReport?.status === 'approved') shown.set(key, null);
    } else if (!shown.has(key)) {
      shown.set(key, { id: r.id, reporterName: r.reporter.displayName });
    }
  }
  const hidden = new Map<number, HiddenAccusation>();
  for (const a of pending) {
    const top = shown.get(caseKey(a));
    // Vụ đã bị trừ điểm (hoặc báo cáo vừa đổi trạng thái giữa hai lần đọc) → ẩn, không chờ ai.
    if (top == null) hidden.set(a.id, { waitingFor: null });
    else if (top.id !== a.id) hidden.set(a.id, { waitingFor: { reporterName: top.reporterName } });
  }
  return hidden;
}

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

/** Phần báo cáo cần để dựng `AccusationDto` và xác định vụ. */
export const ACCUSATION_SELECT = {
  id: true,
  status: true,
  rejectReason: true,
  accusedId: true,
  accusedRoleId: true,
  victimId: true,
  victimFaction: true,
  playedOn: true,
  accused: { select: { id: true, displayName: true } },
  accusedRole: { select: { id: true, nameVi: true, icon: true, penaltyPoints: true } },
  victim: { select: { id: true, displayName: true } },
} satisfies Prisma.PlayerAccusationSelect;

export type AccusationRow = Prisma.PlayerAccusationGetPayload<{ select: typeof ACCUSATION_SELECT }>;

export function toAccusationDto(a: AccusationRow): AccusationDto {
  return {
    id: a.id,
    status: a.status,
    accused: a.accused,
    accusedRole: a.accusedRole,
    victim: a.victim,
    victimFaction: a.victimFaction,
    rejectReason: a.rejectReason,
  };
}

// ---------------------------------------------------------------------------
// Duyệt
// ---------------------------------------------------------------------------

/** Quyết định của mod về báo cáo kèm lần khai (body review `accusation`). */
export type AccusationDecision = 'approve' | 'reject';

/**
 * Báo cáo kèm một lần khai, nó có đang được hiện không, và (khi ẩn) có đang chờ báo cáo sớm hơn của
 * ai không (`waitingFor`; null = đang hiện, hoặc ẩn vì vụ đã bị trừ điểm). Không có báo cáo `pending` → null.
 */
export interface PendingAccusation {
  row: AccusationRow;
  shown: boolean;
  waitingFor: { reporterName: string } | null;
}

/** Báo cáo `pending` kèm lần khai `reportId` (và có được hiện không), hoặc null. */
export async function pendingAccusationOf(db: Db, reportId: number): Promise<PendingAccusation | null> {
  const row = await db.playerAccusation.findFirst({ where: { reportId, status: 'pending' }, select: ACCUSATION_SELECT });
  if (!row) return null;
  const hidden = (await hiddenAccusations(db, [row])).get(row.id);
  return { row, shown: hidden === undefined, waitingFor: hidden?.waitingFor ?? null };
}

/** Lỗi khi duyệt lần khai mà báo cáo kèm theo còn chờ báo cáo sớm hơn của `reporterName` được quyết. */
export function waitingForEarlierError(reporterName: string): Error {
  return appError('NOT_PENDING', `Báo cáo kèm lần khai này trùng với báo cáo của ${reporterName} đang chờ — duyệt lần khai đó trước`);
}

/** Thông tin mục trừ điểm vừa tạo/gỡ — để DM người bị báo cáo và kiểm tra người hoá thân sau khi lưu. */
export interface PenaltyNotice {
  accusedDiscordId: string;
  roleId: number;
  roleName: string;
  penaltyPoints: number;
  playedOn: string;
  victimName: string;
  victimFaction: Faction;
}

/**
 * Áp dụng quyết định về báo cáo kèm lần khai `reportId` trong giao dịch duyệt (`tx`, đã khoá dòng mùa
 * nên mọi lần duyệt/huỷ cùng mùa xếp hàng; lần khai đã đổi trạng thái). `seen` là báo cáo `pending`
 * mod đã thấy (đọc trước giao dịch, null = không có). Đọc lại trong giao dịch:
 * - báo cáo trùng bị ẩn mà nay không còn `pending` (bị thay thế bởi lượt duyệt vừa xong) → không làm gì;
 * - báo cáo trùng nay còn chờ báo cáo sớm hơn mà lần khai được duyệt → 409 (`waitingForEarlierError`);
 * - còn lại phải vẫn đúng báo cáo đó và vẫn hiện/ẩn như lúc đọc — khác (người khai vừa thêm/bỏ/đổi báo
 *   cáo, hoặc báo cáo ẩn vừa được hiện) → `NOT_PENDING` "Lần khai vừa được sửa, hãy xem lại".
 * Trả về mục trừ điểm vừa tạo (báo cáo được duyệt đúng), hoặc null.
 */
export async function applyAccusationReview(
  tx: Db,
  reportId: number,
  seen: PendingAccusation | null,
  o: { reportApproved: boolean; decision: AccusationDecision | undefined; reason: string | null; reviewerId: number; now: Date },
): Promise<PenaltyNotice | null> {
  const fresh = await pendingAccusationOf(tx, reportId);
  if (fresh === null && (seen === null || !seen.shown)) return null;
  if (seen === null || fresh === null || fresh.row.id !== seen.row.id || fresh.shown !== seen.shown) {
    throw appError('NOT_PENDING', 'Lần khai vừa được sửa, hãy xem lại');
  }
  const a = fresh.row;
  const reviewed = { reviewedById: o.reviewerId, reviewedAt: o.now };

  if (!fresh.shown) {
    // Báo cáo sớm hơn của vụ còn chờ quyết: chưa duyệt được lần khai này (kiểm lại trong giao dịch).
    if (o.reportApproved && fresh.waitingFor) throw waitingForEarlierError(fresh.waitingFor.reporterName);
    // Báo cáo trùng bị ẩn vì vụ đã bị trừ điểm (duyệt → `superseded`), hoặc lần khai bị từ chối.
    await tx.playerAccusation.update({
      where: { id: a.id },
      data: o.reportApproved
        ? { status: 'superseded', rejectReason: SUPERSEDED_REASON, ...reviewed }
        : { status: 'rejected', rejectReason: o.reason, ...reviewed },
    });
    return null;
  }

  if (o.decision !== 'approve') {
    await tx.playerAccusation.update({ where: { id: a.id }, data: { status: 'rejected', rejectReason: o.reason, ...reviewed } });
    return null;
  }

  // Báo cáo đúng: mục trừ điểm cho người bị báo cáo, rồi gắn vào báo cáo và thay thế báo cáo trùng.
  const phe = FACTION_NAME[a.victimFaction];
  const penalty = await tx.statReport.create({
    data: {
      memberId: a.accusedId,
      roleId: a.accusedRoleId,
      playedOn: a.playedOn,
      value: 0,
      penaltyValue: 1,
      source: 'accusation',
      status: 'approved',
      note: `Bị báo cáo: bắn ${a.victim.displayName} (phe ${phe})`,
      createdAt: o.now,
      ...reviewed,
    },
  });
  await tx.playerAccusation.update({ where: { id: a.id }, data: { status: 'approved', penaltyReportId: penalty.id, ...reviewed } });
  await tx.playerAccusation.updateMany({
    where: {
      id: { not: a.id },
      status: 'pending',
      accusedId: a.accusedId,
      accusedRoleId: a.accusedRoleId,
      victimId: a.victimId,
      playedOn: a.playedOn,
    },
    data: { status: 'superseded', rejectReason: SUPERSEDED_REASON, ...reviewed },
  });

  const accused = await tx.member.findUniqueOrThrow({ where: { id: a.accusedId }, select: { discordId: true } });
  return {
    accusedDiscordId: accused.discordId,
    roleId: a.accusedRoleId,
    roleName: a.accusedRole.nameVi,
    // Role bị báo cáo luôn có chỉ số phạt (kiểm khi gửi; quản trị role không cho tắt khi đã có báo cáo).
    penaltyPoints: a.accusedRole.penaltyPoints ?? 0,
    playedOn: dbToDateOnly(a.playedOn),
    victimName: a.victim.displayName,
    victimFaction: a.victimFaction,
  };
}

// ---------------------------------------------------------------------------
// Huỷ duyệt
// ---------------------------------------------------------------------------

/**
 * Mục trừ điểm còn `approved` do báo cáo kèm lần khai `reportId` tạo ra (báo cáo `approved`), kèm
 * người bị báo cáo — để huỷ dây chuyền. Không có (không báo cáo, chưa duyệt, mục đã huỷ riêng) → null.
 */
export async function livePenaltyOfReport(
  db: Db,
  reportId: number,
): Promise<{ penaltyReportId: number; accusedId: number; roleId: number } | null> {
  const a = await db.playerAccusation.findFirst({
    where: { reportId, status: 'approved', penaltyReport: { status: 'approved' } },
    select: { penaltyReportId: true, accusedId: true, accusedRoleId: true },
  });
  return a?.penaltyReportId != null ? { penaltyReportId: a.penaltyReportId, accusedId: a.accusedId, roleId: a.accusedRoleId } : null;
}

/**
 * Huỷ mục trừ điểm `penaltyReportId` trong giao dịch huỷ duyệt (`tx`, đã khoá mùa) với cùng người,
 * giờ và lý do. Có điều kiện `status = 'approved'`: mục đã bị huỷ riêng trước thì không làm gì và
 * trả về null (không lỗi, không DM). Báo cáo gốc giữ `approved`.
 */
export async function revokePenalty(
  tx: Db,
  penaltyReportId: number,
  o: { revokerId: number; now: Date; reason: string },
): Promise<PenaltyNotice | null> {
  const { count } = await tx.statReport.updateMany({
    where: { id: penaltyReportId, status: 'approved', source: 'accusation' },
    data: { status: 'revoked', revokedById: o.revokerId, revokedAt: o.now, rejectReason: o.reason },
  });
  return count === 0 ? null : penaltyNoticeOf(tx, penaltyReportId);
}

/** Thông tin DM của một mục trừ điểm (`source = 'accusation'`) theo báo cáo đã tạo ra nó. */
export async function penaltyNoticeOf(db: Db, penaltyReportId: number): Promise<PenaltyNotice | null> {
  const a = await db.playerAccusation.findUnique({
    where: { penaltyReportId },
    select: { ...ACCUSATION_SELECT, accused: { select: { id: true, displayName: true, discordId: true } } },
  });
  if (!a) return null;
  return {
    accusedDiscordId: a.accused.discordId,
    roleId: a.accusedRoleId,
    roleName: a.accusedRole.nameVi,
    penaltyPoints: a.accusedRole.penaltyPoints ?? 0,
    playedOn: dbToDateOnly(a.playedOn),
    victimName: a.victim.displayName,
    victimFaction: a.victimFaction,
  };
}

// ---------------------------------------------------------------------------
// DM
// ---------------------------------------------------------------------------

/** DM khi bị trừ điểm do báo cáo đúng (spec §6). */
export function penaltyDmText(n: PenaltyNotice): string {
  return (
    `Bạn bị trừ ${n.penaltyPoints} điểm (${n.roleName}) ngày ${formatVnDay(n.playedOn)}: ` +
    `bị báo cáo bắn ${n.victimName} (phe ${FACTION_NAME[n.victimFaction]}).`
  );
}

/** DM khi mục trừ điểm bị gỡ (huỷ dây chuyền hoặc huỷ riêng), kèm lý do huỷ. */
export function penaltyRemovedDmText(n: PenaltyNotice, reason: string): string {
  return (
    `Mục trừ điểm (${n.roleName}) ngày ${formatVnDay(n.playedOn)} do bị báo cáo bắn ${n.victimName} ` +
    `(phe ${FACTION_NAME[n.victimFaction]}) đã được gỡ: ${reason}`
  );
}

// ---------------------------------------------------------------------------
// Chốt mùa
// ---------------------------------------------------------------------------

/**
 * Bác mọi báo cáo `pending` của các lần khai sắp bị tự từ chối (`reports` — điều kiện lần khai còn
 * chờ duyệt của mùa) với cùng lý do; gọi TRƯỚC khi từ chối lần khai, trong cùng giao dịch.
 */
export async function rejectPendingAccusations(
  tx: Db,
  reports: Prisma.StatReportWhereInput,
  reason: string,
  now: Date,
): Promise<void> {
  await tx.playerAccusation.updateMany({
    where: { status: 'pending', report: reports },
    data: { status: 'rejected', rejectReason: reason, reviewedAt: now, reviewedById: null },
  });
}
