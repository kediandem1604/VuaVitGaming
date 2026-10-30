/**
 * Hộp thoại chặn (modal) dùng chung: lớp phủ, `role="dialog" aria-modal` đặt tên bằng
 * `aria-labelledby`, và quản lý tiêu điểm — mở thì tiêu điểm vào trong hộp (phần tử
 * nhận tiêu điểm đầu tiên, không có thì chính hộp), Tab/Shift+Tab quay vòng trong hộp,
 * Escape hoặc bấm nền đóng, đóng thì trả tiêu điểm về phần tử đã mở hộp.
 *
 * Nội dung tải trễ (vd danh sách hạng mục) vẫn ổn: lúc mở chưa có gì để nhận tiêu điểm
 * thì hộp nhận; bẫy Tab tính lại danh sách phần tử ở mỗi lần bấm phím.
 *
 * Chuyển động (spec §5.2): nền mờ vào/ra, hộp phóng 0.96→1 khi mở và mờ ra khi đóng. Cha bọc
 * trong `<Presence present={…}>` để hộp còn trong DOM một nhịp mờ ra; lúc đó lớp phủ `inert` +
 * `aria-hidden` (không nhận bấm/phím, không còn trong cây truy cập) và tiêu điểm trả về ngay cho
 * phần tử đã mở — không chờ hoạt ảnh xong. Không có `Presence` thì hộp gỡ ngay như trước.
 */

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';

/** Phần tử đang có tiêu điểm (để trả lại khi đóng), hoặc `null`. */
const focusedElement = () => (document.activeElement instanceof HTMLElement ? document.activeElement : null);
import { usePresenceState } from './Presence';

interface ModalProps {
  /** id của tiêu đề bên trong hộp (`aria-labelledby`). */
  titleId: string;
  onClose: () => void;
  children: ReactNode;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true');
}

export function Modal({ titleId, onClose, children }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const state = usePresenceState();
  const closing = state === 'closed';

  const wasClosing = useRef(closing);

  function focusInside() {
    const dialog = dialogRef.current;
    if (dialog) (focusableIn(dialog)[0] ?? dialog).focus();
  }

  /**
   * Trả tiêu điểm về phần tử đã mở hộp — đúng một lần: sau đó quên nó, để lúc hộp gỡ khỏi DOM
   * (hết nhịp mờ ra) không giành lại tiêu điểm nếu người dùng đã sang chỗ khác.
   */
  function restoreFocus() {
    const opener = openerRef.current;
    openerRef.current = null;
    if (opener && opener.isConnected) opener.focus();
  }

  // Mở: nhớ phần tử đang có tiêu điểm, đưa tiêu điểm vào hộp. Gỡ: trả lại (nếu chưa trả lúc đóng).
  useEffect(() => {
    openerRef.current = focusedElement();
    focusInside();
    return restoreFocus;
  }, []);

  useEffect(() => {
    const before = wasClosing.current;
    wasClosing.current = closing;
    // Bắt đầu mờ ra: trả tiêu điểm ngay, không bắt người dùng chờ hoạt ảnh.
    if (closing) restoreFocus();
    // Mở lại giữa lúc mờ ra (cùng phần tử): nhớ lại người mở và đưa tiêu điểm vào hộp lần nữa.
    else if (before) {
      openerRef.current = focusedElement();
      focusInside();
    }
  }, [closing]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    const items = focusableIn(dialog);
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (!first || !last) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    if (event.shiftKey && (active === first || active === dialog || !dialog.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    // Lớp phủ `night-950` mờ 70%; hộp là `panel` (viền đậm) — spec §5.4.
    <div
      className="backdrop-fade fixed inset-0 z-20 flex items-end justify-center bg-night-950/70 p-4 sm:items-center"
      data-state={state}
      aria-hidden={closing || undefined}
      inert={closing || undefined}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="panel layer-pop flex max-h-full w-full max-w-md flex-col gap-3 overflow-y-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-gold"
        data-state={state}
        data-side="center"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </div>
  );
}
