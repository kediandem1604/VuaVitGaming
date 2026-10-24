import { z } from 'zod';

/** Gửi email qua SMTP (vd Gmail): chạy ở máy, hoặc trên host cho phép SMTP ra ngoài. */
export type SmtpMailConfig = {
  provider: 'smtp';
  host: string;
  port: number;
  user: string;
  pass: string;
  /** Nguyên văn `MAIL_FROM`, vd `GGD Hub <ban@gmail.com>`. */
  from: string;
};

/**
 * Gửi email qua API HTTPS của Brevo — cho host chặn SMTP ra ngoài (Railway gói Free và
 * Hobby). `sender` tách từ `MAIL_FROM`; địa chỉ phải là người gửi đã xác minh trong Brevo.
 */
export type BrevoMailConfig = {
  provider: 'brevo';
  apiKey: string;
  sender: { name?: string; email: string };
};

export type Config = {
  port: number;
  /** Không bao giờ có `/` cuối (đã bỏ khi đọc cấu hình). */
  publicUrl: string;
  sessionSecret: string;
  devLogin: boolean;
  /** Số lớp proxy phía trước app (Railway thường là 1): để lấy đúng IP người dùng từ X-Forwarded-For. */
  trustProxyHops: number;
  databaseUrl: string;
  discord: {
    token: string;
    clientId: string;
    clientSecret: string;
    guildId: string;
    scheduleChannelId: string;
    voteChannelId: string;
    announceChannelId: string;
    adminRoleIds: string[];
    modRoleIds: string[];
  };
  /** Có `BREVO_API_KEY` → Brevo; không có → SMTP (khi đó các biến `SMTP_*` là bắt buộc). */
  mail: SmtpMailConfig | BrevoMailConfig;
};

const requiredString = z
  .string({ required_error: 'thiếu biến' })
  .min(1, 'không được để trống');

const portNumber = z.coerce
  .number({ invalid_type_error: 'phải là số' })
  .int('phải là số nguyên')
  .min(1, 'phải từ 1 đến 65535')
  .max(65535, 'phải từ 1 đến 65535');

// "a, b ," -> ["a", "b"]; thiếu biến hoặc chuỗi rỗng -> []
const commaList = z
  .string()
  .default('')
  .transform((raw) =>
    raw
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  );

// Số nguyên ≥ 0; thiếu biến hoặc chuỗi rỗng → 1.
const proxyHops = z.preprocess(
  (raw) => (typeof raw === 'string' && raw.trim() === '' ? undefined : raw),
  z.coerce
    .number({ invalid_type_error: 'phải là số' })
    .int('phải là số nguyên')
    .min(0, 'phải từ 0 trở lên')
    .default(1),
);

/** Chuỗi rỗng / toàn khoảng trắng coi như chưa đặt biến. */
const blankToUndefined = (raw: unknown): unknown => (typeof raw === 'string' && raw.trim() === '' ? undefined : raw);

const optionalString = z.preprocess(blankToUndefined, z.string().optional());

/**
 * `MAIL_FROM` dạng `Tên <email>` hoặc chỉ `email` → người gửi cho API Brevo; sai dạng → null.
 * Kiểm địa chỉ ở mức "có @ và dấu chấm sau @" — Brevo tự từ chối người gửi chưa xác minh.
 */
function parseSender(raw: string): BrevoMailConfig['sender'] | null {
  const named = /^\s*(.*?)\s*<\s*([^<>\s]+)\s*>\s*$/.exec(raw);
  const name = named ? named[1]?.replace(/^"(.*)"$/, '$1').trim() : undefined;
  const email = (named ? named[2] : raw.trim()) ?? '';
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) return null;
  return name ? { name, email } : { email };
}

/** Biến SMTP chỉ bắt buộc khi không dùng Brevo. */
const SMTP_KEYS = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS'] as const;

