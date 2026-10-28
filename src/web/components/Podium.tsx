/**
 * Bục vinh danh 1-2-3 (spec §6 "Xếp hạng"): tối đa ba hàng đầu của bảng xếp hạng một role.
 * Thứ tự DOM theo hạng (1, 2, 3) để trình đọc màn hình đọc đúng thứ tự. Đủ ba hàng thì trên
 * màn hình xếp 2-1-3 bằng `order-*` (bục giữa cao nhất, nền vàng); ít hơn ba thì giữ thứ tự
 * tự nhiên để hạng 1 không bao giờ nằm lệch phải (ruling R14). Hạng 1 có nhân vật hoá thân
 * đứng trên bục — tên đã ở bảng tên trên đầu nên không ghi lại bên dưới; hạng 2 và 3 là avatar
 * trang trí kèm tên bên dưới (ruling R13: avatar không mang nhãn để trình đọc màn hình không
 * đọc tên hai lần). Mọi mục ghi `{điểm} {chỉ số}` (role có chỉ số phụ: `{điểm} điểm`, spec chỉ
 * số phụ §7); số trận chỉ có ở bảng đầy đủ bên dưới. Không có hàng nào thì trang không vẽ bục.
 *
 * Phần "người" của mỗi mục là một link tới trang thành viên công khai (spec huy hiệu §9):
 * hạng 1 là cả nhân vật (tên link đọc theo nhãn nhân vật "{role}: {tên}"), hạng 2–3 là avatar
 * + tên (tên link chỉ là tên người). Điểm và mặt bục nằm ngoài link.
 */

import type { LeaderboardRowDto, RoleDto } from '../../shared/api-types';
import { seasonScoreUnit } from '../../shared/metric';
import { cx } from '../lib/cx';
import { memberPath } from '../lib/links';
import { useStaggerOnce } from '../lib/motion';
import { Avatar } from './Avatar';
import { Character } from './Character';
import { CountUp } from './CountUp';
import { PrefetchLink } from './PrefetchLink';

interface PodiumProps {
  role: RoleDto;
  rows: LeaderboardRowDto[];
}

/** Chiều cao và mặt bục theo vị trí trong bảng (API trả hạng liền 1, 2, 3…). */
const STEPS = [
  { height: 'h-16', face: 'bg-gold text-gold-ink' },
  { height: 'h-12', face: 'bg-night-700 text-white' },
  { height: 'h-9', face: 'bg-night-700 text-white' },
] as const;

/** Vị trí trên màn hình theo vị trí DOM: đủ ba bậc thì 2-1-3, ít hơn thì theo thứ tự tự nhiên. */
const ORDER_PODIUM = ['order-2', 'order-1', 'order-3'] as const;
const ORDER_NATURAL = ['order-1', 'order-2', 'order-3'] as const;

export function Podium({ role, rows }: PodiumProps) {
  const order = rows.length >= STEPS.length ? ORDER_PODIUM : ORDER_NATURAL;
  // Lần hiện đầu: ba mục mờ + trượt so le (spec §5.4).
  const stagger = useStaggerOnce();
  return (
    // `items-end`: các mục đứng chung một sàn (viền dưới của `ol`), bục cao thấp khác nhau.
    <ol aria-label="Bục vinh danh" className={cx('flex items-end justify-center gap-2 border-b-3 border-night-950 px-1 sm:gap-4', stagger)}>
      {STEPS.map((step, index) => {
        const row = rows[index];
        if (!row) return null;
        return (
          <li key={row.memberId} className={cx('flex min-w-0 max-w-44 flex-1 flex-col items-center gap-1 text-center', order[index])}>
            {index === 0 ? (
              // `flex justify-center` để nhân vật (`w-full`, tối đa 120px) vẫn đứng giữa cột như khi chưa có link.
              <PrefetchLink to={memberPath(row.memberId)} className="flex w-full justify-center rounded-xl">
                <Character role={role} holderName={row.displayName} variant="current" />
              </PrefetchLink>
            ) : (
              // Một link cho cả avatar và tên: avatar không nhãn nên tên link chỉ là tên người; gạch chân tên khi rê chuột.
              <PrefetchLink to={memberPath(row.memberId)} className="flex w-full flex-col items-center gap-1 rounded-xl hover:underline">
                <Avatar name={row.displayName} url={row.avatarUrl} className="size-14 text-xl" />
                {/* Tên xuống dòng thay vì cắt "…": cột chỉ ~90px ở 320px, cắt thì mất cả tên ngắn. */}
                <p className="w-full px-1 leading-tight font-bold break-words text-white">{row.displayName}</p>
              </PrefetchLink>
            )}
            <p className="px-1 text-sm leading-tight font-bold break-words text-gold">
              {/* Điểm đổi lúc đang xem thì đếm tới số mới (spec §5.6). */}
              <span className="text-base tabular-nums">
                <CountUp value={row.score} />
              </span>{' '}
              {seasonScoreUnit(role)}
            </p>
            {/* Số hạng in trên mặt bục; "Hạng" chỉ dành cho trình đọc màn hình. */}
            <p
              className={cx(
                'mt-1 flex w-full items-center justify-center rounded-t-xl border-3 border-b-0 border-night-950 text-2xl font-extrabold tabular-nums',
                step.height,
                step.face,
              )}
            >
              <span className="sr-only">Hạng </span>
              {row.rank}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
