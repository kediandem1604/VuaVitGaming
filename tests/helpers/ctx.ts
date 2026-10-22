import type { Config } from '../../src/server/config.js';
import type { Ctx } from '../../src/server/ctx.js';
import { testDb } from './db.js';
import { FakeDirectory, FakeMailer, FakeNotifier } from './fakes.js';

/** Mốc "bây giờ" mặc định của mọi test: 19:00 ngày 22/10/2026 giờ VN. */
export const DEFAULT_TEST_NOW = '2026-10-22T12:00:00Z';

/** Cấu hình test dựng thẳng trong code — không đọc biến môi trường. */
export function testConfig(): Config {
  return {
    port: 3000,
    publicUrl: 'http://localhost:3000',
    sessionSecret: 'test-secret-test-secret-test-secret-32',
    devLogin: false,
    trustProxyHops: 1,
    databaseUrl: 'postgresql://ggd:ggd@localhost:54330/ggd_test',
    discord: {
      token: 'test-token',
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      guildId: 'test-guild',
      scheduleChannelId: 'ch-schedule',
      voteChannelId: 'ch-vote',
      announceChannelId: 'ch-announce',
      adminRoleIds: ['r-admin'],
      modRoleIds: ['r-mod'],
    },
    smtp: {
      host: 'smtp.test',
      port: 465,
      user: 'test-user',
      pass: 'test-pass',
      from: 'GGD Hub <test@example.com>',
    },
  };
}

export function makeTestCtx(): {
  ctx: Ctx;
  mailer: FakeMailer;
  notifier: FakeNotifier;
  directory: FakeDirectory;
  setNow(iso: string): void;
} {
  const mailer = new FakeMailer();
  const notifier = new FakeNotifier();
  const directory = new FakeDirectory();
  let now = new Date(DEFAULT_TEST_NOW);

  const ctx: Ctx = {
    db: testDb,
    mailer,
    notifier,
    directory,
    // Bản sao mới mỗi lần: service nào lỡ sửa Date nhận được cũng không làm lệch đồng hồ test.
    now: () => new Date(now.getTime()),
    config: testConfig(),
  };

  return {
    ctx,
    mailer,
    notifier,
    directory,
    setNow(iso: string): void {
      const next = new Date(iso);
      if (Number.isNaN(next.getTime())) throw new Error(`setNow: mốc thời gian không hợp lệ "${iso}"`);
      now = next;
    },
  };
}
