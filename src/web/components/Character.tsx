/**
 * Nhân vật hoá thân (spec §4.8). Trong game ai cũng cùng một dáng, nên đây là một
 * dáng ngỗng SVG vẽ tay dùng chung cho mọi role: thân tròn tô màu phe, bụng trắng,
 * cổ dài, mỏ và chân cam, huy hiệu role trên ngực; bảng tên người giữ nổi trên đầu
 * như trong game — chữ trắng đậm viền tối, tự co theo độ dài (`nameplate.ts`).
 *
 * Ba biến thể: `current` (đủ màu), `previous` (thân mờ 0.45 + nhãn "Mùa trước"),
 * `empty` (thân xám, bảng tên "Chưa ai hoá thân"). Role có ảnh tuỳ chỉnh thì một
 * `<img loading="lazy">` nằm đúng chỗ phần thân vẽ, SVG phía trên chỉ còn bảng tên
 * — ảnh của mỗi role được tải trễ vì endpoint ảnh có bucket giới hạn tốc độ riêng.
 *
 * Toàn khối là một `role="img"` có `aria-label` "{role}: {tên}" nên trong lưới Đại
 * sảnh mỗi ô đọc được bằng một câu.
 */

import type { Faction, RoleDto } from '../../shared/api-types';
import { cx } from '../lib/cx';
import { nameplateFontSize, truncateName } from '../lib/nameplate';

export type CharacterVariant = 'current' | 'previous' | 'empty';

interface CharacterProps {
  role: RoleDto;
  /** Tên hiện trên bảng tên; bỏ qua khi `variant = 'empty'`. */
  holderName: string | null;
  variant: CharacterVariant;
  /** Bề rộng tối đa (px). Nhân vật co theo ô chứa, luôn giữ tỉ lệ 3:4. */
  size?: number;
  className?: string;
}

/** Màu phe (Global Constraints) — cùng giá trị với `--goose/--duck/--neutral` trong styles.css. */
const FACTION_COLOUR: Record<Faction, string> = { goose: '#2F80ED', duck: '#E5484D', neutral: '#8E4EC6' };
const EMPTY_COLOUR = '#9CA3AF';
const ORANGE = '#F59E0B';
const INK = '#0B1020';
const EMPTY_TEXT = 'Chưa ai hoá thân';
const PREVIOUS_TEXT = 'Mùa trước';
const DIMMED_OPACITY = 0.45;

/** Bề rộng tối đa của bảng tên trong viewBox 120; chữ ước lượng rộng hơn thì ép khít (lengthAdjust). */
const PLATE_MAX_WIDTH = 112;
const GLYPH_WIDTH_EM = 0.6;

export function Character({ role, holderName, variant, size = 120, className }: CharacterProps) {
  const empty = variant === 'empty' || holderName === null;
  const colour = empty ? EMPTY_COLOUR : FACTION_COLOUR[role.faction];
  const dimmed = variant === 'previous';
  const text = empty ? EMPTY_TEXT : truncateName(holderName);
  const label = `${role.nameVi}: ${empty ? EMPTY_TEXT : holderName}${dimmed && !empty ? ' (mùa trước)' : ''}`;

  return (
    // Không tự căn giữa (mx-auto): trong hàng flex, lề tự động sẽ nuốt hết chỗ trống và đẩy
    // phần tử bên cạnh ra mép; nơi cần căn giữa (ô Đại sảnh) dùng items-center của ô chứa.
    <div role="img" aria-label={label} className={cx('relative aspect-[3/4] w-full', className)} style={{ maxWidth: size }}>
      {role.hasImage && (
        <img
          src={`/api/roles/${role.id}/image`}
          alt=""
          loading="lazy"
          className="absolute inset-x-0 bottom-0 h-[74%] w-full object-contain object-bottom"
          style={dimmed ? { opacity: DIMMED_OPACITY } : undefined}
        />
      )}
      <svg viewBox="0 0 120 160" className="relative block h-full w-full overflow-visible" aria-hidden="true">
        {!role.hasImage && <Bird colour={colour} icon={role.icon} opacity={dimmed ? DIMMED_OPACITY : 1} />}
        <Nameplate text={text} muted={empty} />
        {dimmed && <PreviousTag />}
      </svg>
    </div>
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
      fill={muted ? '#CBD5E1' : '#fff'}
      stroke={INK}
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
      <rect x="34" y="27" width="52" height="12" rx="6" fill={INK} opacity="0.8" />
      <text x="60" y="33.4" textAnchor="middle" dominantBaseline="central" fontSize="8.5" fontWeight={600} fill="#fff">
        {PREVIOUS_TEXT}
      </text>
    </g>
  );
}

/** Dáng ngỗng đứng quay mặt sang phải: đầu (41–67), cổ, thân (81–139), chân (–152). */
function Bird({ colour, icon, opacity }: { colour: string; icon: string; opacity: number }) {
  return (
    <g opacity={opacity}>
      {/* Bóng dưới chân theo màu chữ hiện tại → hợp cả nền sáng và tối. */}
      <ellipse cx="60" cy="153" rx="28" ry="4" fill="currentColor" opacity="0.12" />

      {/* Chân và bàn chân cam. */}
      <path d="M52 136 L49 148 M68 136 L71 148" stroke={ORANGE} strokeWidth="3.5" strokeLinecap="round" />
      <ellipse cx="47" cy="149" rx="8.5" ry="3.2" fill={ORANGE} />
      <ellipse cx="73" cy="149" rx="8.5" ry="3.2" fill={ORANGE} />

      {/* Cổ nối đầu với thân (cùng màu nên liền khối). */}
      <rect x="53" y="52" width="14" height="42" rx="7" fill={colour} />

      {/* Thân và hai cánh. */}
      <ellipse cx="60" cy="110" rx="32" ry="29" fill={colour} />
      <ellipse cx="33" cy="112" rx="8" ry="17" fill={INK} opacity="0.15" />
      <ellipse cx="87" cy="112" rx="8" ry="17" fill={INK} opacity="0.15" />

      {/* Bụng trắng. */}
      <ellipse cx="60" cy="117" rx="20" ry="17" fill="#fff" />

      {/* Đầu, điểm sáng, mỏ, mắt. */}
      <circle cx="60" cy="54" r="12.5" fill={colour} />
      <circle cx="55" cy="48.5" r="4" fill="#fff" opacity="0.25" />
      <path d="M71 51 L87 55.5 L71 60 Z" fill={ORANGE} />
      <circle cx="66" cy="50.5" r="2.4" fill={INK} />
      <circle cx="66.9" cy="49.7" r="0.8" fill="#fff" />

      {/* Huy hiệu role trên ngực. */}
      <circle cx="60" cy="116" r="12" fill="#fff" stroke={colour} strokeWidth="2.5" />
      <text x="60" y="116.5" textAnchor="middle" dominantBaseline="central" fontSize="13">
        {icon}
      </text>
    </g>
  );
}
