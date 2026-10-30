/**
 * Lệnh slash của bot (spec §7): định nghĩa gửi lên Discord, lọc gợi ý role cho
 * autocomplete, đọc ngày chơi người dùng gõ, và dựng nội dung trả lời (embed bảng xếp
 * hạng, chữ hồ sơ). Toàn bộ là hàm thuần — `interactions.ts` gọi khi có lệnh; test
 * không cần kết nối Discord. Giới hạn của Discord (25 gợi ý, tên gợi ý 100 ký tự, mô
 * tả 100 ký tự) được tôn trọng ở đây để lệnh không bao giờ bị từ chối.
 */

import { ApplicationCommandOptionType } from 'discord.js';
import type { APIEmbed, RESTPostAPIChatInputApplicationCommandsJSONBody } from 'discord.js';
import type { Faction, HeldRoleDto, RoleDto } from '../../shared/api-types.js';
import { normalizeText } from '../../shared/text.js';
import { dateOnlyToDb, formatSeasonLabel } from '../lib/time.js';
import type { LeaderboardRow } from '../modules/stats/leaderboard.js';
import { formatSeasonScore } from '../../shared/metric.js';

/** Tên lệnh — dùng ở định nghĩa và ở bộ định tuyến để hai bên không lệch nhau. */
export const COMMAND = { report: 'baocao', leaderboard: 'bxh', profile: 'hoso' } as const;

/**
 * Tên tuỳ chọn của `/baocao` (và `role` của `/bxh`). `extraValue` là chỉ số phụ (spec chỉ số phụ
 * §6), `penaltyValue` là chỉ số phạt (spec điểm role §5).
 */
export const OPTION = { role: 'role', value: 'so_lieu', extraValue: 'so_lieu_phu', penaltyValue: 'so_lieu_phat', day: 'ngay', note: 'ghi_chu' } as const;

/** Discord cho tối đa 25 gợi ý autocomplete. */
const MAX_CHOICES = 25;
/** Tên một gợi ý tối đa 100 ký tự. */
const CHOICE_NAME_MAX = 100;
/** Ghi chú lần khai tối đa 300 ký tự (như `reports.ts`). */
const NOTE_MAX = 300;
/** `maxPerGame` (và `extraMaxPerGame`, `penaltyMaxPerGame`) của role nằm trong 1–100 nên giá trị khai không bao giờ quá 100. */
const VALUE_MAX = 100;

/** Màu phe (global constraints): Ngỗng, Vịt, Phe thứ 3. */
const FACTION_COLOUR: Record<Faction, number> = { goose: 0x2f80ed, duck: 0xe5484d, neutral: 0x8e4ec6 };

// ---------------------------------------------------------------------------
// Định nghĩa lệnh
// ---------------------------------------------------------------------------

/**
 * Ba lệnh chỉ dùng trong server (`dm_permission: false`): `/baocao role so_lieu
 * [so_lieu_phu] [so_lieu_phat] [ngay] [ghi_chu]`, `/bxh role`, `/hoso`. Tuỳ chọn bắt buộc
 * đứng trước tuỳ chọn không bắt buộc (Discord yêu cầu) nên `so_lieu_phu` đứng ngay sau
 * `so_lieu`, rồi `so_lieu_phat`; `role` có autocomplete. Role nào có chỉ số phụ/phạt do
 * `submitReport` quyết — ở đây chỉ giới hạn 0–100 như `so_lieu`.
 */
