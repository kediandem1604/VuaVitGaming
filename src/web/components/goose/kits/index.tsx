/**
 * Bộ đồ vẽ chồng lên `GooseBody` (spec §4.2). Mỗi bộ có thể có hai lớp: `back` vẽ sau
 * thân (ba lô, áo choàng, đôi cánh) và `front` vẽ trước thân (mũ, vật cầm tay, huy
 * hiệu). Lớp `front` của mọi bộ nằm trong `<g data-kit={kit}>` để test và CSS bám vào;
 * lớp `back` chỉ bộ nào cần mới có.
 *
 * `role` chỉ cần `key`, `icon`, `faction` (`KitRole`): nhóm ngỗng trang đăng nhập vẽ bộ
 * đồ mà không có role thật. Tạm thời mọi bộ đều vẽ như `badge`; Task 4 thay từng dòng
 * trong `FRONT`/`BACK`.
 */

import type { ComponentType } from 'react';
import type { Kit, KitRole } from '../../../lib/roleKits';
import { Badge } from './Badge';

export type { KitRole };

type KitPart = ComponentType<{ role: KitRole }>;

/** Lớp trước thân của từng bộ. */
const FRONT: Record<Kit, KitPart> = {
  knife: Badge,
  sword: Badge,
  detective: Badge,
  police: Badge,
  ninja: Badge,
  wizard: Badge,
  engineer: Badge,
  bomb: Badge,
  crown: Badge,
  heart: Badge,
  clown: Badge,
  halo: Badge,
  explorer: Badge,
  sniper: Badge,
  bird: Badge,
  pouch: Badge,
  vampire: Badge,
  badge: Badge,
};

/** Lớp sau thân — chỉ bộ nào có phần vẽ sau lưng mới khai báo. */
const BACK: Partial<Record<Kit, KitPart>> = {};

export function KitArt({ kit, role, layer }: { kit: Kit; role: KitRole; layer: 'back' | 'front' }) {
  if (layer === 'back') {
    const Back = BACK[kit];
    return Back ? <Back role={role} /> : null;
  }
  const Front = FRONT[kit];
  return (
    <g data-kit={kit}>
      <Front role={role} />
    </g>
  );
}
