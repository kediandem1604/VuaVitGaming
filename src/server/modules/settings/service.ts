/**
 * Cài đặt chạy của ứng dụng (admin sửa được trên web): thời lượng vote, giờ tự
 * kết thúc buổi, phút nhắc trước giờ chơi.
 *
 * Mỗi cài đặt là một dòng `app_settings` (`key` → chuỗi số thập phân). Thiếu dòng,
 * hoặc giá trị lưu không phải số nguyên trong khoảng cho phép, thì dùng mặc định —
 * để một dòng bị sửa tay sai không làm bộ hẹn giờ hay vote chạy với số vô lý.
 *
 * Chủ đề giao diện chung (`theme`) cũng là một dòng ở đây nhưng là chuỗi, nên có cặp hàm riêng.
 */

import { z } from 'zod';
import type { ThemeName } from '../../../shared/api-types.js';
import type { Ctx } from '../../ctx.js';
import { appError } from '../../lib/errors.js';

export interface Settings {
  /** Vote MVP mở trong bao nhiêu giờ sau khi buổi kết thúc (1–72). */
  voteDurationHours: number;
  /** Buổi chơi tự kết thúc sau bao nhiêu giờ kể từ giờ bắt đầu (1–24). */
  autoEndHours: number;
  /** Nhắc người tham gia trước giờ bắt đầu bao nhiêu phút (5–120). */
  reminderLeadMinutes: number;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  voteDurationHours: 12,
  autoEndHours: 4,
  reminderLeadMinutes: 15,
});

/** Khoá trong bảng `app_settings` của từng cài đặt. */
const SETTING_KEYS: Record<keyof Settings, string> = {
  voteDurationHours: 'vote_duration_hours',
  autoEndHours: 'auto_end_hours',
  reminderLeadMinutes: 'reminder_lead_minutes',
};

const FIELD_SCHEMAS = {
  voteDurationHours: z.number().int().min(1).max(72),
  autoEndHours: z.number().int().min(1).max(24),
  reminderLeadMinutes: z.number().int().min(5).max(120),
} satisfies Record<keyof Settings, z.ZodTypeAny>;

const SETTING_NAMES = Object.keys(FIELD_SCHEMAS) as (keyof Settings)[];

// Mọi trường đều tuỳ chọn (chỉ ghi khoá được truyền); khoá lạ bị từ chối.
const patchSchema = z
  .object({
    voteDurationHours: FIELD_SCHEMAS.voteDurationHours.optional(),
    autoEndHours: FIELD_SCHEMAS.autoEndHours.optional(),
    reminderLeadMinutes: FIELD_SCHEMAS.reminderLeadMinutes.optional(),
  })
  .strict();

/** Cài đặt hiện tại: dòng đã lưu (hợp lệ) đè lên mặc định. */
export async function getSettings(ctx: Ctx): Promise<Settings> {
  const rows = await ctx.db.appSetting.findMany({ where: { key: { in: Object.values(SETTING_KEYS) } } });
  const stored = new Map(rows.map((r) => [r.key, r.value]));

  const settings: Settings = { ...DEFAULT_SETTINGS };
  for (const name of SETTING_NAMES) {
    const raw = stored.get(SETTING_KEYS[name]);
    if (raw === undefined) continue;
    const parsed = FIELD_SCHEMAS[name].safeParse(parseDecimal(raw));
    if (parsed.success) settings[name] = parsed.data;
  }
  return settings;
}

/**
 * Cập nhật các cài đặt được truyền (khoá vắng mặt giữ nguyên) trong một giao dịch,
 * rồi trả về cài đặt sau khi gộp. Giá trị ngoài khoảng, không nguyên hoặc khoá lạ → `VALIDATION`.
 */
export async function updateSettings(ctx: Ctx, patch: Partial<Settings>): Promise<Settings> {
  const parsed = patchSchema.safeParse(patch);
  if (!parsed.success) throw appError('VALIDATION');

  const writes = SETTING_NAMES.flatMap((name) => {
    const value = parsed.data[name];
    if (value === undefined) return [];
    const key = SETTING_KEYS[name];
    const row = { key, value: String(value) };
    return [ctx.db.appSetting.upsert({ where: { key }, create: row, update: { value: row.value } })];
  });
  if (writes.length > 0) await ctx.db.$transaction(writes);

  return getSettings(ctx);
}

/** Chuỗi số thập phân → số; chuỗi rỗng hay không phải số → NaN (để schema loại). */
function parseDecimal(raw: string): number {
  const trimmed = raw.trim();
  return /^-?\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
}

const THEME_KEY = 'theme';
const themeSchema = z.enum(['night', 'halloween']);

/** Chủ đề admin đã chọn cho mọi người; thiếu dòng hoặc giá trị lạ → `night`. */
export async function getTheme(ctx: Ctx): Promise<ThemeName> {
  const row = await ctx.db.appSetting.findUnique({ where: { key: THEME_KEY } });
  const parsed = themeSchema.safeParse(row?.value);
  return parsed.success ? parsed.data : 'night';
}

/** Đổi chủ đề chung; giá trị lạ → `VALIDATION`. */
export async function setTheme(ctx: Ctx, theme: ThemeName): Promise<ThemeName> {
  const parsed = themeSchema.safeParse(theme);
  if (!parsed.success) throw appError('VALIDATION');
  await ctx.db.appSetting.upsert({
    where: { key: THEME_KEY },
    create: { key: THEME_KEY, value: parsed.data },
    update: { value: parsed.data },
  });
  return parsed.data;
}
