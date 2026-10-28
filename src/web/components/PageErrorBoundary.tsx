/**
 * Lưới an toàn cho trang/tab tải lười: chunk vẫn hỏng sau lần tự tải lại (hoặc không thể tự tải
 * lại vì `sessionStorage` bị chặn — `lib/lazyPage.ts`) thì lỗi ném lên tới đây, hiện panel lỗi với
 * nút "Tải lại trang" thay vì cả app trắng trơn. Header/dock của `Layout` nằm ngoài nên vẫn dùng
 * được; đặt `key` theo trang ở chỗ dùng để sang trang khác là thử lại từ đầu.
 */

import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  failed: boolean;
}

export class PageErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="panel flex flex-col items-start gap-3 border-duck-soft">
        <p role="alert" className="font-bold text-duck-soft">
          Không tải được trang này. Có thể app vừa được cập nhật hoặc mạng đang chập chờn.
        </p>
        <button type="button" className="btn-secondary" onClick={() => location.reload()}>
          Tải lại trang
        </button>
      </div>
    );
  }
}
