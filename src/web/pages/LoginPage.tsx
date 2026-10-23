/**
 * Trang duy nhất không cần đăng nhập (spec §6 "Đăng nhập"): nền đêm toàn màn hình (nền
 * của `body`), nhóm ngỗng ở trên, tiêu đề chữ nổi vàng, nút Discord kiểu khối. `?error=`
 * do `/auth/callback` gắn khi thất bại, hiện trong panel viền đỏ.
 */

import { useSearchParams } from 'react-router';
import { LobbySquad } from '../components/LobbySquad';

const ERROR_MESSAGES: Record<string, string> = {
  not_member: 'Bạn cần vào server Discord trước',
  state: 'Phiên đăng nhập hết hạn, thử lại',
  oauth: 'Không đăng nhập được với Discord, thử lại',
};

const UNKNOWN_ERROR = 'Không đăng nhập được, thử lại';

export function LoginPage() {
  const [params] = useSearchParams();
  const error = params.get('error');
  const message = error === null ? null : (ERROR_MESSAGES[error] ?? UNKNOWN_ERROR);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 px-4 py-8 text-center">
      <div className="flex w-full max-w-lg flex-col items-center gap-3">
        <LobbySquad className="w-full" />
        <h1 className="text-raised text-5xl leading-none font-extrabold text-gold">GGD Hub</h1>
        <p className="text-lg text-night-200">Cộng đồng Goose Goose Duck Việt Nam</p>
      </div>

      {message && (
        <p role="alert" className="panel w-full max-w-xs border-duck-soft py-3 text-base font-bold text-duck-soft">
          {message}
        </p>
      )}

      {/* Màu Discord (`PALETTE.discord`) không có token CSS nên ghi thẳng; chữ trắng đạt 4.6:1. */}
      <a href="/auth/login" className="btn w-full max-w-xs bg-[#5865F2] px-6 py-3 text-lg text-white">
        Đăng nhập bằng Discord
      </a>

      <p className="text-sm text-night-300">Chỉ thành viên trong server Discord mới đăng nhập được.</p>
    </main>
  );
}
