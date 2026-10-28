/**
 * Giữ con trong DOM thêm một nhịp mờ ra khi `present` tắt (spec §5.2) — cho lớp nổi mà cha
 * gắn/gỡ bằng điều kiện (`{ending && <EndDialog/>}` → `<Presence present={ending}>`). Con đọc
 * trạng thái qua `usePresenceState()` để gắn `data-state`; không có `Presence` bọc ngoài thì
 * coi như luôn mở.
 */

import { createContext, useContext, type ReactNode } from 'react';
import { usePresence, type PresenceState } from '../lib/motion';

const PresenceContext = createContext<PresenceState>('open');

export function usePresenceState(): PresenceState {
  return useContext(PresenceContext);
}

export function Presence({ present, children }: { present: boolean; children: ReactNode }) {
  const { mounted, state } = usePresence(present);
  if (!mounted) return null;
  return <PresenceContext value={state}>{children}</PresenceContext>;
}
