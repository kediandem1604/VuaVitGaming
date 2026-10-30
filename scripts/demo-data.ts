/**
 * Dữ liệu mẫu cho database dev (`npm run db:demo`) — để xem giao diện có dữ liệu mà
 * không cần Discord thật:
 *
 *   - 12 thành viên `demo-*` tên tiếng Việt (một tên dài 24 ký tự); `demo-admin` là admin,
 *     `demo-mod` là mod;
 *   - hôm nay (giờ VN) hai buổi chơi: một buổi 8/12 người lúc 20:00, một buổi 14:00 đã huỷ;
 *   - tối qua một buổi đã kết thúc, đợt vote đã đóng với kết quả ba hạng mục (có một hạng
 *     mục hoà);
 *   - lần khai điểm đã duyệt cho 16 role đủ ba phe (Đại sảnh hoá thân có người), và bốn lần
 *     khai còn chờ duyệt.
 *
 * Chạy lại bao nhiêu lần cũng được: hồ sơ `demo-*` giữ nguyên (cùng id, cùng mã → phiên
 * đăng nhập không mất), còn buổi chơi / vote / lần khai của họ bị xoá rồi tạo lại cho đúng
 * "hôm nay". Dữ liệu không thuộc thành viên demo không bị đụng tới.
 *
 * Chỉ chạy khi DATABASE_URL (từ .env hoặc môi trường) trỏ vào localhost / 127.0.0.1. Mọi
 * thứ đi qua service của ứng dụng (đồng bộ thành viên, tạo buổi, điểm danh, kết thúc, vote,
 * khai và duyệt điểm) với một Discord giả im lặng — không gọi Discord, không gửi email.
 *
 * Đăng nhập thử: đặt DEV_LOGIN=1 trong .env rồi mở /auth/dev-login?discordId=demo-admin.
 */

import '../src/server/load-env.js';
import type { Config } from '../src/server/config.js';
import type { Ctx } from '../src/server/ctx.js';
import { db } from '../src/server/db.js';
import { addDaysVn, toVnDate, vnDateTimeToUtc } from '../src/server/lib/time.js';
import { upsertMemberFromGuild } from '../src/server/modules/members/service.js';
import { castVote, closeVoteRound } from '../src/server/modules/mvp/votes.js';
import { endSession } from '../src/server/modules/sessions/end.js';
import { cancelSession, createSession, setAttendance } from '../src/server/modules/sessions/service.js';
import { reviewReport, submitReport } from '../src/server/modules/stats/reports.js';
import type { DiscordNotifier, GuildDirectory, Mailer, RankRoleAdmin } from '../src/server/ports.js';
import { seedReferenceData } from '../src/server/seed/seed.js';

// ---------------------------------------------------------------------------
// Dữ liệu mẫu
// ---------------------------------------------------------------------------

/** Mọi discordId mẫu bắt đầu bằng tiền tố này — dựa vào đó để dọn rồi tạo lại. */
const DEMO_PREFIX = 'demo-';
/** Role Discord giả quyết định quyền (xem `config.discord` ở `makeCtx`). */
const ADMIN_ROLE_ID = 'demo-role-admin';
const MOD_ROLE_ID = 'demo-role-mod';
/** Id tin Discord giả do notifier im lặng trả về; xoá hết ở bước cuối. */
const PLACEHOLDER_MESSAGE = 'demo-msg-';
/** Ảnh đại diện mặc định công khai của Discord — để giao diện có cả người có ảnh lẫn không. */
const DEFAULT_AVATAR = (n: number): string => `https://cdn.discordapp.com/embed/avatars/${n % 5}.png`;

interface DemoMember {
  discordId: string;
  displayName: string;
  level?: 'admin' | 'mod';
}

