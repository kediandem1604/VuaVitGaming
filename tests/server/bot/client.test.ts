import { Events } from 'discord.js';
import { afterEach, expect, test, vi } from 'vitest';
import { createBot } from '../../../src/server/bot/client.js';
import type { Ctx } from '../../../src/server/ctx.js';
import { testConfig } from '../../helpers/ctx.js';

afterEach(() => vi.restoreAllMocks());

test('an invalidated Discord session is logged and ends the process with code 1 so Railway restarts it', async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  const exit = vi.fn();
  // Không đăng nhập: chỉ dựng client và bắn sự kiện, không có kết nối mạng nào.
  const bot = createBot(() => ({}) as Ctx, testConfig(), { exit });
  try {
    expect(exit).not.toHaveBeenCalled();
    bot.client.emit(Events.Invalidated);
    expect(errors).toHaveBeenCalledTimes(1);
    expect(String(errors.mock.calls[0]?.[0])).toContain('[bot]');
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  } finally {
    await bot.client.destroy();
  }
});
