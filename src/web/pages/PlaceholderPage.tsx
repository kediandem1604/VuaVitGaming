import { Link } from 'react-router';

/** Trang chưa làm: tiêu đề + "Sắp có". */
export function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="text-slate-600 dark:text-slate-400">Sắp có</p>
    </div>
  );
}

export function NotFoundPage() {
  return (
    <div className="flex flex-col items-start gap-3">
      <h1 className="text-2xl font-bold">Không tìm thấy trang</h1>
      <Link to="/" className="btn-secondary">
        Về trang Hôm nay
      </Link>
    </div>
  );
}

export function ForbiddenPage() {
  return (
    <div className="flex flex-col items-start gap-3">
      <h1 className="text-2xl font-bold">Bạn không có quyền xem trang này</h1>
      <Link to="/" className="btn-secondary">
        Về trang Hôm nay
      </Link>
    </div>
  );
}
