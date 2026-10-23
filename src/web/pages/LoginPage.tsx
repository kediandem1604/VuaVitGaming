/** Trang duy nhất không cần đăng nhập. `?error=` do `/auth/callback` gắn khi thất bại. */

import { useSearchParams } from 'react-router';
import { DuckSquad } from '../components/DuckSquad';

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
      <div className="flex w-full max-w-md flex-col items-center gap-2">
        <DuckSquad className="mb-2 w-full" />
        <h1 className="text-3xl font-bold text-goose">GGD Hub</h1>
        <p className="text-slate-600 dark:text-slate-400">Cộng đồng Goose Goose Duck Việt Nam</p>
      </div>

      {message && (
        <p role="alert" className="w-full max-w-xs rounded-lg border border-duck/40 bg-duck/10 px-4 py-3 text-sm font-medium text-duck">
          {message}
        </p>
      )}

      <a
        href="/auth/login"
        className="w-full max-w-xs rounded-xl bg-[#5865F2] px-6 py-4 text-lg font-semibold text-white shadow transition hover:bg-[#4752C4] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5865F2]"
      >
        Đăng nhập bằng Discord
      </a>

      <p className="text-sm text-slate-500 dark:text-slate-400">Chỉ thành viên trong server Discord mới đăng nhập được.</p>
    </main>
  );
}
