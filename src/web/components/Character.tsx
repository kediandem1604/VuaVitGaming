/**
 * Nhân vật hoá thân (spec §4). Trong game ai cũng cùng một dáng, nên đây là một dáng
 * ngỗng trắng vẽ tay dùng chung cho mọi role (`GooseBody`), mặc bộ đồ theo role
 * (`KitArt`, bảng `roleKits.ts`). Màu phe không tô lên thân mà hiện ở vòng sáng dưới
 * chân; bảng tên người giữ nổi trên đầu như trong game — chữ trắng đậm viền tối, tự co
 * theo độ dài (`nameplate.ts`).
 *
 * Thứ tự vẽ: vòng sáng phe → lớp sau của bộ đồ → thân → lớp trước của bộ đồ, tất cả
 * trong `<g data-part="figure">` (để `previous` làm mờ cả hình một lần); chỉ bộ đồ và thân
 * nằm trong nhóm con `<g data-part="pose">` nhún nhẹ (`goose-idle`) — vòng sáng đứng yên
 * dưới chân, không bay lên theo con ngỗng. Bảng tên và nhãn "Mùa trước" nằm ngoài để không
 * mờ theo hình.
 *
 * Ba biến thể: `current` (đủ màu), `previous` (hình mờ 0.45 + nhãn "Mùa trước"),
 * `empty` (hình bóng `night-600`, không vòng sáng, không bộ đồ, bảng tên "Chưa ai hoá
 * thân"). Role có ảnh tuỳ chỉnh thì một `<img loading="lazy">` nằm đúng chỗ phần thân
 * vẽ, xếp ba lớp: SVG vòng sáng ở dưới cùng → ảnh → SVG bảng tên ở trên cùng, nên màu phe
 * không tô lên chân ảnh. Ảnh của mỗi role được tải trễ vì endpoint ảnh có bucket giới hạn
 * tốc độ riêng.
 *
 * Toàn khối là một `role="img"` có `aria-label` "{role}: {tên}" nên trong lưới Đại
 * sảnh mỗi ô đọc được bằng một câu. `nameplate={false}` bỏ bảng tên và nhãn "Mùa trước",
 * nhãn đọc chỉ còn tên role — cho nhân vật thu nhỏ đứng cạnh chữ đã có.
 */

import type { CSSProperties } from 'react';
import type { RoleDto } from '../../shared/api-types';
import { cx } from '../lib/cx';
import { nameplateFontSize, truncateName } from '../lib/nameplate';
import { PALETTE } from '../lib/palette';
import { FACTION_COLOUR, kitForRole } from '../lib/roleKits';
import { GooseBody } from './goose/GooseBody';
import { KitArt } from './goose/kits';

export type CharacterVariant = 'current' | 'previous' | 'empty';

interface CharacterProps {
  role: RoleDto;
  /** Tên hiện trên bảng tên; bỏ qua khi `variant = 'empty'`. */
  holderName: string | null;
  variant: CharacterVariant;
  /** Bề rộng tối đa (px). Nhân vật co theo ô chứa, luôn giữ tỉ lệ 3:4. */
  size?: number;
  /**
   * `false` → chỉ vẽ hình: không bảng tên, không nhãn "Mùa trước", `aria-label` chỉ là
   * tên role — cho nhân vật thu nhỏ đứng cạnh tên role đã viết ra (gợi ý tìm role ở trang
   * Khai điểm). Mặc định `true`.
   */
  nameplate?: boolean;
  className?: string;
}

const EMPTY_TEXT = 'Chưa ai hoá thân';
const PREVIOUS_TEXT = 'Mùa trước';
const DIMMED_OPACITY = 0.45;

/** Bề rộng tối đa của bảng tên trong viewBox 120; chữ ước lượng rộng hơn thì ép khít (lengthAdjust). */
const PLATE_MAX_WIDTH = 112;
const GLYPH_WIDTH_EM = 0.6;

