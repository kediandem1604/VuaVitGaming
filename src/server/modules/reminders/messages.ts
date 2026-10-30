/**
 * Nội dung nhắc giờ (dùng chung cho email và DM Discord). Chủ đề chỉ email dùng.
 *
 * Loại `pre15` là tên cột enum trong DB; số phút thật lấy từ cài đặt
 * (`reminderLeadMinutes`), nên văn bản nói "Còn {lead} phút" chứ không cố định 15.
 */

import type { ReminderKind } from '@prisma/client';
import { formatVnTime } from '../../lib/time.js';
import type { SessionView } from '../../ports.js';

export interface ReminderMessage {
  subject: string;
  text: string;
}

export function buildReminder(
  kind: ReminderKind,
  view: SessionView,
  leadMinutes: number,
  publicUrl: string,
): ReminderMessage {
  const time = formatVnTime(view.startsAt);
  switch (kind) {
    case 'pre15':
      return {
        subject: `[GGD] Còn ${leadMinutes} phút: buổi ${view.modeName} lúc ${time}`,
        text: `Còn ${leadMinutes} phút nữa là tới buổi chơi ${view.modeName} lúc ${time}. Chuẩn bị vào game nhé!\n${publicUrl}`,
      };
    case 'start': {
      const roomLine = view.roomCode ? `\nMã phòng: ${view.roomCode}` : '';
      return {
        subject: `[GGD] Vào game thôi! Buổi ${view.modeName} ${time}`,
        text: `Buổi chơi ${view.modeName} bắt đầu rồi, vào game thôi! 🦆${roomLine}\n${publicUrl}`,
      };
    }
  }
}
