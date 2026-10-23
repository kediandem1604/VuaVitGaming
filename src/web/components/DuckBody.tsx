/**
 * Dáng vịt hoạt hình nhìn thẳng, dùng chung cho cả nhóm vịt ở trang đăng nhập: thân
 * dài liền cổ, mắt to, mỏ cam, nét viền đậm. Toạ độ trong khung 100 × 172 (mặt đất
 * ở y = 172); phụ kiện của từng con đặt vào `behind` (sau thân: áo choàng, dao) hoặc
 * `front` (trước mặt: mũ, cánh khoanh, tách trà).
 *
 * Các class `duck-*` là móc cho hoạt ảnh trong styles.css (chớp mắt, liếc).
 */

import { useId, type ReactNode } from 'react';

export const INK = '#0B1020';
export const ORANGE = '#F59E0B';
export const STROKE = 3;

/** `open` mở to, `half` mí sụp (lém lỉnh), `stern` mí xếch vào trong (dữ). */
export type Lids = 'open' | 'half' | 'stern';

interface DuckBodyProps {
  colour: string;
  lids: Lids;
  /** Con ngươi đảo qua lại (nghi ngờ). */
  glance?: boolean;
  behind?: ReactNode;
  /** Vẽ ngay trên thân, dưới mắt và mỏ (mũ trùm, miếng vá ngực). */
  over?: ReactNode;
  front?: ReactNode;
}

const BODY =
  'M50 14 C68 14 76 28 76 46 L76 82 C76 94 86 106 86 126 C86 146 70 158 50 158 ' +
  'C30 158 14 146 14 126 C14 106 24 94 24 82 L24 46 C24 28 32 14 50 14 Z';

/** Mảng tối bên phải thân cho có khối. */
const BODY_SHADE =
  'M76 46 L76 82 C76 94 86 106 86 126 C86 146 70 158 50 158 ' +
  'C64 152 74 140 74 124 C74 108 66 96 66 82 L66 46 C66 32 62 22 56 15 C68 17 76 30 76 46 Z';

export function DuckBody({ colour, lids, glance = false, behind, over, front }: DuckBodyProps) {
  return (
    <>
      {behind}
      <Legs />
      {/* Hai cánh vẽ trước thân để chỉ lộ nửa ngoài. */}
      <ellipse cx="17" cy="122" rx="9" ry="20" fill={colour} stroke={INK} strokeWidth={STROKE} />
      <ellipse cx="83" cy="122" rx="9" ry="20" fill={colour} stroke={INK} strokeWidth={STROKE} />
      <path d={BODY} fill={colour} stroke={INK} strokeWidth={STROKE} strokeLinejoin="round" />
      <path d={BODY_SHADE} fill={INK} opacity={0.12} />
      {over}
      <g className={glance ? 'duck-eyes duck-glance' : 'duck-eyes'}>
        <Eye cx={38} side="left" colour={colour} lids={lids} />
        <Eye cx={62} side="right" colour={colour} lids={lids} />
      </g>
      <Beak />
      {front}
    </>
  );
}

const EYE_Y = 44;
const EYE_R = 11;

function Eye({ cx, side, colour, lids }: { cx: number; side: 'left' | 'right'; colour: string; lids: Lids }) {
  // useId của React có ký tự không hợp lệ trong url(#…); chỉ giữ chữ, số, -, _.
  const clipId = `duck-eye-${useId().replace(/[^\w-]/g, '')}`;
  const lid = lidShape(cx, side, lids);
  return (
    <g>
      <clipPath id={clipId}>
        <circle cx={cx} cy={EYE_Y} r={EYE_R} />
      </clipPath>
      <circle cx={cx} cy={EYE_Y} r={EYE_R} fill="#fff" />
      <circle className="duck-pupil" cx={cx + 1.5} cy={EYE_Y + 2.5} r={3.6} fill={INK} />
      {lid && <path d={lid.fill} fill={colour} clipPath={`url(#${clipId})`} />}
      <circle cx={cx} cy={EYE_Y} r={EYE_R} fill="none" stroke={INK} strokeWidth={2.5} />
      {lid && <path d={lid.edge} fill="none" stroke={INK} strokeWidth={lids === 'stern' ? 3.5 : 2.5} strokeLinecap="round" />}
    </g>
  );
}

/** Mí mắt: phần tô (bị cắt theo tròng) và nét viền mép mí. Mắt `stern` xếch xuống phía mỏ. */
function lidShape(cx: number, side: 'left' | 'right', lids: Lids): { fill: string; edge: string } | null {
  const left = cx - EYE_R;
  const right = cx + EYE_R;
  const top = EYE_Y - EYE_R - 2;
  if (lids === 'half') {
    const y = EYE_Y - 1;
    return { fill: `M${left - 2} ${top} H${right + 2} V${y} H${left - 2} Z`, edge: `M${left} ${y} H${right}` };
  }
  if (lids === 'stern') {
    // Góc ngoài cao, góc trong (phía mỏ) thấp.
    const [yLeft, yRight] = side === 'left' ? [EYE_Y - 8, EYE_Y - 1] : [EYE_Y - 1, EYE_Y - 8];
    return {
      fill: `M${left - 2} ${top} H${right + 2} V${yRight} L${left - 2} ${yLeft} Z`,
      edge: `M${left - 2} ${yLeft - 1} L${right + 2} ${yRight - 1}`,
    };
  }
  return null;
}

function Beak() {
  return (
    <g>
      <path
        d="M33 58 C33 50 67 50 67 58 C67 68 58 76 50 76 C42 76 33 68 33 58 Z"
        fill={ORANGE}
        stroke={INK}
        strokeWidth={2.5}
        strokeLinejoin="round"
      />
      <ellipse cx="42" cy="56" rx="5" ry="2" fill="#fff" opacity={0.35} />
      <circle cx="45" cy="57" r="1.1" fill={INK} opacity={0.5} />
      <circle cx="55" cy="57" r="1.1" fill={INK} opacity={0.5} />
      <path d="M37 63 Q50 68 63 63" fill="none" stroke={INK} strokeWidth={1.6} strokeLinecap="round" opacity={0.55} />
    </g>
  );
}

function Legs() {
  const legs = 'M40 150 L38 167 M60 150 L62 167';
  return (
    <g>
      <path d={legs} stroke={INK} strokeWidth={7} strokeLinecap="round" />
      <path d={legs} stroke={ORANGE} strokeWidth={3.5} strokeLinecap="round" />
      <ellipse cx="34" cy="169" rx="9" ry="3.5" fill={ORANGE} stroke={INK} strokeWidth={2.5} />
      <ellipse cx="66" cy="169" rx="9" ry="3.5" fill={ORANGE} stroke={INK} strokeWidth={2.5} />
    </g>
  );
}