const MEMBERS: readonly DemoMember[] = [
  { discordId: 'demo-admin', displayName: 'Quốc Anh', level: 'admin' },
  { discordId: 'demo-mod', displayName: 'Minh Thư', level: 'mod' },
  { discordId: 'demo-bao', displayName: 'Gia Bảo' },
  { discordId: 'demo-chi', displayName: 'Linh Chi' },
  { discordId: 'demo-huy', displayName: 'Đức Huy' },
  { discordId: 'demo-ha', displayName: 'Thu Hà' },
  { discordId: 'demo-khoa', displayName: 'Anh Khoa' },
  { discordId: 'demo-lan', displayName: 'Ngọc Lan' },
  { discordId: 'demo-nam', displayName: 'Hoàng Nam' },
  // 24 ký tự — để thử cách giao diện cắt tên dài.
  { discordId: 'demo-thao', displayName: 'Nguyễn Hoàng Phương Thảo' },
  { discordId: 'demo-son', displayName: 'Thái Sơn' },
  { discordId: 'demo-vy', displayName: 'Tường Vy' },
];

/** Người có mặt ở buổi tối qua (ứng viên vote) — 10 người. */
const LAST_NIGHT_ATTENDEES = ['demo-admin', 'demo-mod', 'demo-bao', 'demo-chi', 'demo-huy', 'demo-ha', 'demo-khoa', 'demo-lan', 'demo-nam', 'demo-thao'];
/** Người đã đăng ký buổi 14:00 hôm nay trước khi buổi bị huỷ. */
const CANCELLED_ATTENDEES = ['demo-son', 'demo-vy', 'demo-khoa'];
/** Người tham gia buổi 20:00 hôm nay (8/12). */
const TONIGHT_ATTENDEES = ['demo-admin', 'demo-bao', 'demo-chi', 'demo-huy', 'demo-ha', 'demo-lan', 'demo-nam', 'demo-thao'];

/**
 * Phiếu của đợt vote tối qua, theo thứ tự hạng mục mặc định của chế độ Cổ điển
 * (sortOrder 1–3): mỗi hạng mục một danh sách `người vote → người được vote`.
 * Hạng mục 1 một người thắng rõ; hạng mục 2 hoà hai người; hạng mục 3 một người thắng.
 */
const BALLOTS: readonly (readonly [voter: string, nominee: string])[][] = [
  [
    ['demo-chi', 'demo-bao'], ['demo-huy', 'demo-bao'], ['demo-ha', 'demo-bao'], ['demo-khoa', 'demo-bao'], ['demo-admin', 'demo-bao'],
    ['demo-lan', 'demo-nam'], ['demo-thao', 'demo-nam'], ['demo-mod', 'demo-nam'],
  ],
  [
    ['demo-bao', 'demo-huy'], ['demo-chi', 'demo-huy'], ['demo-admin', 'demo-huy'],
    ['demo-ha', 'demo-khoa'], ['demo-lan', 'demo-khoa'], ['demo-mod', 'demo-khoa'],
  ],
  [
    ['demo-bao', 'demo-lan'], ['demo-chi', 'demo-lan'], ['demo-nam', 'demo-lan'], ['demo-thao', 'demo-lan'],
    ['demo-khoa', 'demo-ha'],
  ],
];

type ReportRow = readonly [discordId: string, roleKey: string, value: number];

/** Lần khai cho buổi tối qua (ngày chơi = hôm qua, gắn buổi), đã duyệt. Giá trị ≤ maxPerGame của role. */
const LAST_NIGHT_REPORTS: readonly ReportRow[] = [
  ['demo-bao', 'duck', 6],
  ['demo-chi', 'goose', 4],
  ['demo-huy', 'sheriff', 2],
  ['demo-ha', 'detective', 3],
  ['demo-khoa', 'medium', 2],
  ['demo-lan', 'ninja', 2],
  ['demo-nam', 'assassin', 1],
  ['demo-thao', 'vulture', 5],
  ['demo-admin', 'engineer', 3],
  ['demo-mod', 'morphling', 4],
];

/** Lần khai ngày chơi hôm nay (không gắn buổi), đã duyệt — thêm người thứ hai cho vài role để bảng xếp hạng có hạng 2. */
const TODAY_REPORTS: readonly ReportRow[] = [
  ['demo-bao', 'duck', 4],
  ['demo-chi', 'swordsman', 5],
  ['demo-huy', 'cannibal', 3],
  ['demo-ha', 'pelican', 4],
  ['demo-khoa', 'birdwatcher', 3],
  ['demo-lan', 'goose', 5],
  ['demo-nam', 'duck', 7],
  ['demo-thao', 'cuckoo', 9],
  ['demo-son', 'sheriff', 3],
  ['demo-son', 'cuckoo', 7],
  ['demo-vy', 'detective', 2],
  ['demo-vy', 'dodo', 1],
];