export function Character({ role, holderName, variant, size = 120, nameplate = true, className }: CharacterProps) {
  const empty = variant === 'empty' || holderName === null;
  const dimmed = variant === 'previous';
  const text = empty ? EMPTY_TEXT : truncateName(holderName);
  const label = nameplate
    ? `${role.nameVi}: ${empty ? EMPTY_TEXT : holderName}${dimmed && !empty ? ' (mùa trước)' : ''}`
    : role.nameVi;
  const drawn = !role.hasImage;
  const dressed = drawn && !empty;
  const kit = kitForRole(role.key);
  // Mỗi role lệch nhịp một chút để lưới Đại sảnh không nhún đều như máy; trễ âm nên không có lúc đứng chờ.
  const idleStyle = { '--goose-delay': `-${(role.id % 8) * 370}ms` } as CSSProperties;

  const figure = (
    <g data-part="figure" opacity={dimmed ? DIMMED_OPACITY : undefined}>
      {!empty && <Glow colour={FACTION_COLOUR[role.faction]} />}
      {drawn && (
        <g data-part="pose" className={dressed ? 'goose-idle' : undefined} style={dressed ? idleStyle : undefined}>
          {dressed && <KitArt kit={kit} role={role} layer="back" />}
          <GooseBody silhouette={empty} />
          {dressed && <KitArt kit={kit} role={role} layer="front" />}
        </g>
      )}
    </g>
  );

  return (
    // Không tự căn giữa (mx-auto): trong hàng flex, lề tự động sẽ nuốt hết chỗ trống và đẩy
    // phần tử bên cạnh ra mép; nơi cần căn giữa (ô Đại sảnh) dùng items-center của ô chứa.
    <div role="img" aria-label={label} className={cx('relative aspect-[3/4] w-full', className)} style={{ maxWidth: size }}>
      {role.hasImage && (
        <>
          {/* Lớp dưới cùng: vòng sáng phe, vẽ trước ảnh nên nằm dưới ảnh. */}
          <svg viewBox="0 0 120 160" className="absolute inset-0 block h-full w-full overflow-visible" aria-hidden="true">
            {figure}
          </svg>
          <img
            src={`/api/roles/${role.id}/image`}
            alt=""
            loading="lazy"
            className="absolute inset-x-0 bottom-0 h-[74%] w-full object-contain object-bottom"
            style={dimmed ? { opacity: DIMMED_OPACITY } : undefined}
          />
        </>
      )}
      <svg viewBox="0 0 120 160" className="relative block h-full w-full overflow-visible" aria-hidden="true">
        {drawn && figure}
        {nameplate && <Nameplate text={text} muted={empty} />}
        {nameplate && dimmed && <PreviousTag />}
      </svg>
    </div>
  );
}

/** Vòng sáng phe dưới chân: hai elip cùng màu chồng nhau, vòng ngoài mờ hơn, cho cảm giác toả sáng. */
function Glow({ colour }: { colour: string }) {
  return (
    <g data-part="glow" fill={colour}>
      <ellipse cx="60" cy="153" rx="40" ry="6.5" opacity="0.2" />
      <ellipse cx="60" cy="153" rx="30" ry="4.5" opacity="0.45" />
    </g>
  );
}

/** Bảng tên: chữ trắng đậm viền tối (`paint-order: stroke` để viền không ăn vào nét chữ). */
function Nameplate({ text, muted }: { text: string; muted: boolean }) {
  const fontSize = nameplateFontSize(text);
  const estimatedWidth = Array.from(text).length * fontSize * GLYPH_WIDTH_EM;
  const squeeze = estimatedWidth > PLATE_MAX_WIDTH;
  return (
    <text
      x="60"
      y="14"
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={fontSize}
      fontWeight={700}
      fill={muted ? PALETTE['night-300'] : '#fff'}
      stroke={PALETTE.ink}
      strokeWidth={4}
      strokeLinejoin="round"
      paintOrder="stroke"
      {...(squeeze ? { textLength: PLATE_MAX_WIDTH, lengthAdjust: 'spacingAndGlyphs' as const } : {})}
    >
      {text}
    </text>
  );
}

/** Nhãn "Mùa trước" dạng viên thuốc tối ngay dưới bảng tên. */
function PreviousTag() {
  return (
    <g>
      <rect x="34" y="27" width="52" height="12" rx="6" fill={PALETTE.ink} opacity="0.8" />
      <text x="60" y="33.4" textAnchor="middle" dominantBaseline="central" fontSize="8.5" fontWeight={600} fill="#fff">
        {PREVIOUS_TEXT}
      </text>
    </g>
  );
}
