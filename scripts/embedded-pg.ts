import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import exitHook from 'async-exit-hook';
import EmbeddedPostgres from 'embedded-postgres';

// embedded-postgres đăng ký async-exit-hook cho 'beforeExit' và 'exit'. Hook
// 'beforeExit' tự gọi process.exit(0) nên nuốt mất process.exitCode (vitest báo
// fail nhưng tiến trình thoát 0); hook 'exit' gọi callback `done` không tồn tại
// và ném TypeError khi thoát tự nhiên. Gỡ cả hai — startEmbeddedPostgres tự dừng
// cụm khi thoát. Hook tín hiệu (SIGINT/SIGTERM) vẫn giữ nguyên.
exitHook.unhookEvent('beforeExit');
exitHook.unhookEvent('exit');

export type EmbeddedPostgresOptions = {
  dataDir: string;
  port: number;
  databases: string[];
};

export type EmbeddedPostgresHandle = {
  stop(): Promise<void>;
};

export const PG_USER = 'ggd';
export const PG_PASSWORD = 'ggd';

/**
 * Thư mục dữ liệu PostgreSQL nằm ngoài thư mục dự án: đường dẫn dự án có dấu
 * và nằm trong OneDrive, PostgreSQL trên Windows không chịu được.
 */
export function dataDirFor(name: 'pgdata-dev' | 'pgdata-test'): string {
  return path.join(process.env.LOCALAPPDATA ?? os.homedir(), 'ggd-hub', name);
}

const LOG_TAIL = 40;

/**
 * Bật một cụm PostgreSQL nhúng: lần đầu thì `initdb` (user `ggd` / `ggd`),
 * sau đó start và tạo các database còn thiếu.
 */
export async function startEmbeddedPostgres(
  opts: EmbeddedPostgresOptions,
): Promise<EmbeddedPostgresHandle> {
  const recentLogs: string[] = [];
  const remember = (message: string) => {
    recentLogs.push(message.trimEnd());
    if (recentLogs.length > LOG_TAIL) recentLogs.shift();
  };

  const pg = new EmbeddedPostgres({
    databaseDir: opts.dataDir,
    port: opts.port,
    user: PG_USER,
    password: PG_PASSWORD,
    authMethod: 'scram-sha-256',
    persistent: true,
    onLog: remember,
    onError: (err) => remember(String(err)),
  });

  if (!(await isInitialised(opts.dataDir))) {
    await fs.mkdir(opts.dataDir, { recursive: true });
    await pg.initialise();
  }

  try {
    await pg.start();
  } catch (err) {
    const detail = err instanceof Error ? err.message : recentLogs.join('\n');
    throw new Error(
      `Không bật được PostgreSQL nhúng ở cổng ${opts.port} (dữ liệu: ${opts.dataDir}).\n${detail}`,
    );
  }

  // Tiến trình thoát (process.exit) khi cụm còn chạy → vẫn tắt postgres con.
  const killOnExit = () => {
    void pg.stop();
  };
  process.once('exit', killOnExit);

  const stop = async () => {
    process.off('exit', killOnExit);
    await pg.stop();
  };

  try {
    for (const name of opts.databases) {
      await ensureDatabase(pg, name);
    }
  } catch (err) {
    await stop();
    throw err;
  }

  return { stop };
}

async function isInitialised(dataDir: string): Promise<boolean> {
  try {
    await fs.access(path.join(dataDir, 'PG_VERSION'));
    return true;
  } catch {
    return false;
  }
}

async function ensureDatabase(pg: EmbeddedPostgres, name: string): Promise<void> {
  const client = pg.getPgClient();
  await client.connect();
  try {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (rowCount === 0) {
      await client.query(`CREATE DATABASE ${client.escapeIdentifier(name)}`);
    }
  } finally {
    await client.end();
  }
}
