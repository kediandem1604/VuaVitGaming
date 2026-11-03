import { dataDirFor, startEmbeddedPostgres } from './embedded-pg.js';

const PORT = 54329;

const pg = await startEmbeddedPostgres({
  dataDir: dataDirFor('pgdata-dev'),
  port: PORT,
  databases: ['ggd_dev', 'ggd_test'],
});

console.log(`PostgreSQL dev đang chạy: postgresql://ggd:ggd@localhost:${PORT}/ggd_dev (Ctrl+C để dừng)`);

let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  console.log('Đang dừng PostgreSQL dev…');
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
