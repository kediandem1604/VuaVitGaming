/**
 * Bộ đồ vẽ chồng lên `GooseBody` (spec §4.2). Mỗi bộ có thể có hai lớp: `back` vẽ sau
 * thân (ba lô, áo choàng, đôi cánh) và `front` vẽ trước thân (mũ, vật cầm tay, huy
 * hiệu). Lớp `front` của mọi bộ nằm trong `<g data-kit={kit}>`, lớp `back` (chỉ bộ nào
 * cần mới có) trong `<g data-kit-back={kit}>` để test và CSS bám vào.
 *
 * `role` chỉ cần `key`, `icon`, `faction` (`KitRole`): nhóm ngỗng trang đăng nhập vẽ bộ
 * đồ mà không có role thật. Chỉ `bird` (màu mào) và `badge` (emoji, màu phe) đọc `role`.
 */

import type { ComponentType } from 'react';
import type { Kit, KitRole } from '../../../lib/roleKits';
import { Badge } from './Badge';
import { Bird } from './Bird';
import { Bomb } from './Bomb';
import { Clown } from './Clown';
import { Crown } from './Crown';
import { Detective } from './Detective';
import { Engineer } from './Engineer';
import { Explorer, ExplorerPack } from './Explorer';
import { Halo } from './Halo';
import { Heart, HeartWings } from './Heart';
import { Knife } from './Knife';
import { Ninja } from './Ninja';
import { Police } from './Police';
import { Pouch } from './Pouch';
import { Sniper } from './Sniper';
import { Sword } from './Sword';
import { Vampire, VampireCape } from './Vampire';
import { Wizard } from './Wizard';

export type { KitRole };

type KitPart = ComponentType<{ role: KitRole }>;

/** Lớp trước thân của từng bộ. */
const FRONT: Record<Kit, KitPart> = {
  knife: Knife,
  sword: Sword,
  detective: Detective,
  police: Police,
  ninja: Ninja,
  wizard: Wizard,
  engineer: Engineer,
  bomb: Bomb,
  crown: Crown,
  heart: Heart,
  clown: Clown,
  halo: Halo,
  explorer: Explorer,
  sniper: Sniper,
  bird: Bird,
  pouch: Pouch,
  vampire: Vampire,
  badge: Badge,
};

/** Lớp sau thân — chỉ bộ nào có phần vẽ sau lưng mới khai báo. */
const BACK: Partial<Record<Kit, KitPart>> = {
  heart: HeartWings,
  explorer: ExplorerPack,
  vampire: VampireCape,
};

export function KitArt({ kit, role, layer }: { kit: Kit; role: KitRole; layer: 'back' | 'front' }) {
  if (layer === 'back') {
    const Back = BACK[kit];
    return Back ? (
      <g data-kit-back={kit}>
        <Back role={role} />
      </g>
    ) : null;
  }
  const Front = FRONT[kit];
  return (
    <g data-kit={kit}>
      <Front role={role} />
    </g>
  );
}
