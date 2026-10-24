/**
 * Bộ đồ mặc định (spec §4.2): huy hiệu tròn trắng trên ngực, viền màu phe 2.5, emoji
 * `role.icon` ở giữa. Dành cho role không có bộ đồ riêng và mọi role admin thêm sau.
 */

import { PALETTE } from '../../../lib/palette';
import { FACTION_COLOUR, type KitRole } from '../../../lib/roleKits';

export function Badge({ role }: { role: KitRole }) {
  return (
    <>
      <circle cx="60" cy="118" r="12" fill={PALETTE.white} stroke={FACTION_COLOUR[role.faction]} strokeWidth={2.5} />
      <text x="60" y="118.5" textAnchor="middle" dominantBaseline="central" fontSize="13">
        {role.icon}
      </text>
    </>
  );
}
