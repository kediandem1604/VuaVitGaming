/**
 * `Link`/`NavLink` của react-router có thêm tải trước theo ý định (spec §4.3): rê chuột dừng
 * ≥ 80ms, chạm hoặc focus → import chunk trang đích và dữ liệu chính của nó (`lib/prefetch.ts`).
 * Dùng cho menu trên, dock dưới và link trong trang dẫn sang trang khác.
 */

import type { ComponentProps } from 'react';
import { Link, NavLink } from 'react-router';
import { usePrefetchOnIntent } from '../lib/prefetch';

export function PrefetchLink({ to, ...rest }: ComponentProps<typeof Link>) {
  const handlers = usePrefetchOnIntent(typeof to === 'string' ? to : (to.pathname ?? ''));
  return <Link to={to} {...handlers} {...rest} />;
}

export function PrefetchNavLink({ to, ...rest }: ComponentProps<typeof NavLink>) {
  const handlers = usePrefetchOnIntent(typeof to === 'string' ? to : (to.pathname ?? ''));
  return <NavLink to={to} {...handlers} {...rest} />;
}
