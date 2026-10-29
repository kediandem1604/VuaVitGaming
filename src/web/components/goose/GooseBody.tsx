/**
 * Dáng ngỗng dùng chung cho mọi nhân vật (spec §4.1), theo dáng trong game: đầu tròn to,
 * cổ dài trượt thẳng xuống không thắt eo rồi nở dần thành thân tròn phía dưới, cánh nhỏ bên phải tô
 * `wing`, mắt trắng to con ngươi đen, mỏ và hai bàn chân `beak`, mọi nét viền `ink` dày 3–4.
 * Toạ độ trong khung `0 0 120 160` của `Character`: đỉnh đầu y = 35 (chừa y < 29 cho bảng
 * tên), đầu và cổ rộng x 31–89 từ y ≈ 63 xuống y ≈ 100, mắt (50|70, 69), mỏ y 74–95, thân nở
 * dần tới rộng nhất x 21–99 ở y ≈ 133, đáy y = 148, ngực (chỗ đặt huy hiệu) quanh (60, 122),
 * bàn chân chạm đất ở y = 152.
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

/** Đầu tròn đỉnh (60, 35); cổ dài thẳng xuống cùng bề ngang với đầu (x 31–89) rồi nở dần thành thân rộng nhất ở y ≈ 133, đáy y = 148. */
const BODY =
  'M60 35 C77 35 89 47 89 63 C89 80 89 96 91 108 C95 118 99 124 99 133 ' +
  'C99 143 83 148 60 148 C37 148 21 143 21 133 C21 124 25 118 29 108 C31 96 31 80 31 63 ' +
  'C31 47 43 35 60 35 Z';

/** Cánh xếp bên phải thân, mút cánh ở khoảng (95, 132) — gần chỗ cầm đồ (94, 125). */
const WING = 'M86 108 C99 112 105 126 96 134 C90 127 86 118 86 108 Z';

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

/** Mắt kiểu game: lòng trắng bầu dục to, con ngươi đen lệch nhẹ vào giữa; `ring` thay lòng trắng bằng tròng màu. */
function RoundEyes({ ring }: { ring?: string }) {
  return (
    <>
      <ellipse cx="50" cy="68.5" rx="8.5" ry="9" fill={ring ?? PALETTE.white} stroke={PALETTE.ink} strokeWidth={2.2} />
      <ellipse cx="70" cy="68.5" rx="8.5" ry="9" fill={ring ?? PALETTE.white} stroke={PALETTE.ink} strokeWidth={2.2} />
      <circle cx="52" cy="70" r={ring ? 4.6 : 4.4} fill={PALETTE.ink} />
      <circle cx="68" cy="70" r={ring ? 4.6 : 4.4} fill={PALETTE.ink} />
      <circle cx="50.6" cy="68.4" r="1.5" fill={PALETTE.white} />
      <circle cx="66.6" cy="68.4" r="1.5" fill={PALETTE.white} />
    </>
  );
}

/** Bóng khối mờ phía trái bụng: thân đỡ phẳng mà không cần gradient (rẻ khi vẽ cả lưới). */
const SHADE = 'M32 112 C25 121 26 136 44 143 C34 134 31 122 35 112 Z';

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
          {look?.face && <ellipse cx="60" cy="70" rx="26" ry="18" fill={look.face} stroke={PALETTE.ink} strokeWidth={2.5} />}
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
