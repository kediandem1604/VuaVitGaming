/**
 * Bảng chúc mừng SMVP (quyết định 2026-11-03) — `Layout` đặt dưới thanh điều hướng, cạnh banner
 * ngày nhân điểm, trên mọi trang. Server (`GET /api/badges/recent-smvp`) trả SMVP trao trong 7
 * ngày gần nhất hoặc null; null hay tải lỗi thì không vẽ gì (chỉ là lời chúc, không chen lỗi vào
 * mọi trang).
 *
 * "🏆 Chúc mừng {tên} đạt danh hiệu SMVP tháng {MM/YYYY}!" kèm avatar; tên là link tới trang thành
 * viên. Nút "Đóng" ẩn đúng lần trao đó (id dòng `member_badges`) trên máy này: danh sách id đã ẩn
 * nằm trong `localStorage` (mọi lần đọc/ghi bọc try/catch — bộ nhớ bị chặn thì vẫn ẩn được trong
 * lượt xem này nhờ state). SMVP tháng sau là dòng mới nên hiện lại.
 *
 * Nền tối viền vàng để khác banner nhân điểm (nền vàng) khi cả hai cùng hiện; chữ xuống dòng ở
 * 320px, không cuộn ngang; mờ vào theo bộ chuyển động (`.smvp-banner` trong `styles.css`).
 */

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { recentSmvpQuery } from '../lib/queries';
import { Avatar } from './Avatar';

/** Khoá `localStorage`: mảng JSON các id lần trao SMVP đã bấm "Đóng" trên máy này. */
const DISMISSED_KEY = 'ggd-smvp-dismissed';
/** Giữ tối đa bấy nhiêu id gần nhất để khoá không phình mãi (mỗi tháng một lần trao). */
const KEEP_IDS = 12;
/** Tải lại định kỳ (ngoài lúc focus lại cửa sổ) để thấy SMVP vừa trao lúc 00:05 ngày 1. */
const REFETCH_MS = 10 * 60_000;

/** `YYYY-MM` → `MM/YYYY` (như tên danh hiệu lưu ở server: "SMVP tháng 10/2026"). */
export function smvpMonthLabel(periodId: string): string {
  const [year = '', month = ''] = periodId.split('-');
  return `${month}/${year}`;
}

function readDismissed(): number[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((value): value is number => Number.isInteger(value)) : [];
  } catch {
    return [];
  }
}

function writeDismissed(ids: readonly number[]) {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(ids.slice(-KEEP_IDS)));
  } catch {
    // Bộ nhớ bị chặn/đầy: chỉ ẩn trong lượt xem này.
  }
}

export function SmvpBanner() {
  const recent = useQuery({ ...recentSmvpQuery, refetchInterval: REFETCH_MS, refetchOnWindowFocus: true });
  const [dismissed, setDismissed] = useState<number[]>(readDismissed);

  const award = recent.data;
  if (!award || dismissed.includes(award.id)) return null;

  const close = () => {
    const next = [...dismissed, award.id];
    setDismissed(next);
    writeDismissed(next);
  };
  const { member } = award;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pt-4">
      <section
        aria-label="Chúc mừng SMVP"
        className="smvp-banner flex items-center gap-3 rounded-2xl bg-night-800 py-2 pr-2 pl-3 text-white"
      >
        <Avatar name={member.displayName} url={member.avatarUrl} className="size-9 text-sm" />
        <p className="min-w-0 flex-1 py-0.5 font-bold break-words">
          {'🏆 Chúc mừng '}
          <Link to={`/thanh-vien/${member.id}`} className="font-extrabold text-gold underline-offset-2 hover:underline">
            {member.displayName}
          </Link>
          {` đạt danh hiệu SMVP tháng ${smvpMonthLabel(award.periodId)}!`}
        </p>
        <button type="button" className="btn-secondary shrink-0 px-3 py-1 text-sm" onClick={close}>
          Đóng
        </button>
      </section>
    </div>
  );
}
