import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ApiError } from './api';
import { App } from './App';
// Font Baloo 2 (biến thiên 400–800, có bộ dấu tiếng Việt) phải nạp trước styles.css để `--font-sans` có mặt chữ.
import '@fontsource-variable/baloo-2';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Lỗi 4xx (hết phiên, không có quyền, dữ liệu sai) thử lại cũng vô ích.
      retry: (failureCount, error) => failureCount < 2 && !(error instanceof ApiError && error.status < 500),
    },
  },
});

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Thiếu phần tử #root');

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
