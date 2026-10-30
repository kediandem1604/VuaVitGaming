import type { PrismaClient } from '@prisma/client';
import type { Config } from './config.js';
import type { DiscordNotifier, GuildDirectory, Mailer, RankRoleAdmin } from './ports.js';

/** Mọi thứ một service cần: DB, các cổng ra ngoài, đồng hồ và cấu hình. */
export interface Ctx {
  db: PrismaClient;
  mailer: Mailer;
  notifier: DiscordNotifier;
  directory: GuildDirectory;
  rankRoles: RankRoleAdmin;
  now: () => Date;
  config: Config;
}
