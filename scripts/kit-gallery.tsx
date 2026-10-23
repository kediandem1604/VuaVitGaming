/**
 * In ra một trang HTML tĩnh để xem bằng mắt 18 bộ đồ của nhân vật (spec §4.2): mỗi bộ
 * một con ngỗng mẫu mặc bộ đó, kèm tên bộ và role mẫu, ở cỡ 120 (ô Đại sảnh) và 72 (trang
 * Hồ sơ); rồi 12 loài chim của bộ `bird` để so màu mào; cuối trang là cỡ 200 để soi nét
 * viền và vị trí. Không chạm database.
 *
 *   npx tsx --tsconfig tsconfig.web.json scripts/kit-gallery.tsx > kits.html
 *
 * Cần `--tsconfig tsconfig.web.json` để tsx biên dịch JSX của `src/web` theo `react-jsx`
 * (tsconfig.json gốc không khai báo `jsx`); tsx chỉ áp tsconfig đó cho file trong
 * `include` của nó, nên file này tự khai báo runtime JSX bằng pragma bên dưới. Trang chép
 * lại vài lớp Tailwind mà `Character` dùng để hình giữ đúng tỉ lệ khi không có stylesheet
 * của app.
 */

/** @jsxRuntime automatic @jsxImportSource react */
import { renderToStaticMarkup } from 'react-dom/server';
import { ROLES } from '../src/server/seed/roles.js';
import type { RoleDto } from '../src/shared/api-types.js';
import { Character } from '../src/web/components/Character.js';
import { PALETTE } from '../src/web/lib/palette.js';
import { kitForRole, KITS, type Kit } from '../src/web/lib/roleKits.js';

/** `RoleDto` từ seed, `id` là vị trí + 1, không có ảnh tuỳ chỉnh. */
function roleFromSeed(key: string): RoleDto {
  const index = ROLES.findIndex((r) => r.key === key);
  if (index === -1) throw new Error(`Seed không có role ${key}`);
  return { ...ROLES[index]!, id: index + 1, hasImage: false };
}

/** Role mẫu cho mỗi bộ: role đầu tiên trong seed mặc bộ đó. */
function sampleRole(kit: Kit): RoleDto {
  const seed = ROLES.find((r) => kitForRole(r.key) === kit);
  if (!seed) throw new Error(`Seed không có role nào mặc bộ ${kit}`);
  return roleFromSeed(seed.key);
}

const BIRDS = ROLES.filter((r) => kitForRole(r.key) === 'bird').map((r) => r.key);

function Card({ role, label, size }: { role: RoleDto; label: string; size: number }) {
  return (
    <figure className="card">
      <Character role={role} holderName="Ngỗng Một" variant="current" size={size} />
      <figcaption>
        <b>{label}</b>
        <span>{role.nameVi}</span>
      </figcaption>
    </figure>
  );
}

function Gallery() {
  return (
    <html lang="vi">
      <head>
        <meta charSet="utf-8" />
        <title>Bộ đồ nhân vật</title>
        <style>{CSS}</style>
      </head>
      <body>
        <h1>18 bộ đồ — cỡ 120 (Đại sảnh)</h1>
        <section className="grid">
          {KITS.map((kit) => (
            <Card key={kit} role={sampleRole(kit)} label={kit} size={120} />
          ))}
        </section>
        <h1>Cỡ 72 (Hồ sơ)</h1>
        <section className="grid small">
          {KITS.map((kit) => (
            <Card key={kit} role={sampleRole(kit)} label={kit} size={72} />
          ))}
        </section>
        <h1>Bộ `bird` — màu mào theo loài</h1>
        <section className="grid small">
          {BIRDS.map((key) => (
            <Card key={key} role={roleFromSeed(key)} label={key} size={72} />
          ))}
        </section>
        <h1>Cỡ 200 — soi nét viền và vị trí</h1>
        <section className="grid large">
          {KITS.map((kit) => (
            <Card key={kit} role={sampleRole(kit)} label={kit} size={200} />
          ))}
        </section>
      </body>
    </html>
  );
}

const CSS = `
  body { margin: 0; padding: 24px; background: ${PALETTE['night-900']}; color: ${PALETTE['night-200']};
         font-family: 'Baloo 2', system-ui, sans-serif; }
  h1 { font-size: 16px; margin: 16px 0 8px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(128px, 1fr)); gap: 10px; }
  .grid.small { grid-template-columns: repeat(auto-fill, minmax(88px, 1fr)); }
  .grid.large { grid-template-columns: repeat(auto-fill, minmax(216px, 1fr)); }
  .card { margin: 0; padding: 8px; border-radius: 14px; background: ${PALETTE['night-800']};
          display: flex; flex-direction: column; align-items: center; gap: 4px; }
  figcaption { display: flex; flex-direction: column; align-items: center; font-size: 13px; line-height: 1.3; }
  figcaption span { color: ${PALETTE['night-300']}; font-size: 12px; }
  .relative { position: relative; } .block { display: block; } .w-full { width: 100%; } .h-full { height: 100%; }
  .aspect-\\[3\\/4\\] { aspect-ratio: 3 / 4; } .overflow-visible { overflow: visible; }
`;

process.stdout.write('<!doctype html>\n' + renderToStaticMarkup(<Gallery />) + '\n');
