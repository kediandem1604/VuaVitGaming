/**
 * Banner ngày nhân điểm (spec ngày nhân điểm §5) — `Layout` đặt ngay dưới thanh điều hướng, trên
 * mọi trang. Hiện ngày nhân điểm gần nhất từ hôm nay (giờ VN) trở đi mà máy này chưa ẩn:
 * "🔥 Hôm nay điểm cộng ×m!", "🔥 Ngày mai (dd/mm) điểm cộng ×m!" hoặc "🔥 {Thứ}, {dd/mm}: điểm cộng
 * ×m!", kèm lời nhắn sau " — ". Không có ngày nào (hoặc tải lỗi) thì không vẽ gì — banner chỉ là lời
 * nhắc, không chen thông báo lỗi vào mọi trang.
 *
 * Nút ✕ ("Ẩn thông báo") ẩn banner của đúng ngày đó trên máy này: danh sách ngày đã ẩn nằm trong
 * `localStorage` (mọi lần đọc/ghi bọc try/catch — chế độ riêng tư hay bộ nhớ bị chặn thì vẫn ẩn
 * được trong lượt xem này nhờ state). Ngày nhân khác vẫn hiện bình thường.
 *
 * Qua nửa đêm lúc trang đang mở (Review Focus #4): "hôm nay" tính lại mỗi phút từ đồng hồ (`useNow`),
 * nên "Ngày mai" thành "Hôm nay" và ngày vừa qua bị bỏ khỏi danh sách cũ ngay cả khi dữ liệu không đổi;
 * danh sách tự tải lại khi cửa sổ được focus lại và mỗi `REFETCH_MS` để thấy ngày admin vừa thêm/xoá.
 *
 * Nền vàng → cam (`.multiplier-banner` trong `styles.css`), chữ `gold-ink` (≥ 6.9:1 ở cả hai chủ đề);
 * chữ xuống dòng ở 320px, không cuộn ngang; mờ vào theo bộ chuyển động.
 */

import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useState } from 'react';
import type { MultiplierDayDto } from '../../shared/api-types';
import { useNow } from '../hooks/useNow';
import { addDaysIso, formatDayLabel, formatDayMonth, vnTodayIso } from '../lib/format';
import { upcomingMultipliersQuery } from '../lib/queries';

/** Khoá `localStorage`: mảng JSON các ngày (`YYYY-MM-DD`) đã bấm ẩn trên máy này. */
const HIDDEN_KEY = 'ggd-multiplier-hidden';
/** Tải lại danh sách định kỳ (ngoài lúc focus lại cửa sổ). */
const REFETCH_MS = 10 * 60_000;

/** Câu của banner cho ngày `item`, với `today` là hôm nay giờ VN (`YYYY-MM-DD`). */
export function multiplierBannerText(item: MultiplierDayDto, today: string): string {
  const gain = `điểm cộng ×${item.multiplier}!`;
  const headline =
    item.day === today
      ? `🔥 Hôm nay ${gain}`
      : item.day === addDaysIso(today, 1)
        ? `🔥 Ngày mai (${formatDayMonth(item.day)}) ${gain}`
        : `🔥 ${formatDayLabel(item.day)}: ${gain}`;
  return item.message ? `${headline} — ${item.message}` : headline;
}

function readHidden(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
  } catch {
    return [];
  }
}

/** Ghi danh sách ngày đã ẩn, bỏ các ngày đã qua để khoá không phình mãi. Ghi lỗi thì thôi. */
function writeHidden(days: readonly string[], today: string) {
  try {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify(days.filter((day) => day >= today)));
  } catch {
    // Bộ nhớ bị chặn/đầy: chỉ ẩn trong lượt xem này.
  }
}

export function MultiplierBanner() {
  const upcoming = useQuery({ ...upcomingMultipliersQuery, refetchInterval: REFETCH_MS, refetchOnWindowFocus: true });
  const today = vnTodayIso(useNow());
  const [hidden, setHidden] = useState<string[]>(readHidden);

  // Danh sách đã gần nhất trước; lọc lại theo hôm nay của máy để ngày vừa qua nửa đêm không còn hiện.
  const item = upcoming.data?.find((entry) => entry.day >= today && !hidden.includes(entry.day));
  if (!item) return null;

  const text = multiplierBannerText({ ...item, message: null }, today);
  const hide = () => {
    const next = [...hidden, item.day];
    setHidden(next);
    writeHidden(next, today);
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pt-4">
      <section aria-label="Thông báo ngày nhân điểm" className="multiplier-banner flex items-start gap-2 rounded-2xl py-2 pr-2 pl-4 text-gold-ink">
        <p className="min-w-0 flex-1 self-center py-0.5 font-extrabold break-words">
          {text}
          {item.message && <span className="font-bold">{` — ${item.message}`}</span>}
        </p>
        {/* Viền focus mặc định là vàng — trên nền vàng phải đổi sang mực tối mới thấy. */}
        <button
          type="button"
          aria-label="Ẩn thông báo"
          title="Ẩn thông báo"
          className="flex size-8 shrink-0 items-center justify-center rounded-full hover:bg-gold-ink/10 focus-visible:outline-gold-ink"
          onClick={hide}
        >
          <X aria-hidden="true" className="size-5" strokeWidth={2.75} />
        </button>
      </section>
    </div>
  );
}
