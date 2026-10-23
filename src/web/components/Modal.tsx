/**
 * Hộp thoại chặn (modal) dùng chung: lớp phủ, `role="dialog" aria-modal` đặt tên bằng
 * `aria-labelledby`, và quản lý tiêu điểm — mở thì tiêu điểm vào trong hộp (phần tử
 * nhận tiêu điểm đầu tiên, không có thì chính hộp), Tab/Shift+Tab quay vòng trong hộp,
 * Escape hoặc bấm nền đóng, đóng thì trả tiêu điểm về phần tử đã mở hộp.
 *
 * Nội dung tải trễ (vd danh sách hạng mục) vẫn ổn: lúc mở chưa có gì để nhận tiêu điểm
 * thì hộp nhận; bẫy Tab tính lại danh sách phần tử ở mỗi lần bấm phím.
 */

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';

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

  // Mở: nhớ phần tử đang có tiêu điểm, đưa tiêu điểm vào hộp. Đóng (unmount): trả lại.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    if (dialog) (focusableIn(dialog)[0] ?? dialog).focus();
    return () => {
      if (opener && opener.isConnected) opener.focus();
    };
  }, []);

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
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-slate-900/50 p-4 sm:items-center" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="card flex max-h-full w-full max-w-md flex-col gap-3 overflow-y-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-goose/50"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </div>
  );
}
