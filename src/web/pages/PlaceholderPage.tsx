/** Hai trang "không có gì để xem": không tìm thấy và không có quyền. */

import { Link } from 'react-router';

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
