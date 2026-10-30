/**
 * Lưới an toàn cho trang/tab tải lười: chunk vẫn hỏng sau lần tự tải lại (hoặc không thể tự tải
 * lại vì `sessionStorage` bị chặn — `lib/lazyPage.ts`) thì lỗi ném lên tới đây, hiện panel lỗi với
 * nút "Tải lại trang" thay vì cả app trắng trơn. Header/dock của `Layout` nằm ngoài nên vẫn dùng
 * được; đặt `key` theo trang ở chỗ dùng để sang trang khác là thử lại từ đầu.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

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

  /** Ghi lỗi ra console (chunk hỏng hay lỗi render thật) để còn lần ra nguyên nhân khi người dùng báo. */
  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('[PageErrorBoundary] Trang lỗi khi render:', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    // Lời nhắn hợp cả hai trường hợp: chunk không tải được (vừa cập nhật/mạng) lẫn lỗi trong trang.
    return (
      <div className="panel flex flex-col items-start gap-3 border-duck-soft">
        <p role="alert" className="font-bold text-duck-soft">
          Không tải được trang này. Có thể app vừa được cập nhật hoặc mạng chập chờn. Nếu lỗi lặp lại, hãy báo admin.
        </p>
        <button type="button" className="btn-secondary" onClick={() => location.reload()}>
          Tải lại trang
        </button>
      </div>
    );
  }
}