/** Lần khai còn chờ duyệt (có một lần của chính admin để thử tự duyệt). */
const PENDING_REPORTS: readonly ReportRow[] = [
  ['demo-admin', 'duck', 5],
  ['demo-mod', 'ninja', 1],
  ['demo-nam', 'falcon', 4],
  ['demo-vy', 'magpie', 2],
];

// ---------------------------------------------------------------------------
// Ctx với Discord/email giả
// ---------------------------------------------------------------------------

/** Nuốt mọi lời gọi Discord; trả id tin giả để service không ghi lỗi và không để lại cờ chờ đăng bù. */
class SilentNotifier implements DiscordNotifier {
  private counter = 0;

  async sendDm(): Promise<void> {}
  async publishSession(): Promise<string> {
    return this.nextId();
  }
  async updateSession(): Promise<void> {}
  async publishVote(): Promise<string> {
    return this.nextId();
  }
  async closeVote(): Promise<void> {}
  async announce(): Promise<void> {}
  async highlightUploadLimit(): Promise<number> {
    return 10 * 1024 * 1024;
  }
  async postHighlight(): Promise<{ channelId: string; messageId: string }> {
    return { channelId: 'demo-highlight', messageId: this.nextId() };
  }
  async deleteMessage(): Promise<void> {}
  async postBountyCompleted(): Promise<void> {}

  private nextId(): string {
    this.counter += 1;
    return `${PLACEHOLDER_MESSAGE}${this.counter}`;
  }
}

/** Không service nào ở đây cần gửi email hay hỏi danh bạ — gọi tới là lỗi lập trình. */
const unusedMailer: Mailer = {
  send: async () => {
    throw new Error('Dữ liệu mẫu không gửi email');
  },
};
const unusedDirectory: GuildDirectory = {
  getMember: async () => {
    throw new Error('Dữ liệu mẫu không hỏi danh bạ Discord');
  },
};
const unusedRankRoles: RankRoleAdmin = {
  ensureRole: async () => {
    throw new Error('Dữ liệu mẫu không gắn role Discord');
  },
  holders: async () => [],
  addRole: async () => {},
  removeRole: async () => {},
};

interface Clock {
  ctx: Ctx;
  setNow(d: Date): void;
}

/**
 * Ctx cho script: đồng hồ đặt được (`setNow`) để tạo buổi "tối qua", vote rồi đóng đợt
 * theo đúng trình tự thời gian mà service đòi hỏi. Cấu hình chỉ cần `discord.adminRoleIds`
 * / `modRoleIds` (quyền của thành viên mẫu); các trường khác là giá trị giữ chỗ.
 */
function makeCtx(databaseUrl: string): Clock {
  let now = new Date();
  const config: Config = {
    port: 3000,
    publicUrl: 'http://localhost:3000',
    sessionSecret: 'demo-data-khong-dung-den-khoa-phien-00000000',
    devLogin: false,
    trustProxyHops: 1,
    databaseUrl,
    discord: {
      token: '',
      clientId: '',
      clientSecret: '',
      guildId: 'demo-guild',
      scheduleChannelId: '',
      voteChannelId: '',
      announceChannelId: '',
      adminRoleIds: [ADMIN_ROLE_ID],
      modRoleIds: [MOD_ROLE_ID],
    },
    smtp: { host: '', port: 465, user: '', pass: '', from: '' },
  };
  const ctx: Ctx = {
    db,
    mailer: unusedMailer,
    notifier: new SilentNotifier(),
    directory: unusedDirectory,
    rankRoles: unusedRankRoles,
    now: () => new Date(now.getTime()),
    config,
  };
  return {
    ctx,
    setNow(d: Date): void {
      now = d;
    },
  };
}

// ---------------------------------------------------------------------------
// Các bước
// ---------------------------------------------------------------------------