export function commandDefinitions(): RESTPostAPIChatInputApplicationCommandsJSONBody[] {
  const roleOption = (description: string) => ({
    type: ApplicationCommandOptionType.String as const,
    name: OPTION.role,
    description,
    required: true,
    autocomplete: true as const,
  });

  return [
    {
      name: COMMAND.report,
      description: 'Khai điểm một trận vừa chơi (mod duyệt rồi mới tính)',
      dm_permission: false,
      options: [
        roleOption('Role bạn đã chơi (gõ để tìm)'),
        {
          type: ApplicationCommandOptionType.Integer,
          name: OPTION.value,
          description: 'Giá trị chỉ số của role trong trận (vd số mạng chém)',
          required: true,
          min_value: 0,
          max_value: VALUE_MAX,
        },
        {
          type: ApplicationCommandOptionType.Integer,
          name: OPTION.extraValue,
          description: 'Chỉ số phụ, nếu role có (vd số lần ám sát trong cuộc họp); bỏ trống = 0',
          min_value: 0,
          max_value: VALUE_MAX,
        },
        {
          type: ApplicationCommandOptionType.Integer,
          name: OPTION.penaltyValue,
          description: 'Chỉ số phạt, nếu role có (vd số phát bắn sai, bị trừ điểm); bỏ trống = 0',
          min_value: 0,
          max_value: VALUE_MAX,
        },
        {
          type: ApplicationCommandOptionType.String,
          name: OPTION.day,
          description: 'Ngày chơi dd/MM hoặc YYYY-MM-DD (bỏ trống = hôm nay; trước 6:00 sáng = hôm qua)',
        },
        {
          type: ApplicationCommandOptionType.String,
          name: OPTION.note,
          description: 'Ghi chú cho mod (tối đa 300 ký tự)',
          max_length: NOTE_MAX,
        },
      ],
    },
    {
      name: COMMAND.leaderboard,
      description: 'Top 10 của một role trong mùa này',
      dm_permission: false,
      options: [roleOption('Role muốn xem bảng xếp hạng')],
    },
    {
      name: COMMAND.profile,
      description: 'Mã thành viên, role bạn đang giữ mùa này và link web',
      dm_permission: false,
    },
  ];
}

// ---------------------------------------------------------------------------
// Gợi ý role
// ---------------------------------------------------------------------------

export interface RoleChoice {
  /** `{icon} {nameVi} — {metricLabel}`, thêm ` (+ {extraMetricLabel})` nếu role có chỉ số phụ; cắt còn 100 ký tự. */
  name: string;
  /** `key` của role — `/baocao` và `/bxh` tra role theo đây. */
  value: string;
}

/**
 * Gợi ý cho chuỗi đang gõ: khớp một phần `nameVi`/`nameEn`/`key` không phân biệt hoa
 * thường và dấu; tên tiếng Việt BẮT ĐẦU bằng chuỗi gõ xếp trước, trong mỗi nhóm giữ
 * thứ tự `roles` (danh mục). Chuỗi trống → 25 role đầu. Tối đa 25 gợi ý.
 */
export function filterRoleChoices(roles: readonly RoleDto[], query: string): RoleChoice[] {
  const q = normalizeText(query);
  let matched: readonly RoleDto[];
  if (q === '') {
    matched = roles.slice(0, MAX_CHOICES);
  } else {
    const hits = roles
      .map((role) => ({ role, vi: normalizeText(role.nameVi) }))
      .filter(({ role, vi }) => vi.includes(q) || normalizeText(role.nameEn).includes(q) || normalizeText(role.key).includes(q));
    // `sort` ổn định: chỉ đưa nhóm "bắt đầu bằng" lên trước, không đảo thứ tự bên trong.
    hits.sort((x, y) => Number(y.vi.startsWith(q)) - Number(x.vi.startsWith(q)));
    matched = hits.slice(0, MAX_CHOICES).map((h) => h.role);
  }
  return matched.map((role) => ({ name: clipChars(choiceName(role), CHOICE_NAME_MAX), value: role.key }));
}

/** `{icon} {tên} — {nhãn chính}`; role có chỉ số phụ thêm ` (+ {nhãn phụ})` (spec chỉ số phụ §7). */
function choiceName(role: RoleDto): string {
  const extra = role.extraMetricLabel === null ? '' : ` (+ ${role.extraMetricLabel})`;
  return `${role.icon} ${role.nameVi} — ${role.metricLabel}${extra}`;
}

/** Cắt theo ký tự Unicode (không cắt giữa một emoji). */
function clipChars(s: string, max: number): string {
  const chars = [...s];
  return chars.length <= max ? s : chars.slice(0, max).join('');
}

