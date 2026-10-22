import { DiscordAPIError, RESTJSONErrorCodes } from 'discord.js';
import type { APIEmbed, Client } from 'discord.js';
import { expect, test } from 'vitest';
import { DiscordJsNotifier } from '../../../src/server/bot/discord-notifier.js';
import { buildSessionMessage, buildVoteMessage } from '../../../src/server/bot/embeds.js';
import { MessageGoneError } from '../../../src/server/ports.js';
import type { SessionView, VotePrompt } from '../../../src/server/ports.js';
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

const prompt: VotePrompt = {
  roundId: 7,
  categoryId: 3,
  categoryName: 'Giết nhiều nhất',
  description: null,
  sessionLabel: 'Cổ điển (Classic) 21:00 22/10',
  closesAt: new Date('2026-10-23T00:00:00Z'),
  nominees: [
    { memberId: 1, displayName: 'An' },
    { memberId: 2, displayName: 'Bình' },
  ],
};

/**
 * Client giả: `channels.fetch` trả kênh trong `channels`; kênh gửi được ghi lại
 * `sent`/`edited`/`fetched`. `sendable(id, embeds)` là kênh mà `messages.fetch` trả
 * tin có các embed đó (dạng `Embed` của discord.js: có `toJSON`).
 */
function fakeClient(channels: Record<string, unknown>) {
  const sent: { channelId: string; payload: unknown }[] = [];
  const edited: { channelId: string; messageId: string; payload: unknown }[] = [];
  const fetched: { channelId: string; messageId: string }[] = [];
  const sendable = (channelId: string, embeds: APIEmbed[] = []) => ({
    isSendable: () => true,
    send: async (payload: unknown) => {
      sent.push({ channelId, payload });
      return { id: `m-${sent.length}` };
    },
    messages: {
      fetch: async (messageId: string) => {
        fetched.push({ channelId, messageId });
        return { id: messageId, embeds: embeds.map((e) => ({ toJSON: () => e })) };
      },
      edit: async (messageId: string, payload: unknown) => {
        edited.push({ channelId, messageId, payload });
        return { id: messageId };
      },
    },
  });
  const client = { channels: { fetch: async (id: string) => channels[id] ?? null } } as unknown as Client;
  return { client, sent, edited, fetched, sendable };
}

const url = 'https://discord.com/api/v10/channels/ch/messages/m-1';
const discordError = (code: number, status: number, message: string) =>
  new DiscordAPIError({ code, message }, code, status, 'PATCH', url, {});

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

// ---------------------------------------------------------------------------
// Tin vote
// ---------------------------------------------------------------------------

test('publishVote posts the built vote message to the vote channel and returns its id', async () => {
  const f = fakeClient({});
  const n = new DiscordJsNotifier(f.client, testConfig());
  f.client.channels.fetch = (async (id: string) => (id === 'ch-vote' ? f.sendable(id) : null)) as never;

  expect(await n.publishVote(prompt)).toBe('m-1');
  expect(f.sent).toEqual([{ channelId: 'ch-vote', payload: buildVoteMessage(prompt) }]);
  expect(f.edited).toEqual([]);
});

test('closeVote re-reads the message, keeps its embed, appends the result and footer and drops the menu', async () => {
  const f = fakeClient({});
  const n = new DiscordJsNotifier(f.client, testConfig());
  const original = buildVoteMessage(prompt).embeds[0];
  if (!original) throw new Error('Không có embed');
  f.client.channels.fetch = (async (id: string) => (id === 'ch-vote' ? f.sendable(id, [original]) : null)) as never;

  await n.closeVote('m-4', '🏆 An (2 phiếu)');
  expect(f.fetched).toEqual([{ channelId: 'ch-vote', messageId: 'm-4' }]);
  expect(f.edited).toEqual([
    {
      channelId: 'ch-vote',
      messageId: 'm-4',
      payload: {
        embeds: [{ ...original, fields: [{ name: 'Kết quả', value: '🏆 An (2 phiếu)' }], footer: { text: 'Đã đóng vote' } }],
        components: [],
      },
    },
  ]);
  expect(f.sent).toEqual([]);
});

test('closeVote still writes the result when the message has lost its embed', async () => {
  const f = fakeClient({});
  const n = new DiscordJsNotifier(f.client, testConfig());
  f.client.channels.fetch = (async (id: string) => (id === 'ch-vote' ? f.sendable(id, []) : null)) as never;

  await n.closeVote('m-2', 'Không ai được vote');
  expect(f.edited).toEqual([
    {
      channelId: 'ch-vote',
      messageId: 'm-2',
      payload: {
        embeds: [{ fields: [{ name: 'Kết quả', value: 'Không ai được vote' }], footer: { text: 'Đã đóng vote' } }],
        components: [],
      },
    },
  ]);
});

test('closeVote maps "Unknown Message" (10008) on fetch or edit to MessageGoneError and passes other errors through', async () => {
  const f = fakeClient({});
  const n = new DiscordJsNotifier(f.client, testConfig());
  let fetchFailure: unknown;
  let editFailure: unknown;
  const channel = {
    isSendable: () => true,
    messages: {
      fetch: async () => {
        if (fetchFailure) throw fetchFailure;
        return { id: 'm-1', embeds: [] };
      },
      edit: async () => {
        throw editFailure;
      },
    },
  };
  f.client.channels.fetch = (async (id: string) => (id === 'ch-vote' ? channel : null)) as never;

  // Tin đã bị xoá — phát hiện ngay khi đọc tin.
  fetchFailure = discordError(RESTJSONErrorCodes.UnknownMessage, 404, 'Unknown Message');
  const goneOnFetch = await n.closeVote('m-1', 'x').catch((err: unknown) => err);
  expect(goneOnFetch).toBeInstanceOf(MessageGoneError);
  expect((goneOnFetch as Error).message).toContain('m-1');
  expect((goneOnFetch as Error).cause).toBe(fetchFailure);

  // Hoặc xoá đúng giữa lúc đọc và sửa.
  fetchFailure = undefined;
  editFailure = discordError(RESTJSONErrorCodes.UnknownMessage, 404, 'Unknown Message');
  const goneOnEdit = await n.closeVote('m-1', 'x').catch((err: unknown) => err);
  expect(goneOnEdit).toBeInstanceOf(MessageGoneError);
  expect((goneOnEdit as Error).cause).toBe(editFailure);

  // Lỗi Discord khác và lỗi thường: ném nguyên vẹn.
  editFailure = discordError(RESTJSONErrorCodes.MissingPermissions, 403, 'Missing Permissions');
  await expect(n.closeVote('m-1', 'x')).rejects.toBe(editFailure);
  fetchFailure = new Error('mạng rớt');
  await expect(n.closeVote('m-1', 'x')).rejects.toBe(fetchFailure);
  expect(f.edited).toEqual([]);
});

test('a missing or non-text vote channel is an error (service retries later)', async () => {
  const missing = new DiscordJsNotifier(fakeClient({}).client, testConfig());
  await expect(missing.publishVote(prompt)).rejects.toThrow('ch-vote');
  await expect(missing.closeVote('m-1', 'x')).rejects.toThrow('ch-vote');

  const voice = new DiscordJsNotifier(fakeClient({ 'ch-vote': { isSendable: () => false } }).client, testConfig());
  await expect(voice.publishVote(prompt)).rejects.toThrow('ch-vote');
});
