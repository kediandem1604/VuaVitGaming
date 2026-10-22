import { DiscordAPIError, RESTJSONErrorCodes } from 'discord.js';
import type { Client } from 'discord.js';
import { expect, test } from 'vitest';
import { DiscordJsNotifier } from '../../../src/server/bot/discord-notifier.js';
import { buildSessionMessage } from '../../../src/server/bot/embeds.js';
import { MessageGoneError } from '../../../src/server/ports.js';
import type { SessionView } from '../../../src/server/ports.js';
import { testConfig } from '../../helpers/ctx.js';

const view: SessionView = {
  id: 5,
  startsAt: new Date('2026-10-22T14:00:00Z'),
  modeName: 'Cổ điển (Classic)',
  capacity: 16,
  roomCode: 'ABC',
  note: null,
  status: 'scheduled',
  attendees: [{ memberId: 1, displayName: 'An' }],
};

/** Client giả: `channels.fetch` trả kênh trong `channels`; kênh gửi được ghi lại `sent`/`edited`. */
function fakeClient(channels: Record<string, unknown>) {
  const sent: { channelId: string; payload: unknown }[] = [];
  const edited: { channelId: string; messageId: string; payload: unknown }[] = [];
  const sendable = (channelId: string) => ({
    isSendable: () => true,
    send: async (payload: unknown) => {
      sent.push({ channelId, payload });
      return { id: `m-${sent.length}` };
    },
    messages: {
      edit: async (messageId: string, payload: unknown) => {
        edited.push({ channelId, messageId, payload });
        return { id: messageId };
      },
    },
  });
  const client = { channels: { fetch: async (id: string) => channels[id] ?? null } } as unknown as Client;
  return { client, sent, edited, sendable };
}

test('publishSession posts the built message to the schedule channel and returns its id', async () => {
  const f = fakeClient({});
  const n = new DiscordJsNotifier(f.client, testConfig());
  f.client.channels.fetch = (async (id: string) => (id === 'ch-schedule' ? f.sendable(id) : null)) as never;

  expect(await n.publishSession(view)).toBe('m-1');
  expect(f.sent).toEqual([{ channelId: 'ch-schedule', payload: buildSessionMessage(view) }]);
  expect(f.edited).toEqual([]);
});

test('updateSession edits that message in the schedule channel', async () => {
  const f = fakeClient({});
  const n = new DiscordJsNotifier(f.client, testConfig());
  f.client.channels.fetch = (async (id: string) => (id === 'ch-schedule' ? f.sendable(id) : null)) as never;

  const cancelled: SessionView = { ...view, status: 'cancelled' };
  await n.updateSession('m-9', cancelled);
  expect(f.edited).toEqual([{ channelId: 'ch-schedule', messageId: 'm-9', payload: buildSessionMessage(cancelled) }]);
  expect(f.sent).toEqual([]);
});

test('a missing or non-text schedule channel is an error (service marks the session dirty)', async () => {
  const missing = new DiscordJsNotifier(fakeClient({}).client, testConfig());
  await expect(missing.publishSession(view)).rejects.toThrow('ch-schedule');
  await expect(missing.updateSession('m-1', view)).rejects.toThrow('ch-schedule');

  const voice = new DiscordJsNotifier(fakeClient({ 'ch-schedule': { isSendable: () => false } }).client, testConfig());
  await expect(voice.publishSession(view)).rejects.toThrow('ch-schedule');
});

test('updateSession maps Discord "Unknown Message" (10008) to MessageGoneError and passes other errors through', async () => {
  const f = fakeClient({});
  const n = new DiscordJsNotifier(f.client, testConfig());
  let failure: unknown;
  const channel = {
    isSendable: () => true,
    messages: {
      edit: async () => {
        throw failure;
      },
    },
  };
  f.client.channels.fetch = (async (id: string) => (id === 'ch-schedule' ? channel : null)) as never;
  const url = 'https://discord.com/api/v10/channels/ch-schedule/messages/m-1';
  const discordError = (code: number, status: number, message: string) =>
    new DiscordAPIError({ code, message }, code, status, 'PATCH', url, {});

  // Tin đã bị xoá: lỗi có kiểu riêng, mang id tin, giữ lỗi gốc làm `cause`.
  failure = discordError(RESTJSONErrorCodes.UnknownMessage, 404, 'Unknown Message');
  const gone = await n.updateSession('m-1', view).catch((err: unknown) => err);
  expect(gone).toBeInstanceOf(MessageGoneError);
  expect((gone as Error).message).toContain('m-1');
  expect((gone as Error).cause).toBe(failure);

  // Lỗi Discord khác (thiếu quyền) và lỗi thường: ném nguyên vẹn.
  failure = discordError(RESTJSONErrorCodes.MissingPermissions, 403, 'Missing Permissions');
  await expect(n.updateSession('m-1', view)).rejects.toBe(failure);
  failure = new Error('mạng rớt');
  await expect(n.updateSession('m-1', view)).rejects.toBe(failure);
  expect(f.edited).toEqual([]);
});
