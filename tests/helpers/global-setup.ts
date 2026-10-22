import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dataDirFor, startEmbeddedPostgres } from '../../scripts/embedded-pg.js';
import { TEST_DATABASE_URL } from './setup.js';

const TEST_PORT = 54330;

// Bật một PostgreSQL nhúng riêng cho test rồi áp dụng migration; teardown dừng nó.
export default async function globalSetup(): Promise<() => Promise<void>> {
  const pg = await startEmbeddedPostgres({
    dataDir: dataDirFor('pgdata-test'),
    port: TEST_PORT,
    databases: ['ggd_test'],
  });

  try {
    await prismaMigrateDeploy(TEST_DATABASE_URL);
  } catch (err) {
    await pg.stop();
    throw err;
  }

  return () => pg.stop();
}

async function prismaMigrateDeploy(databaseUrl: string): Promise<void> {
  const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');
  const output: string[] = [];

  const code = await new Promise<number | null>((resolve, reject) => {
    const child = spawn(process.execPath, [prismaCli, 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk: Buffer) => output.push(chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => output.push(chunk.toString('utf8')));
    child.on('error', reject);
    child.on('close', resolve);
  });

  if (code !== 0) {
    throw new Error(`prisma migrate deploy thất bại (mã ${code ?? 'null'}):\n${output.join('')}`);
  }
}
