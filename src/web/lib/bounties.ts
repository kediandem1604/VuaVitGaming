/**
 * Chữ dùng chung của treo thưởng (spec treo thưởng §5, §6, §8): icon mục, nhãn phạm vi, chip
 * trạng thái lần nhận. Thẻ Hôm nay, tab Treo thưởng, Duyệt điểm và "Treo thưởng của tôi" cùng đọc
 * từ đây để chữ khớp nhau.
 */

import type { BountyClaimDto, BountyClaimStatus, BountyDto } from '../../shared/api-types';
import { formatDateLabel, formatTime } from './format';

/** Icon của mục không gắn role. */
export const NO_ROLE_ICON = '🎯';

/** Icon role của mục (hoặc 🎯 khi "Mọi role"). */
export function bountyIcon(role: BountyDto['role']): string {
  return role?.icon ?? NO_ROLE_ICON;
}

/** "{giờ} {ngày} — {chế độ}" của một buổi (giờ và ngày VN). */
export function sessionText(session: { startsAt: string; modeName: string }): string {
  return `${formatTime(session.startsAt)} ${formatDateLabel(new Date(session.startsAt))} — ${session.modeName}`;
}

/** Phạm vi của mục: "Mọi buổi" hoặc "Buổi {giờ} {ngày} — {chế độ}". */
export function bountyScopeText(bounty: BountyDto): string {
  return bounty.session ? `Buổi ${sessionText(bounty.session)}` : 'Mọi buổi';
}

/** Chữ chip trạng thái của lần nhận: "Chờ duyệt" / "Đã nhận +{điểm}" / "Bị từ chối: {lý do}" / "Đã bị huỷ: {lý do}". */
export function claimStatusText(claim: Pick<BountyClaimDto, 'status' | 'points' | 'rejectReason'>): string {
  const reason = claim.rejectReason ? `: ${claim.rejectReason}` : '';
  switch (claim.status) {
    case 'pending':
      return 'Chờ duyệt';
    case 'approved':
      return `Đã nhận +${claim.points}`;
    case 'rejected':
      return `Bị từ chối${reason}`;
    case 'revoked':
      return `Đã bị huỷ${reason}`;
  }
}

/** Màu chip trạng thái (cùng bảng màu với lần khai điểm). */
export const CLAIM_CHIP_CLASS: Record<BountyClaimStatus, string> = {
  pending: 'bg-gold text-gold-ink',
  approved: 'bg-ok text-night-950',
  rejected: 'bg-duck-soft text-night-950',
  revoked: 'bg-duck-soft text-night-950',
};

/** Nhãn nguồn của lần nhận (hàng chờ duyệt). */
export const CLAIM_SOURCE_LABEL: Record<BountyClaimDto['source'], string> = { web: 'Web', discord: 'Discord' };
