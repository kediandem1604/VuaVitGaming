import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Suspense } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { PageErrorBoundary } from '../../src/web/components/PageErrorBoundary';
import { CHUNK_RELOAD_FLAG, lazyPage } from '../../src/web/lib/lazyPage';

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test('a chunk that still fails after the reload shows an error with a manual reload, not a blank page', async () => {
  const reload = vi.fn();
  vi.stubGlobal('location', { ...window.location, reload });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  // Vừa tự tải lại một lần: lần hỏng này ném lên thay vì tải lại nữa.
  sessionStorage.setItem(CHUNK_RELOAD_FLAG, String(Date.now()));
  const Broken = lazyPage(() => Promise.reject(new Error('Failed to fetch dynamically imported module')));

  render(
    <main>
      <PageErrorBoundary>
        <Suspense fallback={<p>khung xương</p>}>
          <Broken />
        </Suspense>
      </PageErrorBoundary>
    </main>,
  );

  expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được trang này');
  expect(reload).not.toHaveBeenCalled();
  // Người dùng tự bấm thì mới tải lại.
  fireEvent.click(screen.getByRole('button', { name: 'Tải lại trang' }));
  expect(reload).toHaveBeenCalledTimes(1);
});

test('children render normally when nothing throws', () => {
  render(
    <PageErrorBoundary>
      <p>ổn</p>
    </PageErrorBoundary>,
  );
  expect(screen.getByText('ổn')).toBeInTheDocument();
});

test('a caught error is logged and the panel tells the user what to do if it repeats', () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const Boom = () => {
    throw new Error('nổ');
  };
  render(
    <PageErrorBoundary>
      <Boom />
    </PageErrorBoundary>,
  );
  const alert = screen.getByRole('alert');
  expect(alert).toHaveTextContent('Không tải được trang này. Có thể app vừa được cập nhật hoặc mạng chập chờn.');
  expect(alert).toHaveTextContent('Nếu lỗi lặp lại, hãy báo admin.');
  // `componentDidCatch` ghi lỗi kèm thông điệp riêng (ngoài log mặc định của React).
  expect(error.mock.calls.some((args) => args.some((a) => a instanceof Error && a.message === 'nổ') && String(args[0]).includes('PageErrorBoundary'))).toBe(true);
});
