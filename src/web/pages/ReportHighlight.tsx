/**
 * Highlight kèm lần khai (spec highlight §3, §9), phần dùng trong `ReportPage`: ô chọn file của
 * form Khai điểm, nút "Thêm/Đổi highlight" ở "Lần khai của tôi", và kiểm tra loại + dung lượng
 * ngay trong trình duyệt (cùng câu báo với server, §7) trước khi tải lên — server vẫn kiểm lại
 * theo nội dung file. Chỉ hiện khi tính năng dùng được (`ReportPage` hỏi
 * `GET /api/reports/highlight-config`; hỏi không được coi như không có).
 */

import { useMutation } from '@tanstack/react-query';
import { useRef, useState, type ChangeEvent, type Ref } from 'react';
import type { ReportDto } from '../../shared/api-types';
import { HIGHLIGHT_ACCEPT, apiUpload, errorMessage, highlightContentType } from '../api';
import { cx } from '../lib/cx';

const MIB = 1024 * 1024;
/** Cùng câu với lỗi `INVALID_HIGHLIGHT` của server (spec highlight §7.3). */
const INVALID_HIGHLIGHT = 'Highlight phải là video MP4, WebM, MOV hoặc ảnh PNG, JPG, GIF';

const LABEL_CLASS = 'text-sm font-bold text-night-200';
const HINT_CLASS = 'text-sm text-night-300';
const ERROR_CLASS = 'text-sm font-bold text-duck-soft';
/**
 * Ô chọn file: nút "Chọn tệp" của trình duyệt vẽ như nút phụ (cùng kiểu với ô ảnh role);
 * `w-full min-w-0` để tên file dài không kéo rộng panel ở 320px (trình duyệt tự cắt tên).
 */
const FILE_INPUT_CLASS =
  'w-full min-w-0 text-sm text-night-300 file:mr-3 file:rounded-lg file:border-2 file:border-night-950 file:bg-night-700 file:px-3 file:py-1 file:font-bold file:text-white';

/** File đã qua kiểm tra, kèm content-type sẽ gửi (đoán theo đuôi khi trình duyệt để trống `type`). */
export interface HighlightUpload {
  file: File;
  contentType: string;
}

/** Kết quả kiểm tra một file: gửi được (`upload`) hoặc câu báo vì sao không (`problem`). */
export type HighlightCheck = { upload: HighlightUpload; problem: null } | { upload: null; problem: string };

/** Giới hạn dung lượng theo MiB như server báo: 10 MiB → "10 MB". */
function mibLabel(maxBytes: number): string {
  return `${Math.floor(maxBytes / MIB)} MB`;
}

/**
 * Kiểm tra trước khi tải lên: loại ngoài danh sách hay file rỗng → câu §7.3; lớn hơn `maxBytes`
 * (giới hạn hiện hành của server Discord) → "Highlight tối đa N MB". Đúng bằng giới hạn thì được.
 */
export function checkHighlight(file: File, maxBytes: number): HighlightCheck {
  const contentType = highlightContentType(file);
  if (contentType === null || file.size === 0) return { upload: null, problem: INVALID_HIGHLIGHT };
  if (file.size > maxBytes) return { upload: null, problem: `Highlight tối đa ${mibLabel(maxBytes)}` };
  return { upload: { file, contentType }, problem: null };
}

/** `PUT /api/reports/:id/highlight` body thô; trả lần khai đã có `highlightUrl`. */
export function uploadHighlight(reportId: number, { file, contentType }: HighlightUpload): Promise<ReportDto> {
  return apiUpload<ReportDto>(`/api/reports/${reportId}/highlight`, file, contentType);
}

// ---------------------------------------------------------------------------
// Ô chọn file trong form Khai điểm
// ---------------------------------------------------------------------------

interface HighlightFieldProps {
  id: string;
  maxBytes: number;
  /** Đang có file trong ô (hợp lệ hay không): hiện nút "Bỏ file". */
  hasFile: boolean;
  onChange: (file: File | null) => void;
  /** Người dùng bấm "Bỏ file": form xoá file khỏi state (và ô file qua `ref`). */
  onClear: () => void;
  /** Để form xoá file đã chọn sau khi gửi xong hoặc bấm "Bỏ file" (ô file không điều khiển được qua `value`). */
  ref?: Ref<HTMLInputElement>;
}

/**
 * Ô "Highlight (không bắt buộc)" + dòng giới hạn; việc kiểm tra file do form làm (`checkHighlight`).
 * Có file thì thêm nút "Bỏ file": Safari và Firefox giữ nguyên file cũ khi huỷ bộ chọn (không bắn
 * `change`), nên file bị từ chối (vd quá cỡ) cần một lối ra để vẫn gửi được khai điểm không kèm highlight.
 */
export function HighlightField({ id, maxBytes, hasFile, onChange, onClear, ref }: HighlightFieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={LABEL_CLASS}>
        Highlight (không bắt buộc)
      </label>
      <input
        ref={ref}
        id={id}
        type="file"
        accept={HIGHLIGHT_ACCEPT}
        className={FILE_INPUT_CLASS}
        onChange={(event) => onChange(event.target.files?.[0] ?? null)}
      />
      {hasFile && (
        <button type="button" className="btn-secondary self-start px-3 py-1 text-sm" onClick={onClear}>
          Bỏ file
        </button>
      )}
      <p className={HINT_CLASS}>Video MP4, WebM, MOV hoặc ảnh PNG, JPG, GIF — tối đa {mibLabel(maxBytes)}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Nút Thêm/Đổi highlight ở "Lần khai của tôi"
// ---------------------------------------------------------------------------

interface HighlightButtonProps {
  report: ReportDto;
  maxBytes: number;
  /** Tải xong: lần khai mới (có `highlightUrl`) để ghi vào danh sách. */
  onUploaded: (updated: ReportDto) => void;
  /** Server từ chối (vd lần khai vừa được duyệt → `NOT_PENDING`): nơi gọi tải lại danh sách. */
  onFailed: () => void;
}

/**
 * "Thêm highlight" (chưa có) / "Đổi highlight" (đã có) cho lần khai còn chờ duyệt: bấm là mở bộ
 * chọn file ẩn, chọn file hợp lệ là tải lên ngay. Trả về nút + ô file ẩn + dòng lỗi (nếu có) để
 * đặt chung hàng với nút Sửa; dòng lỗi `basis-full` nên xuống hàng riêng.
 */
export function HighlightButton({ report, maxBytes, onUploaded, onFailed }: HighlightButtonProps) {
  const picker = useRef<HTMLInputElement>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const upload = useMutation({
    mutationFn: (highlight: HighlightUpload) => uploadHighlight(report.id, highlight),
    onSuccess: onUploaded,
    onError: onFailed,
  });

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ''; // chọn lại cùng tệp vẫn kích hoạt onChange
    if (!file) return;
    const checked = checkHighlight(file, maxBytes);
    setLocalError(checked.problem);
    if (checked.upload) upload.mutate(checked.upload);
  };

  const error = localError ?? (upload.isError ? errorMessage(upload.error) : null);

  return (
    <>
      <button type="button" className="btn-secondary" disabled={upload.isPending} onClick={() => picker.current?.click()}>
        {upload.isPending ? 'Đang tải highlight…' : report.highlightUrl ? 'Đổi highlight' : 'Thêm highlight'}
      </button>
      <input ref={picker} type="file" accept={HIGHLIGHT_ACCEPT} hidden onChange={onFile} />
      {error && (
        <p role="alert" className={cx(ERROR_CLASS, 'basis-full')}>
          {error}
        </p>
      )}
    </>
  );
}