/** DATABASE_URL phải trỏ vào máy này; `label` là `host:port/db` (không có mật khẩu) để in ra. */
function localDatabase(url: string | undefined): { url: string; label: string } {
  if (!url) throw new Error('Thiếu DATABASE_URL — đặt trong .env hoặc môi trường.');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('DATABASE_URL không phải URL hợp lệ.');
  }
  if (parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
    throw new Error(
      `Từ chối nạp dữ liệu mẫu: DATABASE_URL trỏ tới "${parsed.hostname}", không phải localhost / 127.0.0.1. Dữ liệu mẫu chỉ dành cho database dev ở máy.`,
    );
  }
  return { url, label: `${parsed.hostname}:${parsed.port}${parsed.pathname}` };
}

/**
 * Xoá buổi chơi (kèm điểm danh, nhắc giờ, đợt vote, phiếu, kết quả) do thành viên demo
 * tạo và mọi lần khai của họ hoặc gắn với buổi đó. Hồ sơ `demo-*` và phiên web giữ nguyên.
 */
async function removeDemoActivity(): Promise<void> {
  const demoIds = (await db.member.findMany({ where: { discordId: { startsWith: DEMO_PREFIX } }, select: { id: true } })).map((m) => m.id);
  if (demoIds.length === 0) return;
  const sessionIds = (await db.gameSession.findMany({ where: { createdById: { in: demoIds } }, select: { id: true } })).map((s) => s.id);

  const inDemoSession = { sessionId: { in: sessionIds } };
  const inDemoRound = { round: { sessionId: { in: sessionIds } } };
  await db.$transaction([
    db.statReport.deleteMany({ where: { OR: [{ memberId: { in: demoIds } }, inDemoSession] } }),
    db.vote.deleteMany({ where: inDemoRound }),
    db.award.deleteMany({ where: inDemoRound }),
    db.voteMessage.deleteMany({ where: inDemoRound }),
    db.voteRound.deleteMany({ where: inDemoSession }),
    db.notificationLog.deleteMany({ where: inDemoSession }),
    db.attendance.deleteMany({ where: inDemoSession }),
    db.gameSession.deleteMany({ where: { id: { in: sessionIds } } }),
  ]);
}

/** Tạo / làm tươi thành viên mẫu như bot đồng bộ từ server Discord; trả về id theo discordId. */
async function upsertMembers(ctx: Ctx): Promise<Map<string, number>> {
  const ids = new Map<string, number>();
  for (const [i, m] of MEMBERS.entries()) {
    const roleIds = m.level === 'admin' ? [ADMIN_ROLE_ID] : m.level === 'mod' ? [MOD_ROLE_ID] : [];
    const { member } = await upsertMemberFromGuild(ctx, {
      discordId: m.discordId,
      displayName: m.displayName,
      avatarUrl: i % 2 === 0 ? DEFAULT_AVATAR(i) : null,
      roleIds,
    });
    ids.set(m.discordId, member.id);
  }
  return ids;
}

function idOf(ids: Map<string, number>, discordId: string): number {
  const id = ids.get(discordId);
  if (id === undefined) throw new Error(`Dữ liệu mẫu lỗi: không có thành viên "${discordId}"`);
  return id;
}

async function modeIdByKey(key: string): Promise<number> {
  const mode = await db.gameMode.findUnique({ where: { key }, select: { id: true } });
  if (!mode) throw new Error(`Dữ liệu mẫu lỗi: không có chế độ chơi "${key}"`);
  return mode.id;
}

async function roleIdByKey(key: string): Promise<number> {
  const role = await db.role.findUnique({ where: { key }, select: { id: true } });
  if (!role) throw new Error(`Dữ liệu mẫu lỗi: không có role "${key}"`);
  return role.id;
}

const plusMinutes = (d: Date, minutes: number): Date => new Date(d.getTime() + minutes * 60_000);

/** Mọi người trong `who` bấm Tham gia, cách nhau một phút kể từ `from`. */
async function join(clock: Clock, ids: Map<string, number>, sessionId: number, who: readonly string[], from: Date): Promise<void> {
  for (const [i, discordId] of who.entries()) {
    clock.setNow(plusMinutes(from, i));
    await setAttendance(clock.ctx, sessionId, idOf(ids, discordId), true);
  }
}

/**
 * Buổi tối qua 21:00 (Cổ điển): 10 người tham gia, kết thúc 23:30 → mở vote với ba hạng
 * mục mặc định, mọi người vote, đợt đóng lúc 11:30 hôm nay với kết quả.
 */
