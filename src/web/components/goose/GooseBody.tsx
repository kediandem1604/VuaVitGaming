/**
 * Dáng ngỗng dùng chung cho mọi nhân vật (spec §4.1), kiểu game: thân trắng hình quả
 * trứng thon phía trên, cánh nhỏ bên phải tô `wing`, mắt đen to có đốm sáng, mỏ và hai
 * bàn chân `beak`, mọi nét viền `ink` dày 3–4. Toạ độ trong khung `0 0 120 160` của
 * `Character`: đỉnh đầu y = 38 (chừa y < 36 cho bảng tên), mắt y ≈ 69, mỏ y 74–95,
 * ngực (chỗ đặt huy hiệu) quanh (60, 118), bàn chân chạm đất ở y = 152.
 *
 * `look` (chim phe thứ 3…, bảng `bodyLook` trong `roleKits.ts`) đổi màu thân/cánh/mỏ/chân,
 * thêm tròng mắt sau con ngươi và đĩa mặt sau mắt. `look.evil` (phe Vịt) thay mắt tròn bằng mắt
 * quỷ: lòng vàng, tròng đỏ, con ngươi khe dọc, mí trên xếch vào giữa kèm lông mày cau, mỏ nhếch
 * cười để lộ hai nanh. `silhouette` (ô chưa ai hoá thân): thân
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

/** Mỏ nhếch một bên và hai nanh nhỏ thò dưới khoé (mắt quỷ). */
const SMIRK = 'M49 85 C55 89.5 63 89.5 71 83';
const FANGS = 'M53 86.5 L55 92 L57.2 87.6 Z M64.8 86.4 L66.6 91 L68.2 85.6 Z';

/** Phản chiếu sang bên phải thân (trục x = 60). */
const MIRROR = 'translate(120 0) scale(-1 1)';

/** Mắt quỷ bên trái, tâm (50, 69); mắt phải là bản phản chiếu. Mí tô màu thân che góc trong. */
function EvilEye({ lid }: { lid: string }) {
  return (
    <>
      <circle cx="50" cy="69" r="9.5" fill="#FF2B3A" opacity={0.3} />
      <circle cx="50" cy="69" r="7" fill="#FFE14D" stroke={PALETTE.ink} strokeWidth={2} />
      <circle cx="50.5" cy="69.5" r="4.6" fill="#E5262E" />
      <ellipse cx="50.5" cy="69.5" rx="1.4" ry="4" fill={PALETTE.ink} />
      <circle cx="48" cy="66.8" r="1.3" fill={PALETTE.white} />
      <path d="M39 56 L61 56 L61 71 L39 61.5 Z" fill={lid} />
      <path d="M40 61 L59.5 68.6" stroke={PALETTE.ink} strokeWidth={3.6} strokeLinecap="round" />
    </>
  );
}

/** Mắt tròn mặc định, có tròng màu khi `ring`. */
function RoundEyes({ ring }: { ring?: string }) {
  return (
    <>
      {ring && (
        <>
          <circle cx="50" cy="69" r="8.5" fill={ring} stroke={PALETTE.ink} strokeWidth={2} />
          <circle cx="70" cy="69" r="8.5" fill={ring} stroke={PALETTE.ink} strokeWidth={2} />
        </>
      )}
      <circle cx="50" cy="69" r={ring ? 5 : 6.5} fill={PALETTE.ink} />
      <circle cx="70" cy="69" r={ring ? 5 : 6.5} fill={PALETTE.ink} />
      <circle cx="52" cy="67" r="2" fill={PALETTE.white} />
      <circle cx="72" cy="67" r="2" fill={PALETTE.white} />
    </>
  );
}

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
          <g className="goose-eyes" data-eyes={look?.evil ? 'evil' : undefined}>
            {look?.evil ? (
              <>
                <EvilEye lid={body} />
                <g transform={MIRROR}>
                  <EvilEye lid={body} />
                </g>
              </>
            ) : (
              <RoundEyes ring={look?.eyeRing} />
            )}
          </g>
          <path d={BEAK} fill={look?.beak ?? PALETTE.beak} stroke={PALETTE.ink} strokeWidth={3} strokeLinejoin="round" />
          {look?.evil && (
            <>
              <path d={FANGS} fill={PALETTE.white} stroke={PALETTE.ink} strokeWidth={1.4} strokeLinejoin="round" />
              <path d={SMIRK} fill="none" stroke={PALETTE.ink} strokeWidth={2.4} strokeLinecap="round" />
            </>
          )}
        </>
      )}
    </g>
  );
}