// ---------------------------------------------------------------------------
// Ngày chơi
// ---------------------------------------------------------------------------

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MONTH = /^(\d{1,2})\/(\d{1,2})$/;

/**
 * Ngày chơi người dùng gõ → `YYYY-MM-DD`. Trống → `today`. Nhận `YYYY-MM-DD` hoặc
 * `d/M`/`dd/MM` (năm của `today`; nếu thế là ngày tương lai thì lấy năm trước — khai
 * trận 31/12 vào ngày 01/01). Ngày không có thật (30/02) hay dạng khác → `null`.
 * Chỉ so chuỗi và kiểm tra ngày tồn tại — không có phép toán múi giờ (`today` đã là
 * ngày VN do người gọi tính bằng `time.ts`).
 */
export function parseDayInput(input: string | undefined, today: string): string | null {
  const s = input?.trim() ?? '';
  if (s === '') return today;
  if (ISO_DAY.test(s)) return isRealDate(s) ? s : null;

  const match = DAY_MONTH.exec(s);
  if (!match) return null;
  const day = pad2(Number(match[1] ?? ''));
  const month = pad2(Number(match[2] ?? ''));
  const year = Number(today.slice(0, 4));

  const thisYear = `${year}-${month}-${day}`;
  if (!isRealDate(thisYear)) return null;
  // Chuỗi `YYYY-MM-DD` so theo từ điển đúng bằng so ngày.
  if (thisYear <= today) return thisYear;
  const lastYear = `${pad4(year - 1)}-${month}-${day}`;
  return isRealDate(lastYear) ? lastYear : null;
}

/** `time.ts` từ chối ngày không tồn tại (30/02) — dùng lại làm bộ kiểm tra. */
function isRealDate(ymd: string): boolean {
  try {
    dateOnlyToDb(ymd);
    return true;
  } catch {
    return false;
  }
}

const pad2 = (n: number): string => String(n).padStart(2, '0');
const pad4 = (n: number): string => String(n).padStart(4, '0');

// ---------------------------------------------------------------------------
// Nội dung trả lời
// ---------------------------------------------------------------------------

/**
 * Embed `/bxh`: tiêu đề `👑 Bảng xếp hạng {role} — mùa MM/YYYY`, mỗi dòng
 * `{hạng}. [👑 ]{tên} — {điểm mùa} ({trận} trận)` (👑 cho hạng 1), màu theo phe. Điểm mùa
 * đọc theo `formatSeasonScore`: role có chỉ số phụ → "10 điểm", role thường → "7 mạng chém".
 * Chưa ai có điểm → một câu báo trống.
 */
export function leaderboardEmbed(role: RoleDto, seasonId: string, rows: readonly LeaderboardRow[]): APIEmbed {
  const lines = rows.map((r) => `${r.rank}. ${r.rank === 1 ? '👑 ' : ''}${r.displayName} — ${formatSeasonScore(r.score, role)} (${r.games} trận)`);
  return {
    title: `👑 Bảng xếp hạng ${role.nameVi} — mùa ${formatSeasonLabel(seasonId)}`,
    description: lines.length > 0 ? lines.join('\n') : 'Chưa có ai khai điểm mùa này',
    color: FACTION_COLOUR[role.faction],
  };
}

/** Chữ trả lời `/hoso`: mã thành viên, role đang hoá thân mùa này (`{icon} {tên} ({điểm})`), link trang hồ sơ. */
export function profileText(member: { memberCode: string }, seasonId: string, held: readonly HeldRoleDto[], publicUrl: string): string {
  const roles =
    held.length > 0
      ? `Role đang giữ mùa ${formatSeasonLabel(seasonId)}: ${held.map((h) => `${h.role.icon} ${h.role.nameVi} (${h.score})`).join(', ')}`
      : 'Chưa giữ role nào mùa này.';
  return [`Mã thành viên: ${member.memberCode}`, roles, `Hồ sơ trên web: ${publicUrl}/ho-so`].join('\n');
}