async function buildLastNight(clock: Clock, ids: Map<string, number>, yesterday: string): Promise<void> {
  const { ctx, setNow } = clock;
  const admin = idOf(ids, 'demo-admin');

  setNow(vnDateTimeToUtc(yesterday, '19:00'));
  const session = await createSession(ctx, admin, {
    startsAt: vnDateTimeToUtc(yesterday, '21:00'),
    modeId: await modeIdByKey('classic'),
    capacity: 16,
    roomCode: 'VN2110',
    note: 'Bản đồ Mallardon, chơi 5 ván',
  });
  await join(clock, ids, session.id, LAST_NIGHT_ATTENDEES, vnDateTimeToUtc(yesterday, '19:05'));

  setNow(vnDateTimeToUtc(yesterday, '23:30'));
  await endSession(ctx, session.id);

  const round = await db.voteRound.findUniqueOrThrow({
    where: { sessionId: session.id },
    select: {
      id: true,
      messages: { select: { categoryId: true }, orderBy: [{ category: { sortOrder: 'asc' } }, { categoryId: 'asc' }] },
    },
  });
  const voteStart = vnDateTimeToUtc(yesterday, '23:36');
  let minute = 0;
  for (const [i, ballots] of BALLOTS.entries()) {
    const categoryId = round.messages[i]?.categoryId;
    if (categoryId === undefined) throw new Error(`Dữ liệu mẫu lỗi: đợt vote chỉ có ${round.messages.length} hạng mục, cần ${BALLOTS.length}`);
    for (const [voter, nominee] of ballots) {
      setNow(plusMinutes(voteStart, minute));
      minute += 1;
      await castVote(ctx, { roundId: round.id, categoryId, voterId: idOf(ids, voter), nomineeId: idOf(ids, nominee) });
    }
  }

  // Đợt tự đóng sau 12 giờ (cài đặt mặc định) → 11:30 hôm nay.
  setNow(plusMinutes(vnDateTimeToUtc(yesterday, '23:30'), 12 * 60));
  await closeVoteRound(ctx, round.id);

  await reportAndApprove(clock, ids, LAST_NIGHT_REPORTS, {
    playedOn: yesterday,
    sessionId: session.id,
    submitFrom: vnDateTimeToUtc(yesterday, '23:35'),
    approveFrom: plusMinutes(vnDateTimeToUtc(yesterday, '23:30'), 9 * 60),
  });
}

/** Hôm nay: buổi 14:00 (Chọn role) có 3 người đăng ký rồi bị huỷ lúc 10:00; buổi 20:00 (Cổ điển) 8/12 người. */
async function buildToday(clock: Clock, ids: Map<string, number>, today: string): Promise<void> {
  const { ctx, setNow } = clock;

  setNow(vnDateTimeToUtc(today, '08:00'));
  const cancelled = await createSession(ctx, idOf(ids, 'demo-mod'), {
    startsAt: vnDateTimeToUtc(today, '14:00'),
    modeId: await modeIdByKey('draft'),
    note: 'Ván chiều cho ai rảnh',
  });
  await join(clock, ids, cancelled.id, CANCELLED_ATTENDEES, vnDateTimeToUtc(today, '08:10'));
  setNow(vnDateTimeToUtc(today, '10:00'));
  await cancelSession(ctx, cancelled.id);

  setNow(vnDateTimeToUtc(today, '09:00'));
  const tonight = await createSession(ctx, idOf(ids, 'demo-admin'), {
    startsAt: vnDateTimeToUtc(today, '20:00'),
    modeId: await modeIdByKey('classic'),
    capacity: 12,
    roomCode: 'GGDVN1',
    note: 'Phòng mở 19:45, vào trước để chia team',
  });
  await join(clock, ids, tonight.id, TONIGHT_ATTENDEES, vnDateTimeToUtc(today, '09:05'));

  await reportAndApprove(clock, ids, TODAY_REPORTS, {
    playedOn: today,
    sessionId: null,
    submitFrom: vnDateTimeToUtc(today, '10:30'),
    approveFrom: vnDateTimeToUtc(today, '11:00'),
  });
  await submitAll(clock, ids, PENDING_REPORTS, { playedOn: today, sessionId: null, from: vnDateTimeToUtc(today, '12:00') });
}

