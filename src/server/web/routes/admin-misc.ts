/**
 * Các route quản trị nhỏ còn lại: danh sách thành viên (email chỉ admin thấy — spec
 * §9), nhắc giờ gửi lỗi (spec §9: admin xem danh sách gửi lỗi; mod xem với email trong
 * chữ lỗi đã che — ruling R35), đợt vote đang mở (để đóng sớm — ruling R34a) và cài đặt
 * chạy (chỉ admin). Chỉ kiểm tra DẠNG ở đây; khoảng giá trị của cài đặt do service báo.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type {
  AdminMemberDto,
  NotificationFailureDto,
  OpenVoteRoundDto,
  SettingsDto,
} from '../../../shared/api-types.js';
import { maskEmails } from '../../lib/mask.js';
import { listMembers } from '../../modules/members/service.js';
import { sessionLabel } from '../../modules/mvp/votes.js';
import { getSettings, updateSettings } from '../../modules/settings/service.js';
import { currentMember, requireAdmin, requireMod } from '../auth-plugin.js';

/** Trang quản trị chỉ cần những lần gửi lỗi gần đây. */
const FAILURES_LIMIT = 100;

const membersQuery = z.object({
  q: z.string().optional(),
  status: z.enum(['active', 'left']).optional(),
});

/** Chỉ hỗ trợ đợt đang mở — trạng thái khác chưa có nhu cầu. */
const voteRoundsQuery = z.object({ status: z.literal('open') });

// Chỉ kiểm tra kiểu; khoảng giá trị (1–72, 1–24, 5–120) do service kiểm tra.
const settingsPatchBody = z
  .object({
    voteDurationHours: z.number().int().optional(),
    autoEndHours: z.number().int().optional(),
    reminderLeadMinutes: z.number().int().optional(),
  })
  .strict();

export async function adminMiscRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/admin/members', { preHandler: requireMod }, async (request): Promise<AdminMemberDto[]> => {
    const { q, status } = membersQuery.parse(request.query);
    const showEmail = currentMember(request).accessLevel === 'admin';
    const members = await listMembers(app.ctx, { ...(q !== undefined ? { q } : {}), ...(status ? { status } : {}) });
    return members.map((m) => ({
      id: m.id,
      memberCode: m.memberCode,
      displayName: m.displayName,
      accessLevel: m.accessLevel,
      status: m.status,
      email: showEmail ? m.email : null,
      joinedAt: m.joinedAt.toISOString(),
    }));
  });

  app.get('/api/admin/notification-failures', { preHandler: requireMod }, async (request): Promise<NotificationFailureDto[]> => {
    // Lỗi SMTP/Discord lưu nguyên văn thường chứa địa chỉ người nhận: chỉ admin thấy.
    const isAdmin = currentMember(request).accessLevel === 'admin';
    const rows = await app.ctx.db.notificationLog.findMany({
      where: { error: { not: null } },
      orderBy: [{ sentAt: 'desc' }, { sessionId: 'desc' }, { memberId: 'desc' }],
      take: FAILURES_LIMIT,
      select: {
        sessionId: true,
        memberId: true,
        kind: true,
        channel: true,
        sentAt: true,
        error: true,
        member: { select: { displayName: true } },
        session: { select: { startsAt: true, mode: { select: { nameVi: true } } } },
      },
    });
    return rows.map((r) => ({
      sessionId: r.sessionId,
      sessionLabel: sessionLabel({ modeName: r.session.mode.nameVi, startsAt: r.session.startsAt }),
      memberId: r.memberId,
      displayName: r.member.displayName,
      kind: r.kind,
      channel: r.channel,
      sentAt: r.sentAt.toISOString(),
      error: isAdmin ? (r.error ?? '') : maskEmails(r.error ?? ''),
    }));
  });

  app.get('/api/admin/vote-rounds', { preHandler: requireMod }, async (request): Promise<OpenVoteRoundDto[]> => {
    const { status } = voteRoundsQuery.parse(request.query);
    const rows = await app.ctx.db.voteRound.findMany({
      where: { status },
      orderBy: [{ closesAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        sessionId: true,
        closesAt: true,
        session: { select: { startsAt: true, mode: { select: { nameVi: true } } } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      sessionId: r.sessionId,
      sessionLabel: sessionLabel({ modeName: r.session.mode.nameVi, startsAt: r.session.startsAt }),
      closesAt: r.closesAt.toISOString(),
    }));
  });

  app.get('/api/admin/settings', { preHandler: requireAdmin }, async (): Promise<SettingsDto> => getSettings(app.ctx));

  app.patch('/api/admin/settings', { preHandler: requireAdmin }, async (request): Promise<SettingsDto> => {
    const patch = settingsPatchBody.parse(request.body);
    return updateSettings(app.ctx, patch);
  });
}
