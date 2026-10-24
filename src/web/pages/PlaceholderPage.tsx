/**
 * Hai trang "không có gì để xem": không tìm thấy và không có quyền. Vẽ theo Sảnh đêm như
 * mọi trang: tiêu đề chữ nổi trắng (`text-raised`), một panel có ngỗng nhỏ đứng cạnh câu
 * giải thích, và nút vàng `btn-primary` về trang Hôm nay.
 */

import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { MiniGoose } from '../components/goose/MiniGoose';

export function NotFoundPage() {
  return <Notice title="Không tìm thấy trang">Đường dẫn này không dẫn tới trang nào của GGD Hub.</Notice>;
}

export function ForbiddenPage() {
  return <Notice title="Bạn không có quyền xem trang này">Trang này chỉ dành cho mod và admin.</Notice>;
}

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-6">
      {/* Tiêu đề 30px ≥ 18px nên dùng được chữ nổi; câu dài có thể xuống dòng ở 320px nên dùng leading-tight. */}
      <h1 className="text-raised text-3xl leading-tight font-extrabold text-white">{title}</h1>
      <section className="panel flex items-center gap-4">
        <MiniGoose className="h-20 w-15" />
        <div className="flex min-w-0 flex-1 flex-col items-start gap-3">
          <p className="text-night-200">{children}</p>
          <Link to="/" className="btn-primary">
            Về trang Hôm nay
          </Link>
        </div>
      </section>
    </div>
  );
}