/** Khai từng dòng cách nhau một phút kể từ `from`; trả về id các lần khai. */
async function submitAll(
  clock: Clock,
  ids: Map<string, number>,
  rows: readonly ReportRow[],
  opts: { playedOn: string; sessionId: number | null; from: Date },
): Promise<number[]> {
  const reportIds: number[] = [];
  for (const [i, [discordId, roleKey, value]] of rows.entries()) {
    clock.setNow(plusMinutes(opts.from, i));
    const report = await submitReport(clock.ctx, idOf(ids, discordId), {
      roleId: await roleIdByKey(roleKey),
      value,
      playedOn: opts.playedOn,
      sessionId: opts.sessionId,
    });
    reportIds.push(report.id);
  }
  return reportIds;
}

/** Khai rồi admin duyệt tất cả (admin duyệt được cả lần khai của chính mình). */
async function reportAndApprove(
  clock: Clock,
  ids: Map<string, number>,
  rows: readonly ReportRow[],
  opts: { playedOn: string; sessionId: number | null; submitFrom: Date; approveFrom: Date },
): Promise<void> {
  const reportIds = await submitAll(clock, ids, rows, { playedOn: opts.playedOn, sessionId: opts.sessionId, from: opts.submitFrom });
  const reviewer = { id: idOf(ids, 'demo-admin'), accessLevel: 'admin' as const };
  for (const [i, reportId] of reportIds.entries()) {
    clock.setNow(plusMinutes(opts.approveFrom, i));
    await reviewReport(clock.ctx, reviewer, reportId, { approve: true });
  }
}

/**
 * Id tin giả của notifier im lặng không có thật trên Discord: xoá đi để buổi / tin vote
 * được coi là chưa từng đăng. Cờ `discordDirty` / `resultPending` đã tắt (service coi lần
 * "đăng" giả là thành công) nên bot thật không đăng bù hàng loạt; thay đổi tiếp theo trên
 * một buổi sẽ làm bot đăng tin mới thay vì sửa một tin không tồn tại.
 */
async function clearPlaceholderMessageIds(): Promise<void> {
  await db.$transaction([
    db.gameSession.updateMany({ where: { discordMessageId: { startsWith: PLACEHOLDER_MESSAGE } }, data: { discordMessageId: null } }),
    db.voteMessage.updateMany({ where: { discordMessageId: { startsWith: PLACEHOLDER_MESSAGE } }, data: { discordMessageId: null } }),
  ]);
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { url, label } = localDatabase(process.env.DATABASE_URL);
  const clock = makeCtx(url);
  const today = toVnDate(new Date());
  const yesterday = addDaysVn(today, -1);

  await seedReferenceData(db);
  await removeDemoActivity();

  // Thành viên "vào server" một tháng trước để joinedAt không trùng giờ chạy script.
  clock.setNow(vnDateTimeToUtc(addDaysVn(today, -30), '10:00'));
  const ids = await upsertMembers(clock.ctx);

  await buildLastNight(clock, ids, yesterday);
  await buildToday(clock, ids, today);
  await clearPlaceholderMessageIds();

  const approved = LAST_NIGHT_REPORTS.length + TODAY_REPORTS.length;
  console.log(
    [
      `Đã nạp dữ liệu mẫu vào ${label}:`,
      `  • ${MEMBERS.length} thành viên demo-* (demo-admin là admin, demo-mod là mod)`,
      `  • hôm nay ${today}: buổi 20:00 có ${TONIGHT_ATTENDEES.length}/12 người, buổi 14:00 đã huỷ`,
      `  • tối qua ${yesterday}: buổi 21:00 đã kết thúc, đợt vote đã đóng với kết quả ${BALLOTS.length} hạng mục`,
      `  • ${approved} lần khai điểm đã duyệt, ${PENDING_REPORTS.length} lần chờ duyệt`,
      'Đăng nhập thử (cần DEV_LOGIN=1 trong .env): http://localhost:5173/auth/dev-login?discordId=demo-admin',
      '  (chạy bản build ở cổng 3000 thì thay 5173 bằng 3000)',
    ].join('\n'),
  );
}

try {
  await main();
} catch (err) {
  console.error('Nạp dữ liệu mẫu thất bại.', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
