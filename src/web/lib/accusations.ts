/**
 * Chữ hiển thị của báo cáo người chơi (spec điểm role §5–6), dùng chung cho trang Khai điểm
 * ("Lần khai của tôi") và tab Duyệt điểm: dòng tóm tắt một báo cáo, dòng giá trị của mục trừ
 * điểm, trạng thái báo cáo cho người báo cáo, và ghi chú báo cáo trùng.
 */

import type { AccusationDto, AccusationStatus } from '../../shared/api-types';
import { FACTION_NAME, FACTION_SHORT_LABEL } from './factions';

/** Ghi chú nhỏ dưới lần khai của người báo cáo khi báo cáo bị ẩn vì trùng vụ với báo cáo sớm hơn (`accusationDuplicate`). */
export const DUPLICATE_NOTE = 'Báo cáo của bạn trùng với một báo cáo khác đang chờ';

/** Chip trên mục trừ điểm (`source = 'accusation'`) ở "Lần khai của tôi" và "Đã duyệt gần đây". */
export const PENALISED_CHIP = 'Bị trừ điểm';

/** Khung báo cáo (hàng chờ duyệt và lần khai của tôi): "Báo cáo: {người} ({role}) bắn {người bị bắn} — phe {phe}". */
export function formatAccusationLine(a: AccusationDto): string {
  return `Báo cáo: ${a.accused.displayName} (${a.accusedRole.nameVi}) bắn ${a.victim.displayName} — phe ${FACTION_NAME[a.victimFaction]}`;
}

/**
 * Dòng giá trị của mục trừ điểm thay cho "x − z": "Bị báo cáo: bắn {người bị bắn} ({phe}) − {điểm} điểm".
 * `penaltyPoints` đọc từ role bị báo cáo (không tắt được chỉ số phạt khi còn báo cáo trỏ tới, nên có giá trị).
 */
export function formatPenaltyLine(a: AccusationDto): string {
  return `Bị báo cáo: bắn ${a.victim.displayName} (${FACTION_SHORT_LABEL[a.victimFaction]}) − ${a.accusedRole.penaltyPoints ?? 0} điểm`;
}

/**
 * Trạng thái báo cáo dưới một lần khai: người báo cáo xem lần khai của mình (`reporter`, "bạn +1
 * điểm") hay mod xem ở "Đã duyệt gần đây" (`mod`, "người báo cáo +1 điểm"); bị bác thì kèm lý do,
 * bị thay thế thì "Đã có người báo cáo trước" (lý do server đặt).
 */
export function accusationStatusText(a: Pick<AccusationDto, 'status' | 'rejectReason'>, viewer: 'reporter' | 'mod' = 'reporter'): string {
  const texts: Record<AccusationStatus, string> = {
    pending: 'Báo cáo đang chờ duyệt',
    approved: viewer === 'reporter' ? 'Báo cáo đúng · bạn +1 điểm' : 'Báo cáo đúng · người báo cáo +1 điểm',
    rejected: a.rejectReason ? `Báo cáo bị bác: ${a.rejectReason}` : 'Báo cáo bị bác',
    superseded: a.rejectReason ?? 'Đã có người báo cáo trước',
    revoked: a.rejectReason ? `Đã bị huỷ: ${a.rejectReason}` : 'Đã bị huỷ',
  };
  return texts[a.status];
}
