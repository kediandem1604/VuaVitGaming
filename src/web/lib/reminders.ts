/**
 * Kênh nhắc giờ của người đang đăng nhập, cho dòng nhắc trên thẻ buổi chơi. Khớp với cách
 * server chọn kênh (`reminders/service.ts`): email chỉ gửi khi đã bật **và** có địa chỉ,
 * DM Discord gửi khi đã bật. Số phút nhắc trước là cài đặt của admin (`reminderLeadMinutes`)
 * và không có trong API của thành viên, nên dòng nhắc không ghi số phút.
 */

import type { MeDto } from '../../shared/api-types';

export interface ReminderChannels {
  email: boolean;
  discord: boolean;
}

export function reminderChannels(me: Pick<MeDto, 'email' | 'notifyEmail' | 'notifyDm'>): ReminderChannels {
  return { email: me.notifyEmail && me.email !== null, discord: me.notifyDm };
}

/** "Nhắc trước giờ chơi qua email và Discord" / "… qua email" / "… qua Discord"; không kênh nào → `null`. */
export function reminderText(channels: ReminderChannels): string | null {
  const via = [channels.email ? 'email' : null, channels.discord ? 'Discord' : null].filter((name) => name !== null);
  return via.length === 0 ? null : `Nhắc trước giờ chơi qua ${via.join(' và ')}`;
}
