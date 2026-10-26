/**
 * Danh mục huy hiệu (danh hiệu vĩnh viễn) — spec 2026-10-26-badges-design.md §3.
 * Server dùng để tính và trao (job `badges`), web dùng để hiện mục "Cách nhận".
 * Dùng chung server và web — không import gì từ server hay Prisma.
 *
 * Danh hiệu đã trao lưu chữ hiện đóng băng trong `member_badges`; đổi tên / icon ở đây
 * chỉ ảnh hưởng danh hiệu trao từ đó về sau và mục "Cách nhận".
 */

export type BadgeKind = 'monthly' | 'milestone';

/** Danh hiệu theo tháng (§3.1), trao sau khi tháng chốt. */
export type MonthlyBadgeKey = 'smvp' | 'fun_king' | 'top_goose' | 'top_duck' | 'top_neutral' | 'grinder' | 'versatile';

/** Cột mốc trọn đời (§3.2), trao ngay khi đạt. */
export type MilestoneBadgeKey =
  | 'games_10'
  | 'games_50'
  | 'games_100'
  | 'mvp_1'
  | 'mvp_10'
  | 'mvp_50'
  | 'incarnate_1'
  | 'incarnate_5'
  | 'director';

export type BadgeKey = MonthlyBadgeKey | MilestoneBadgeKey;

export interface BadgeDef {
  key: BadgeKey;
  kind: BadgeKind;
  /** Biểu tượng emoji. */
  icon: string;
  /** Tên danh hiệu; danh hiệu tháng hiện kèm tháng (xem `monthlyBadgeTitle`). */
  name: string;
  /** Một câu "Cách nhận" cho trang Huy hiệu. */
  howTo: string;
}

/** Mọi danh hiệu theo thứ tự spec §3: bảy danh hiệu tháng rồi chín cột mốc. */
export const BADGES: readonly BadgeDef[] = [
  // §3.1 Theo tháng
  { key: 'smvp', kind: 'monthly', icon: '👑', name: 'SMVP', howTo: 'Thắng nhiều hạng mục vote khen nhất trong tháng' },
  { key: 'fun_king', kind: 'monthly', icon: '🤡', name: 'Vua tấu hài', howTo: 'Thắng nhiều hạng mục vote vui nhất trong tháng' },
  { key: 'top_goose', kind: 'monthly', icon: '🪿', name: 'Chiến thần phe Ngỗng', howTo: 'Đứng hạng 1 Top 3 phe Ngỗng của tháng' },
  { key: 'top_duck', kind: 'monthly', icon: '🦆', name: 'Sát thủ phe Vịt', howTo: 'Đứng hạng 1 Top 3 phe Vịt của tháng' },
  { key: 'top_neutral', kind: 'monthly', icon: '🃏', name: 'Trùm phe thứ 3', howTo: 'Đứng hạng 1 Top 3 phe thứ 3 của tháng' },
  { key: 'grinder', kind: 'monthly', icon: '🔥', name: 'Chăm cày', howTo: 'Đi nhiều trận nhất trong tháng' },
  { key: 'versatile', kind: 'monthly', icon: '🎭', name: 'Đa diện', howTo: 'Khai điểm được duyệt ở nhiều role khác nhau nhất (ít nhất 2)' },
  // §3.2 Cột mốc trọn đời
  { key: 'games_10', kind: 'milestone', icon: '🎮', name: 'Quen mặt', howTo: 'Đi đủ 10 trận' },
  { key: 'games_50', kind: 'milestone', icon: '🏅', name: 'Lão làng', howTo: 'Đi đủ 50 trận' },
  { key: 'games_100', kind: 'milestone', icon: '🏆', name: 'Huyền thoại sảnh', howTo: 'Đi đủ 100 trận' },
  { key: 'mvp_1', kind: 'milestone', icon: '⭐', name: 'Ngôi sao mới', howTo: 'Thắng MVP lần đầu' },
  { key: 'mvp_10', kind: 'milestone', icon: '🌟', name: 'Ngôi sao sáng', howTo: 'Thắng MVP 10 lần' },
  { key: 'mvp_50', kind: 'milestone', icon: '💫', name: 'Siêu sao', howTo: 'Thắng MVP 50 lần' },
  { key: 'incarnate_1', kind: 'milestone', icon: '🎖️', name: 'Lần đầu hoá thân', howTo: 'Hoá thân một role trong một mùa đã chốt' },
  { key: 'incarnate_5', kind: 'milestone', icon: '🧬', name: 'Bậc thầy hoá thân', howTo: 'Từng hoá thân 5 role khác nhau' },
  { key: 'director', kind: 'milestone', icon: '🎬', name: 'Đạo diễn', howTo: 'Có một highlight được duyệt' },
];

const BY_KEY: ReadonlyMap<BadgeKey, BadgeDef> = new Map(BADGES.map((b) => [b.key, b]));

/** Mục danh mục của một khoá; khoá nào cũng có trong `BADGES` nên không bao giờ thiếu. */
export function badgeDef(key: BadgeKey): BadgeDef {
  const def = BY_KEY.get(key);
  if (!def) throw new Error(`Không có danh hiệu "${key}" trong danh mục`);
  return def;
}

/**
 * Tên lưu của danh hiệu tháng: `{name} tháng {MM}/{YYYY}` — `('SMVP', '2026-10')` →
 * `SMVP tháng 10/2026`. Cùng dạng `MM/YYYY` với `formatSeasonLabel` phía server (chỉ là
 * định dạng chuỗi mã mùa, không có phép toán múi giờ); không import từ server vì file này
 * dùng chung với web. Mã mùa sai dạng → ném lỗi.
 */
export function monthlyBadgeTitle(name: string, periodId: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(periodId);
  const month = match ? Number(match[2]) : 0;
  if (!match || month < 1 || month > 12) throw new Error(`Mã tháng không hợp lệ: "${periodId}" (cần dạng YYYY-MM)`);
  return `${name} tháng ${match[2]}/${match[1]}`;
}
