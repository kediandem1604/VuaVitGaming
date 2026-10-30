/**
 * Thẻ role (spec §5.3) dùng ở Đại sảnh và Hồ sơ: panel có băng phe trên cùng (chữ trắng
 * viết hoa trên `goose-strong` / `duck-strong` / `third` — không đặt chữ trắng thẳng lên
 * `goose`/`duck`), rồi `Character`, dòng `{icon} {tên role}`, dòng điểm `{điểm} {chỉ số}`
 * (role có chỉ số phụ: `{điểm} điểm`, spec chỉ số phụ §7) màu vàng và `extra` (ghi chú bản
 * đồ, "mùa trước"…) ở cuối.
 *
 * Phông nền của phe (hồ đêm / trăng máu / tinh vân, styles.css `.role-card`) nằm sau nhân vật.
 *
 * Role trống (`variant = 'empty'`): viền nét đứt `night-600`, băng phe nhạt (chỉ nền mờ đi,
 * chữ vẫn trắng để giữ tương phản), phông mờ hơn và dòng "Khai điểm để giành".
 *
 * Không tự là link: ô Đại sảnh đã là link tới bảng xếp hạng của role, lồng link trong link
 * là sai HTML. Trang nào cần thì bọc ngoài (kèm lớp `lift`).
 */

import type { ReactNode } from 'react';
import type { Faction, RoleDto } from '../../shared/api-types';
import { seasonScoreUnit } from '../../shared/metric';
import { cx } from '../lib/cx';
import { FACTION_BAND, FACTION_LABEL } from '../lib/factions';
import { Character, type CharacterVariant } from './Character';

interface RoleCardProps {
  role: RoleDto;
  /** Tên người giữ trên bảng tên; `null` khi chưa ai giữ. */
  holderName: string | null;
  variant: CharacterVariant;
  /** Điểm của người giữ; `null` thì không có dòng điểm. */
  score: number | null;
  /** Nội dung thêm dưới dòng điểm (ghi chú bản đồ, "mùa trước"…). */
  extra?: ReactNode;
  /** Bề rộng tối đa của nhân vật (px), mặc định theo `Character`. */
  characterSize?: number;
  className?: string;
}

const CLAIM_TEXT = 'Khai điểm để giành';

/** Băng phe nhạt cho role trống: nền mờ 60% trên `night-800` ra màu tối hơn, chữ trắng vẫn ≥ 4.5:1. */
const BAND_EMPTY: Record<Faction, string> = {
  goose: 'bg-goose-strong/60',
  duck: 'bg-duck-strong/60',
  neutral: 'bg-third/60',
};

export function RoleCard({ role, holderName, variant, score, extra, characterSize, className }: RoleCardProps) {
  const empty = variant === 'empty';
  return (
    // `p-0 overflow-hidden` để băng phe chạm sát mép và bị cắt theo góc bo; `min-w-0` để tên dài
    // xuống dòng trong ô lưới thay vì kéo ô rộng ra.
    // `role-card` (styles.css): phông nền + đèn sân khấu màu phe sau nhân vật, viền sáng màu phe khi rê chuột.
    <div
      data-faction={role.faction}
      data-empty={empty || undefined}
      className={cx(
        'role-card panel flex min-w-0 flex-col items-center gap-1.5 overflow-hidden p-0 pb-3 text-center',
        empty && 'border-dashed border-night-600',
        className,
      )}
    >
      <p className={cx('w-full px-2 py-1 text-xs font-extrabold tracking-wide text-white', (empty ? BAND_EMPTY : FACTION_BAND)[role.faction])}>
        {FACTION_LABEL[role.faction].toLocaleUpperCase('vi')}
      </p>

      <Character role={role} holderName={holderName} variant={variant} size={characterSize} className="mt-1" />

      {/* Emoji role chỉ trang trí: nhân vật đã đọc "{role}: {tên}". */}
      <p className="w-full px-3 text-base leading-tight font-extrabold break-words text-white">
        <span aria-hidden="true">{role.icon}</span> {role.nameVi}
      </p>

      {score !== null && (
        <p className="px-3 leading-tight font-bold text-gold">
          <span className="text-lg tabular-nums">{score}</span> <span className="text-sm">{seasonScoreUnit(role)}</span>
        </p>
      )}

      {empty && <p className="px-3 text-sm text-night-300">{CLAIM_TEXT}</p>}

      {extra}
    </div>
  );
}
