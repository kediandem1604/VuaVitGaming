/**
 * Ảnh kết quả một ván phóng to (spec ván §5): hộp `Modal` rộng, tiêu đề "Ảnh ván {n}", nút "Đóng"
 * (bấm nền / Esc cũng đóng). Cha bọc trong `<Presence>` cho nhịp mờ ra. Trang buổi và Duyệt điểm dùng.
 */

import { useId } from 'react';
import { Modal } from './Modal';

/** Ảnh ván phóng to trong hộp rộng; bấm nền, Esc hoặc "Đóng" để đóng. */
export function RoundImageModal({ title, src, onClose }: { title: string; src: string; onClose: () => void }) {
  const titleId = useId();
  return (
    <Modal titleId={titleId} onClose={onClose} size="wide">
      <div className="flex items-center justify-between gap-2">
        <h2 id={titleId} className="text-lg font-extrabold text-white">
          {title}
        </h2>
        <button type="button" className="btn-secondary" onClick={onClose}>
          Đóng
        </button>
      </div>
      <img src={src} alt={title} className="max-h-[75vh] w-full rounded-xl object-contain" />
    </Modal>
  );
}

