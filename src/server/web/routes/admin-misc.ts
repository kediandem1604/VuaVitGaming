/**
 * Các route quản trị nhỏ còn lại: danh sách thành viên (email chỉ admin thấy — spec §9) kèm
 * số ngày trong server và số buổi, admin đặt lại số buổi của một người (chỉ admin), nhắc giờ
 * gửi lỗi (spec §9: admin xem danh sách gửi lỗi; mod xem với email trong chữ lỗi đã che —
 * ruling R35), đợt vote đang mở (để đóng sớm — ruling R34a), cài đặt chạy (chỉ admin) và chủ
 * đề giao diện chung (ai cũng đọc được, kể cả trang đăng nhập; chỉ admin đổi).
 * Chỉ kiểm tra DẠNG ở đây; khoảng giá trị của cài đặt và số buổi do service báo.
 */

import type { Member } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type {
  AdminMemberDto,
  NotificationFailureDto,
  OpenVoteRoundDto,
  SettingsDto,
  ThemeDto,
} from '../../../shared/api-types.js';
import { appError } from '../../lib/errors.js';
import { maskEmails } from '../../lib/mask.js';
import { GAMES_INVALID_MESSAGE, GAMES_MAX, GAMES_MIN } from '../../../shared/games.js';
import {
  attendedGamesCounts,
  daysInServer,
  gamesTotal,
  serverJoinedAt,
  setGamesTotal,
} from '../../modules/members/activity.js';
import { listMembers } from '../../modules/members/service.js';
import { sessionLabel } from '../../modules/mvp/votes.js';
import { getSettings, getTheme, setTheme, updateSettings } from '../../modules/settings/service.js';
import { currentMember, requireAdmin, requireMod } from '../auth-plugin.js';
import { idParams } from '../schemas.js';

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

/** Body `PUT /api/admin/theme`: chỉ kiểm tra kiểu; tên chủ đề do service kiểm tra. */
const themeBody = z.object({ theme: z.string() }).strict();

/** Body `PUT /api/admin/members/:id/games`: chỉ một khoá `games`; dạng và khoảng đều báo cùng một câu. */
const gamesBody = z.object({ games: z.number().int().min(GAMES_MIN).max(GAMES_MAX) }).strict();

/** Một dòng thành viên cho trang quản trị; `attended` = số buổi tự đếm (0 khi chưa đi buổi nào). */
function toAdminMemberDto(m: Member, attended: number, showEmail: boolean, now: Date): AdminMemberDto {
  return {
    id: m.id,
    memberCode: m.memberCode,
    displayName: m.displayName,
    accessLevel: m.accessLevel,
    status: m.status,
    email: showEmail ? m.email : null,
    joinedAt: m.joinedAt.toISOString(),
    serverJoinedAt: serverJoinedAt(m).toISOString(),
    daysInServer: daysInServer(m, now),
    games: gamesTotal(attended, m.gamesAdjustment),
    gamesAdjustment: m.gamesAdjustment,
  };
}

export async function adminMiscRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/admin/members', { preHandler: requireMod }, async (request): Promise<AdminMemberDto[]> => {
    const { q, status } = membersQuery.parse(request.query);
    const showEmail = currentMember(request).accessLevel === 'admin';
    const members = await listMembers(app.ctx, { ...(q !== undefined ? { q } : {}), ...(status ? { status } : {}) });
    // Một truy vấn gộp cho số buổi của cả danh sách — không đếm từng người.
    const attended = await attendedGamesCounts(app.ctx, members.map((m) => m.id));
    const now = app.ctx.now();
    return members.map((m) => toAdminMemberDto(m, attended.get(m.id) ?? 0, showEmail, now));
  });

  app.put('/api/admin/members/:id/games', { preHandler: requireAdmin }, async (request): Promise<AdminMemberDto> => {
    // `:id` lạ (chữ, 0) là một thành viên không tồn tại — 404 như id không có trong DB.
    const params = idParams.safeParse(request.params);
    if (!params.success) throw appError('NOT_FOUND');
    const body = gamesBody.safeParse(request.body);
    if (!body.success) throw appError('VALIDATION', GAMES_INVALID_MESSAGE);

    const admin = currentMember(request);
    const { member, attended, previousGames } = await setGamesTotal(app.ctx, params.data.id, body.data.games);
    const dto = toAdminMemberDto(member, attended, true, app.ctx.now());
    console.info(
      `[members] ${admin.displayName} (#${admin.id}) chỉnh số buổi của ${member.displayName} (#${member.id}): ${previousGames} → ${dto.games}`,
    );
    return dto;
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

  app.get('/api/theme', async (): Promise<ThemeDto> => ({ theme: await getTheme(app.ctx) }));

  app.put('/api/admin/theme', { preHandler: requireAdmin }, async (request): Promise<ThemeDto> => {
    const { theme } = themeBody.parse(request.body);
    return { theme: await setTheme(app.ctx, theme as ThemeDto['theme']) };
  });
}
