/**
 * `Link`/`NavLink` của react-router có thêm tải trước theo ý định (spec §4.3): rê chuột dừng
 * ≥ 80ms, chạm hoặc focus → import chunk trang đích và dữ liệu chính của nó (`lib/prefetch.ts`).
 * Bấm (điều hướng thật) → bắt đầu tải ngay cả khi đang tiết kiệm dữ liệu, và báo "đang chuyển
 * trang" (`lib/navPending.ts`) để `Layout` hiện vạch tiến trình trong lúc chunk chưa về.
 * Dùng cho menu trên, dock dưới và link trong trang dẫn sang trang khác.
 *
 * Handler của người gọi (`onFocus`, `onPointerEnter`, `onClick`…) chạy trước rồi mới tới phần tải
 * trước — không bên nào đè bên nào.
 */

import { QueryClientContext } from '@tanstack/react-query';
import { useContext, type ComponentProps, type MouseEvent, type SyntheticEvent } from 'react';
import { Link, NavLink, useLocation, useResolvedPath, type To } from 'react-router';
import { beginNavigation } from '../lib/navPending';
import { loadRoute, normalize, usePrefetchOnIntent } from '../lib/prefetch';

type IntentProps = Pick<ComponentProps<typeof Link>, 'onPointerEnter' | 'onPointerLeave' | 'onFocus' | 'onTouchStart' | 'onClick' | 'target'>;

function chain<E extends SyntheticEvent>(mine: (event: E) => void, theirs?: (event: E) => void) {
  return (event: E) => {
    theirs?.(event);
    mine(event);
  };
}

/** Lần bấm mà trình duyệt/React Router sẽ điều hướng ngay trong tab này (không Ctrl/⌘, không tab mới…). */
function isPlainClick(event: MouseEvent<HTMLAnchorElement>, target: string | undefined): boolean {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey &&
    (target === undefined || target === '_self')
  );
}

/** Handler đã ghép (của người gọi + tải trước/điều hướng) cho link tới `to`. */
function useIntentHandlers(to: To, props: IntentProps) {
  const path = normalize(useResolvedPath(to).pathname);
  const { pathname: current } = useLocation();
  const intent = usePrefetchOnIntent(path);
  const queryClient = useContext(QueryClientContext);

  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!isPlainClick(event, props.target)) return;
    loadRoute(path, queryClient);
    // Chỉ đổi query string của trang đang xem thì không có chunk nào phải chờ.
    if (path !== normalize(current)) beginNavigation(path);
  };

  return {
    onPointerEnter: chain(intent.onPointerEnter, props.onPointerEnter),
    onPointerLeave: chain(intent.onPointerLeave, props.onPointerLeave),
    onFocus: chain(intent.onFocus, props.onFocus),
    onTouchStart: chain(intent.onTouchStart, props.onTouchStart),
    onClick: chain(onClick, props.onClick),
  };
}

export function PrefetchLink({ to, onPointerEnter, onPointerLeave, onFocus, onTouchStart, onClick, ...rest }: ComponentProps<typeof Link>) {
  const handlers = useIntentHandlers(to, { onPointerEnter, onPointerLeave, onFocus, onTouchStart, onClick, target: rest.target });
  return <Link to={to} {...rest} {...handlers} />;
}

export function PrefetchNavLink({ to, onPointerEnter, onPointerLeave, onFocus, onTouchStart, onClick, ...rest }: ComponentProps<typeof NavLink>) {
  const handlers = useIntentHandlers(to, { onPointerEnter, onPointerLeave, onFocus, onTouchStart, onClick, target: rest.target });
  return <NavLink to={to} {...rest} {...handlers} />;
}
