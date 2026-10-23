/**
 * Nhóm năm con ngỗng đứng chụp ảnh chung ở trang đăng nhập (spec §4.4): cùng dáng
 * `GooseBody`, mỗi con mặc một bộ đồ `KitArt` — ninja, thám tử, vua (giữa, to hơn, đứng
 * trước), phù thuỷ, kẻ cầm dao. Hai con bên trái lật gương để đồ cầm tay (kính lúp, đuôi
 * khăn) hướng ra ngoài thay vì bị con đứng giữa che. Hàng sau đứng cao hơn một chút cho
 * có chiều sâu; thứ tự vẽ là thứ tự chồng: hai con ngoài cùng nằm sau, vua nằm trên cùng.
 *
 * Bộ đồ không có role thật (`KitArt` chỉ cần `KitRole`), nên mỗi con mang một role mẫu
 * lấy từ seed đúng với kit — chỉ `bird` và `badge` đọc tới `role`, nhưng giữ key thật để
 * sau này đổi kit vẫn đúng.
 *
 * Chỉ để trang trí: cả khối `aria-hidden`. Hoạt ảnh nằm trong styles.css (tự tắt khi máy
 * bật giảm chuyển động): cả nhóm nhún lệch nhịp (`goose-idle`, `--goose-delay`), rê chuột
 * hoặc chạm vào một con thì con đó nhảy lên một cái (`data-hopping`, bỏ khi hết hoạt ảnh
 * để nhảy tiếp được).
 */

import { useState, type CSSProperties } from 'react';
import { cx } from '../lib/cx';
import { PALETTE } from '../lib/palette';
import type { Kit, KitRole } from '../lib/roleKits';
import { GooseBody } from './goose/GooseBody';
import { KitArt } from './goose/kits';

interface Member {
  kit: Kit;
  role: KitRole;
  /** Tâm thân (x) trong khung nhóm. */
  cx: number;
  /** Mặt đất (y) của con này; hàng sau cao hơn hàng trước. */
  ground: number;
  scale: number;
  /** Lật gương để đồ cầm ở cánh hướng ra mép ngoài. */
  mirror?: boolean;
  /** Lệch nhịp nhún/chớp mắt để cả nhóm không nhún cùng lúc. */
  delay: string;
}

/** Thứ tự vẽ = thứ tự chồng: hai con ngoài cùng (hàng sau) trước, vua ở giữa (hàng trước) sau cùng. */
const MEMBERS: readonly Member[] = [
  { kit: 'ninja', role: { key: 'ninja', icon: '🥷', faction: 'duck' }, cx: 64, ground: 136, scale: 0.92, mirror: true, delay: '-0.4s' },
  { kit: 'knife', role: { key: 'hitman', icon: '🎯', faction: 'duck' }, cx: 358, ground: 136, scale: 0.92, delay: '-1.9s' },
  { kit: 'detective', role: { key: 'detective', icon: '🔍', faction: 'goose' }, cx: 133, ground: 142, scale: 1, mirror: true, delay: '-1.1s' },
  { kit: 'wizard', role: { key: 'warlock', icon: '🦗', faction: 'duck' }, cx: 289, ground: 142, scale: 1, delay: '-2.6s' },
  { kit: 'crown', role: { key: 'politician', icon: '🎩', faction: 'goose' }, cx: 211, ground: 150, scale: 1.15, delay: '0s' },
];

/** Trong khung 120 × 160 của `GooseBody`: tâm thân x = 60, bàn chân chạm đất y = 152. */
const BODY_CENTRE_X = 60;
const FEET_Y = 152;

export function LobbySquad({ className }: { className?: string }) {
  return (
    // Khung cắt bớt khoảng trống phía trên (chỗ bảng tên không dùng); `overflow-visible` để con nhảy lên không bị cắt.
    <svg viewBox="0 12 424 150" aria-hidden="true" className={cx('overflow-visible', className)}>
      {MEMBERS.map((member) => (
        <SquadMember key={member.kit} member={member} />
      ))}
    </svg>
  );
}

function SquadMember({ member }: { member: Member }) {
  const [hopping, setHopping] = useState(false);
  const hop = () => setHopping(true);
  const { kit, role, scale, mirror = false } = member;
  const direction = mirror ? -1 : 1;
  const tx = member.cx - direction * BODY_CENTRE_X * scale;
  const ty = member.ground - FEET_Y * scale;
  const style = { '--goose-delay': member.delay } as CSSProperties;

  // Vị trí và tỉ lệ đặt ở nhóm ngoài: transform của CSS (hoạt ảnh nhảy, nhún) sẽ đè thuộc
  // tính transform của SVG trên cùng một phần tử.
  return (
    <g transform={`translate(${tx} ${ty}) scale(${direction * scale} ${scale})`}>
      {/* Bóng dưới chân đứng yên khi con ngỗng nhảy. */}
      <ellipse cx={BODY_CENTRE_X} cy={FEET_Y + 3} rx={40} ry={5} fill={PALETTE['night-950']} opacity={0.55} />
      <g
        className="goose"
        data-member={kit}
        data-hopping={hopping ? '' : undefined}
        style={style}
        onPointerEnter={hop}
        onPointerDown={hop}
        onAnimationEnd={() => setHopping(false)}
      >
        <g className="goose-idle">
          <KitArt kit={kit} role={role} layer="back" />
          <GooseBody />
          <KitArt kit={kit} role={role} layer="front" />
        </g>
      </g>
    </g>
  );
}
