/**
 * Dáng ngỗng dùng chung cho mọi nhân vật (spec §4.1), kiểu game: thân trắng hình quả
 * trứng thon phía trên, cánh nhỏ bên phải tô `wing`, mắt đen to có đốm sáng, mỏ và hai
 * bàn chân `beak`, mọi nét viền `ink` dày 3–4. Toạ độ trong khung `0 0 120 160` của
 * `Character`: đỉnh đầu y = 38 (chừa y < 36 cho bảng tên), mắt y ≈ 69, mỏ y 74–95,
 * ngực (chỗ đặt huy hiệu) quanh (60, 118), bàn chân chạm đất ở y = 152.
 *
 * `silhouette` (ô chưa ai hoá thân): thân và chân tô `night-600`, không mắt, không mỏ,
 * không cánh. Nhóm mắt mang lớp `goose-eyes` để chớp (keyframes trong styles.css).
 */

import { PALETTE } from '../../lib/palette';

/** Thân: đỉnh đầu (60, 38), eo ở y ≈ 74 rồi phình ra thành bụng rộng nhất ở y ≈ 118, đáy y = 148. */
const BODY =
  'M60 38 C79 38 86 56 86 74 C86 87 100 96 100 118 C100 139 82 148 60 148 ' +
  'C38 148 20 139 20 118 C20 96 34 87 34 74 C34 56 41 38 60 38 Z';

/** Cánh xếp bên phải, hơi nhô ra khỏi mép thân. */
const WING = 'M86 100 C100 107 103 125 91 132 C87 123 85 112 86 100 Z';

/** Mỏ bo tròn, mép trên chạm đáy mắt. */
const BEAK = 'M44 81 C44 74 76 74 76 81 C76 90 68 95 60 95 C52 95 44 90 44 81 Z';

export function GooseBody({ silhouette = false }: { silhouette?: boolean }) {
  const body = silhouette ? PALETTE['night-600'] : PALETTE.white;
  const foot = silhouette ? PALETTE['night-600'] : PALETTE.beak;
  return (
    <g>
      {/* Bàn chân vẽ trước để thân che phần trên — ngỗng game không có cẳng chân. */}
      <ellipse cx="47" cy="152" rx="11" ry="5" fill={foot} stroke={PALETTE.ink} strokeWidth={3} />
      <ellipse cx="73" cy="152" rx="11" ry="5" fill={foot} stroke={PALETTE.ink} strokeWidth={3} />
      <path data-part="body" d={BODY} fill={body} stroke={PALETTE.ink} strokeWidth={4} strokeLinejoin="round" />
      {!silhouette && (
        <>
          <path d={WING} fill={PALETTE.wing} stroke={PALETTE.ink} strokeWidth={3} strokeLinejoin="round" />
          <g className="goose-eyes">
            <circle cx="50" cy="69" r="6.5" fill={PALETTE.ink} />
            <circle cx="70" cy="69" r="6.5" fill={PALETTE.ink} />
            <circle cx="52" cy="67" r="2" fill={PALETTE.white} />
            <circle cx="72" cy="67" r="2" fill={PALETTE.white} />
          </g>
          <path d={BEAK} fill={PALETTE.beak} stroke={PALETTE.ink} strokeWidth={3} strokeLinejoin="round" />
        </>
      )}
    </g>
  );
}
