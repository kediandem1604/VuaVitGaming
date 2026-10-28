/**
 * Dáng ngỗng dùng chung cho mọi nhân vật (spec §4.1), kiểu game: thân trắng hình quả
 * trứng thon phía trên, cánh nhỏ bên phải tô `wing`, mắt đen to có đốm sáng, mỏ và hai
 * bàn chân `beak`, mọi nét viền `ink` dày 3–4. Toạ độ trong khung `0 0 120 160` của
 * `Character`: đỉnh đầu y = 38 (chừa y < 36 cho bảng tên), mắt y ≈ 69, mỏ y 74–95,
 * ngực (chỗ đặt huy hiệu) quanh (60, 118), bàn chân chạm đất ở y = 152.
 *
 * `look` (chim phe thứ 3…, bảng `bodyLook` trong `roleKits.ts`) đổi màu thân/cánh/mỏ/chân,
 * thêm tròng mắt sau con ngươi và đĩa mặt sau mắt. `silhouette` (ô chưa ai hoá thân): thân
 * và chân tô `night-600`, không mắt, không mỏ, không cánh. Nhóm mắt mang lớp `goose-eyes`
 * để chớp (keyframes trong styles.css).
 */

import { PALETTE } from '../../lib/palette';
import type { BodyLook } from '../../lib/roleKits';

/** Thân: đỉnh đầu (60, 38), eo ở y ≈ 74 rồi phình ra thành bụng rộng nhất ở y ≈ 118, đáy y = 148. */
const BODY =
  'M60 38 C79 38 86 56 86 74 C86 87 100 96 100 118 C100 139 82 148 60 148 ' +
  'C38 148 20 139 20 118 C20 96 34 87 34 74 C34 56 41 38 60 38 Z';

/** Cánh xếp bên phải, hơi nhô ra khỏi mép thân. */
const WING = 'M86 100 C100 107 103 125 91 132 C87 123 85 112 86 100 Z';

/** Mỏ bo tròn, mép trên chạm đáy mắt. */
const BEAK = 'M44 81 C44 74 76 74 76 81 C76 90 68 95 60 95 C52 95 44 90 44 81 Z';

/** Bóng khối mờ phía trái bụng: thân đỡ phẳng mà không cần gradient (rẻ khi vẽ cả lưới). */
const SHADE = 'M30 104 C24 116 26 134 44 143 C34 132 31 118 34 104 Z';

export function GooseBody({ silhouette = false, look }: { silhouette?: boolean; look?: BodyLook }) {
  const body = silhouette ? PALETTE['night-600'] : (look?.body ?? PALETTE.white);
  const foot = silhouette ? PALETTE['night-600'] : (look?.feet ?? look?.beak ?? PALETTE.beak);
  // Hình bóng theo token CSS (đổi màu cùng chủ đề Halloween); thuộc tính `fill` giữ hex làm dự phòng.
  const themed = silhouette ? { fill: 'var(--color-night-600)' } : undefined;
  return (
    <g>
      {/* Bàn chân vẽ trước để thân che phần trên — ngỗng game không có cẳng chân. */}
      <ellipse cx="47" cy="152" rx="11" ry="5" fill={foot} style={themed} stroke={PALETTE.ink} strokeWidth={3} />
      <ellipse cx="73" cy="152" rx="11" ry="5" fill={foot} style={themed} stroke={PALETTE.ink} strokeWidth={3} />
      {!silhouette && look?.rim && <path d={BODY} fill="none" stroke={look.rim} strokeWidth={9} strokeLinejoin="round" opacity={0.35} />}
      <path data-part="body" d={BODY} fill={body} style={themed} stroke={PALETTE.ink} strokeWidth={4} strokeLinejoin="round" />
      {!silhouette && (
        <>
          <path d={SHADE} fill={PALETTE.ink} opacity={0.08} />
          {look?.face && <ellipse cx="60" cy="72" rx="24" ry="17" fill={look.face} stroke={PALETTE.ink} strokeWidth={2.5} />}
          <path d={WING} fill={look?.wing ?? PALETTE.wing} stroke={PALETTE.ink} strokeWidth={3} strokeLinejoin="round" />
          <g className="goose-eyes">
            {look?.eyeRing && (
              <>
                <circle cx="50" cy="69" r="8.5" fill={look.eyeRing} stroke={PALETTE.ink} strokeWidth={2} />
                <circle cx="70" cy="69" r="8.5" fill={look.eyeRing} stroke={PALETTE.ink} strokeWidth={2} />
              </>
            )}
            <circle cx="50" cy="69" r={look?.eyeRing ? 5 : 6.5} fill={PALETTE.ink} />
            <circle cx="70" cy="69" r={look?.eyeRing ? 5 : 6.5} fill={PALETTE.ink} />
            <circle cx="52" cy="67" r="2" fill={PALETTE.white} />
            <circle cx="72" cy="67" r="2" fill={PALETTE.white} />
          </g>
          <path d={BEAK} fill={look?.beak ?? PALETTE.beak} stroke={PALETTE.ink} strokeWidth={3} strokeLinejoin="round" />
        </>
      )}
    </g>
  );
}
