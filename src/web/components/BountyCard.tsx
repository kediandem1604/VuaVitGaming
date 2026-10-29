/**
 * Thẻ "Treo thưởng" của một buổi trên trang Hôm nay (spec treo thưởng §6), đặt cạnh thẻ buổi chơi.
 * Tiêu đề kèm "{giờ} · {chế độ}" để ngày có nhiều buổi vẫn rõ thẻ nào của buổi nào.
 *
 * Mỗi mục: icon role (🎯 khi "Mọi role"), tên, mô tả nhỏ, nhãn `+{điểm}` màu vàng. Bên dưới:
 * - đã nhận → chip trạng thái ("Chờ duyệt" / "Đã nhận +{điểm}" / "Bị từ chối: {lý do}" / "Đã bị huỷ: {lý do}");
 * - chưa nhận, đã tham gia và còn hạn (`open`) → nút "Tôi đã hoàn thành" (`btn-secondary`, tên cho trình
 *   đọc màn hình kèm tên mục); chip nằm trong vùng `role="status"` có sẵn nên được đọc lên sau khi nhận;
 * - hết hạn → không gì. Chưa tham gia mà còn hạn → một dòng nhỏ cuối thẻ "Tham gia buổi để nhận thưởng".
 * Lần nhận của mục đã tắt (không còn trong `bounties`) vẫn hiện kèm chip, để người chơi thấy kết quả.
 * Không có mục nào và không có lần nhận nào → không vẽ gì.
 *
 * Thẻ không tự gọi API: trang cha truyền `onClaim`, mục đang gửi và lỗi của lần bấm gần nhất.
 */

import { useId } from 'react';
import type { BountyClaimDto, BountyDto, SessionBountiesDto } from '../../shared/api-types';
import { CLAIM_CHIP_CLASS, bountyIcon, claimStatusText } from '../lib/bounties';
import { cx } from '../lib/cx';
import { formatTime } from '../lib/format';
import { useStaggerOnce } from '../lib/motion';

interface BountyCardProps {
  data: SessionBountiesDto;
  session: { startsAt: string; modeName: string };
  onClaim: (bountyId: number) => void;
  /** Mục đang chờ server trả lời (nút tắt, ghi "Đang gửi…"). */
  claimingId: number | null;
  /** Lỗi của lần bấm gần nhất, hiện ngay dưới mục đó. */
  error: { bountyId: number; message: string } | null;
  className?: string;
}

/** Một dòng của thẻ: mục đang áp dụng (có thể chưa nhận) hoặc lần nhận của mục đã tắt. */
interface Row {
  id: number;
  title: string;
  description: string | null;
  icon: string;
  points: number;
  claim: BountyClaimDto | undefined;
}

function rowsOf(data: SessionBountiesDto): Row[] {
  const claimOf = new Map(data.myClaims.map((claim) => [claim.bounty.id, claim]));
  const fromBounty = (bounty: BountyDto): Row => ({
    id: bounty.id,
    title: bounty.title,
    description: bounty.description,
    icon: bountyIcon(bounty.role),
    points: bounty.points,
    claim: claimOf.get(bounty.id),
  });
  const shown = new Set(data.bounties.map((bounty) => bounty.id));
  const orphans = data.myClaims
    .filter((claim) => !shown.has(claim.bounty.id))
    .map((claim): Row => ({ id: claim.bounty.id, title: claim.bounty.title, description: claim.bounty.description, icon: bountyIcon(claim.role), points: claim.points, claim }));
  return [...data.bounties.map(fromBounty), ...orphans];
}

/** Có gì để vẽ không (trang cha dùng để xếp lưới). */
export function hasBountyRows(data: SessionBountiesDto | undefined): boolean {
  return data !== undefined && (data.bounties.length > 0 || data.myClaims.length > 0);
}

export function BountyCard({ data, session, onClaim, claimingId, error, className }: BountyCardProps) {
  const headingId = useId();
  const stagger = useStaggerOnce(true);
  if (!hasBountyRows(data)) return null;
  const rows = rowsOf(data);
  const canClaim = data.open && data.attended;

  return (
    <section aria-labelledby={headingId} className={cx('panel flex min-w-0 flex-col gap-3', className)}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 id={headingId} className="text-xl leading-tight font-extrabold text-white">
          Treo thưởng
        </h3>
        <span className="text-sm text-night-300 tabular-nums">{`${formatTime(session.startsAt)} · ${session.modeName}`}</span>
      </div>

      <ul className={cx('flex flex-col divide-y divide-night-700', stagger)}>
        {rows.map((row) => (
          <li key={row.id} className="flex flex-col gap-2 py-2.5 first:pt-0 last:pb-0">
            <div className="flex items-start gap-3">
              <span aria-hidden="true" className="text-2xl leading-none">
                {row.icon}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="font-bold break-words text-white">{row.title}</span>
                {row.description && <span className="text-sm break-words text-night-300">{row.description}</span>}
              </div>
              <span className="chip shrink-0 bg-gold px-2.5 py-0.5 text-gold-ink tabular-nums">{`+${row.points}`}</span>
            </div>
            {(row.claim || canClaim) && (
              <div className="flex flex-col items-start">
                {/* Vùng thông báo có sẵn từ lúc còn nút, nên chip mới sau khi nhận được trình đọc màn hình đọc lên. */}
                <div role="status" aria-live="polite" className="max-w-full">
                  {row.claim && (
                    <span className={cx('chip rounded-xl! px-2.5 py-0.5 break-words whitespace-normal!', CLAIM_CHIP_CLASS[row.claim.status])}>{claimStatusText(row.claim)}</span>
                  )}
                </div>
                {!row.claim && (
                  <button
                    type="button"
                    className="btn-secondary"
                    // Kèm tên mục: thẻ có nhiều nút giống nhau.
                    aria-label={claimingId === row.id ? `Đang gửi…: ${row.title}` : `Tôi đã hoàn thành: ${row.title}`}
                    disabled={claimingId !== null}
                    onClick={() => onClaim(row.id)}
                  >
                    {claimingId === row.id ? 'Đang gửi…' : 'Tôi đã hoàn thành'}
                  </button>
                )}
              </div>
            )}
            {error?.bountyId === row.id && (
              <p role="alert" className="text-sm font-bold text-duck-soft">
                {error.message}
              </p>
            )}
          </li>
        ))}
      </ul>

      {data.open && !data.attended && <p className="text-sm text-night-300">Tham gia buổi để nhận thưởng</p>}
    </section>
  );
}
