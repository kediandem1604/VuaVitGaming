import { z } from 'zod';

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
  smtp: {
    host: string;
    port: number;
    user: string;
    pass: string;
    from: string;
  };
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
  SMTP_HOST: requiredString,
  SMTP_PORT: portNumber,
  SMTP_USER: requiredString,
  SMTP_PASS: requiredString,
  MAIL_FROM: requiredString,
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
    smtp: {
      host: e.SMTP_HOST,
      port: e.SMTP_PORT,
      user: e.SMTP_USER,
      pass: e.SMTP_PASS,
      from: e.MAIL_FROM,
    },
  };
}
