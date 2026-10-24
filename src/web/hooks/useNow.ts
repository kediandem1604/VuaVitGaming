/**
 * Giờ hiện tại, cập nhật mỗi `intervalMs` (mặc định một phút) — cho chip đếm ngược của
 * thẻ buổi chơi. Mỗi lần dùng là một `setInterval` riêng, dọn khi unmount hoặc khi đổi
 * khoảng cách; vài thẻ trên một trang thì vài interval, không đáng kể.
 */

import { useEffect, useState } from 'react';

export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);

  return now;
}
