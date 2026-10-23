import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { TEST_DATABASE_URL } from './setup.js';
import { dockerHelp, testDbMode } from './test-db.js';

const TEST_PORT = 54330;

/** Gốc repo (nơi có docker-compose.yml): tests/helpers/ → lên hai cấp. */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Bật PostgreSQL test (Docker mặc định, hoặc nhúng với `GGD_TEST_DB=embedded`) rồi áp
 * dụng migration. Nhánh Docker để container chạy tiếp sau khi test xong (lượt sau nhanh
 * hơn; `resetDb` vẫn xoá dữ liệu giữa các test); nhánh nhúng dừng cụm khi teardown.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const stop = testDbMode(process.env) === 'embedded' ? await startEmbedded() : await startDocker();

  try {
    await prismaMigrateDeploy(TEST_DATABASE_URL);
    await dropLeftoverTestObjects(TEST_DATABASE_URL);
  } catch (err) {
    await stop();
    throw err;
  }

  return stop;
}

/** `docker compose up -d --wait db-test` ở gốc repo; lỗi gì cũng kèm hướng dẫn hai lối ra. */
async function startDocker(): Promise<() => Promise<void>> {
  let result: RunResult;
  try {
    result = await run('docker', ['compose', 'up', '-d', '--wait', 'db-test'], { cwd: REPO_ROOT });
  } catch (err) {
    throw new Error(dockerHelp(err instanceof Error ? err.message : String(err)));
  }
  if (result.code !== 0) throw new Error(dockerHelp(result.output));
  return async () => {};
}

/** PostgreSQL nhúng (phương án dự phòng); chỉ nạp module khi cần để không kéo embedded-postgres vào nhánh Docker. */
async function startEmbedded(): Promise<() => Promise<void>> {
  const { dataDirFor, startEmbeddedPostgres } = await import('../../scripts/embedded-pg.js');
  const pg = await startEmbeddedPostgres({
    dataDir: dataDirFor('pgdata-test'),
    port: TEST_PORT,
    databases: ['ggd_test'],
  });
  return () => pg.stop();
}

async function prismaMigrateDeploy(databaseUrl: string): Promise<void> {
  const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');
  const { code, output } = await run(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
  if (code !== 0) {
    throw new Error(`prisma migrate deploy thất bại (mã ${code ?? 'null'}):\n${output}`);
  }
}

interface RunResult {
  code: number | null;
  /** stdout và stderr gom theo thứ tự nhận được. */
  output: string;
}

/** Chạy một lệnh tới khi thoát, gom stdout+stderr; không chạy được (vd không có lệnh) → reject. */
function run(command: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): Promise<RunResult> {
  const output: string[] = [];
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (chunk: Buffer) => output.push(chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => output.push(chunk.toString('utf8')));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, output: output.join('') }));
  });
}

/**
 * tests/server/seasons.test.ts tạo trigger `ggd_test_block` trên `role_titles` để ép
 * giao dịch chốt mùa thất bại, rồi tự gỡ trong `finally`. Một lượt test bị giết giữa
 * chừng có thể để nó lại (`resetDb` chỉ TRUNCATE, không đụng trigger) và làm mọi lần
 * ghi `role_titles` sau đó hỏng — gỡ sẵn ở đây để lượt sau luôn sạch.
 */
async function dropLeftoverTestObjects(databaseUrl: string): Promise<void> {
  const db = new PrismaClient({ datasourceUrl: databaseUrl });
  try {
    await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS ggd_test_block ON role_titles');
    await db.$executeRawUnsafe('DROP FUNCTION IF EXISTS ggd_test_block()');
  } finally {
    await db.$disconnect();
  }
}
