/**
 * Nạp `.env` ở thư mục làm việc (dev) — phải là import ĐẦU TIÊN của main.ts vì
 * import ESM được nâng lên và db.ts đọc DATABASE_URL ngay lúc import. Biến đã có
 * trong môi trường được giữ nguyên; production không có file này thì bỏ qua.
 * Dùng hàm có sẵn của Node, không cần dotenv.
 */

import fs from 'node:fs';

if (fs.existsSync('.env')) process.loadEnvFile('.env');
