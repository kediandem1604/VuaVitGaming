/** Một con số đếm lên/xuống khi giá trị đổi lúc đang xem (`useCountUp`, spec §5.6); render thuần chữ số. */

import { useCountUp } from '../hooks/useCountUp';

export function CountUp({ value }: { value: number }) {
  return <>{useCountUp(value)}</>;
}