const envSchema = z.object({
  PORT: portNumber.default(3000),
  PUBLIC_URL: requiredString.url('phải là URL hợp lệ'),
  SESSION_SECRET: z
    .string({ required_error: 'thiếu biến' })
    .min(32, 'cần ít nhất 32 ký tự'),
  DEV_LOGIN: z.string().optional(),
  TRUST_PROXY_HOPS: proxyHops,
  DATABASE_URL: requiredString,
  DISCORD_TOKEN: requiredString,
  DISCORD_CLIENT_ID: requiredString,
  DISCORD_CLIENT_SECRET: requiredString,
  DISCORD_GUILD_ID: requiredString,
  DISCORD_SCHEDULE_CHANNEL_ID: requiredString,
  DISCORD_VOTE_CHANNEL_ID: requiredString,
  DISCORD_ANNOUNCE_CHANNEL_ID: requiredString,
  DISCORD_ADMIN_ROLE_IDS: commaList,
  DISCORD_MOD_ROLE_IDS: commaList,
  BREVO_API_KEY: optionalString,
  SMTP_HOST: optionalString,
  SMTP_PORT: z.preprocess(blankToUndefined, portNumber.optional()),
  SMTP_USER: optionalString,
  SMTP_PASS: optionalString,
  MAIL_FROM: requiredString,
}).superRefine((e, ctx) => {
  if (e.BREVO_API_KEY !== undefined) {
    if (!parseSender(e.MAIL_FROM)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['MAIL_FROM'], message: 'phải có dạng Tên <email@tenmien>' });
    }
    return;
  }
  for (const key of SMTP_KEYS) {
    if (e[key] === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: 'thiếu biến (hoặc đặt BREVO_API_KEY)' });
    }
  }
});

export function loadConfig(env: Record<string, string | undefined>): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Cấu hình môi trường không hợp lệ — ${details}`);
  }

  const e = parsed.data;
  // Không có `/` cuối: link trong DM/email (`${publicUrl}/ho-so`) và callback OAuth không bị `//`.
  const publicUrl = e.PUBLIC_URL.replace(/\/+$/, '');
  return {
    port: e.PORT,
    publicUrl,
    sessionSecret: e.SESSION_SECRET,
    devLogin: e.DEV_LOGIN === '1' && publicUrl.startsWith('http://localhost'),
    trustProxyHops: e.TRUST_PROXY_HOPS,
    databaseUrl: e.DATABASE_URL,
    discord: {
      token: e.DISCORD_TOKEN,
      clientId: e.DISCORD_CLIENT_ID,
      clientSecret: e.DISCORD_CLIENT_SECRET,
      guildId: e.DISCORD_GUILD_ID,
      scheduleChannelId: e.DISCORD_SCHEDULE_CHANNEL_ID,
      voteChannelId: e.DISCORD_VOTE_CHANNEL_ID,
      announceChannelId: e.DISCORD_ANNOUNCE_CHANNEL_ID,
      adminRoleIds: e.DISCORD_ADMIN_ROLE_IDS,
      modRoleIds: e.DISCORD_MOD_ROLE_IDS,
    },
    mail: mailConfig(e),
  };
}

function mailConfig(e: z.infer<typeof envSchema>): Config['mail'] {
  const sender = parseSender(e.MAIL_FROM);
  if (e.BREVO_API_KEY !== undefined && sender) return { provider: 'brevo', apiKey: e.BREVO_API_KEY, sender };
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = e;
  // superRefine đã bảo đảm đủ biến khi không dùng Brevo; kiểm lại để TypeScript thu hẹp kiểu.
  if (SMTP_HOST === undefined || SMTP_PORT === undefined || SMTP_USER === undefined || SMTP_PASS === undefined) {
    throw new Error('Cấu hình môi trường không hợp lệ — thiếu biến SMTP');
  }
  return { provider: 'smtp', host: SMTP_HOST, port: SMTP_PORT, user: SMTP_USER, pass: SMTP_PASS, from: e.MAIL_FROM };
}
