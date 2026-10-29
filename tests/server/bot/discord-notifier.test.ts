import { DiscordAPIError, GuildPremiumTier, RESTJSONErrorCodes } from 'discord.js';
import type { APIEmbed, Client } from 'discord.js';
import { expect, test } from 'vitest';
import { DiscordJsNotifier } from '../../../src/server/bot/discord-notifier.js';
import { buildBountyBoardMessage, buildSessionMessage, buildVoteMessage } from '../../../src/server/bot/embeds.js';
import type { Config } from '../../../src/server/config.js';
import { HighlightChannelError, HighlightRejectedTooLargeError, MessageGoneError } from '../../../src/server/ports.js';
import type { BountyBoardView, HighlightPost, SessionView, VotePrompt } from '../../../src/server/ports.js';
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
  const deleted: { channelId: string; messageId: string }[] = [];
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
      delete: async (messageId: string) => {
        deleted.push({ channelId, messageId });
      },
    },
  });
  const client = {
    channels: { fetch: async (id: string) => channels[id] ?? null },
    guilds: { fetch: async (id: string) => ({ id, premiumTier: GuildPremiumTier.None }) },
  } as unknown as Client;
  return { client, sent, edited, fetched, deleted, sendable };
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

// ---------------------------------------------------------------------------
// Highlight
// ---------------------------------------------------------------------------

const post: HighlightPost = {
  memberName: 'An **Vịt** _bay_',
  roleLabel: '🦆 Vịt',
  valueText: '3 mạng đã giết',
  playedOnText: '10/10/2026',
  fileName: 'highlight-7.mp4',
  data: Buffer.from('\0\0\0\x18ftypisom', 'latin1'),
};

/** Cấu hình test có kênh highlight `ch-highlight` (hoặc tắt tính năng với `null`). */
function withHighlight(channelId: string | null): Config {
  const config = testConfig();
  config.discord.highlightChannelId = channelId;
  return config;
}

test('announce posts the text to the announce channel with every mention disabled', async () => {
  const f = fakeClient({});
  const n = new DiscordJsNotifier(f.client, testConfig());
  f.client.channels.fetch = (async (id: string) => (id === 'ch-announce' ? f.sendable(id) : null)) as never;

  // Tên người tự đặt có thể trông như @mention — gửi nguyên văn nhưng không ping ai.
  const text = '🏅 Danh hiệu tháng 10/2026\n👑 SMVP: @everyone <@123> (2 lần MVP)';
  await n.announce(text);
  expect(f.sent).toEqual([{ channelId: 'ch-announce', payload: { content: text, allowedMentions: { parse: [] } } }]);
});

test('a missing or non-text announce channel is an error (service keeps its pending flag)', async () => {
  const missing = new DiscordJsNotifier(fakeClient({}).client, testConfig());
  await expect(missing.announce('x')).rejects.toThrow(/Kênh thông báo ch-announce/);

  const voice = new DiscordJsNotifier(fakeClient({ 'ch-announce': { isSendable: () => false } }).client, testConfig());
  await expect(voice.announce('x')).rejects.toThrow(/Kênh thông báo ch-announce/);
});

test('postHighlight sends the file with the caption line (name escaped, no mentions) and returns its location', async () => {
  const f = fakeClient({});
  const n = new DiscordJsNotifier(f.client, withHighlight('ch-highlight'));
  f.client.channels.fetch = (async (id: string) => (id === 'ch-highlight' ? f.sendable(id) : null)) as never;

  expect(await n.postHighlight(post)).toEqual({ channelId: 'ch-highlight', messageId: 'm-1' });
  expect(f.sent).toEqual([
    {
      channelId: 'ch-highlight',
      payload: {
        content: '🎬 Highlight — **An \\*\\*Vịt\\*\\* \\_bay\\_** · 🦆 Vịt · 3 mạng đã giết · 10/10/2026',
        files: [{ attachment: post.data, name: 'highlight-7.mp4' }],
        allowedMentions: { parse: [] },
      },
    },
  ]);
});

test('postHighlight fails when the channel is not configured, missing or not a text channel', async () => {
  const off = new DiscordJsNotifier(fakeClient({}).client, withHighlight(null));
  await expect(off.postHighlight(post)).rejects.toThrow(/highlight/);
  await expect(off.postHighlight(post)).rejects.toBeInstanceOf(HighlightChannelError);

  const missing = new DiscordJsNotifier(fakeClient({}).client, withHighlight('ch-highlight'));
  await expect(missing.postHighlight(post)).rejects.toThrow('ch-highlight');
  await expect(missing.postHighlight(post)).rejects.toBeInstanceOf(HighlightChannelError);

  const voice = new DiscordJsNotifier(fakeClient({ 'ch-highlight': { isSendable: () => false } }).client, withHighlight('ch-highlight'));
  await expect(voice.postHighlight(post)).rejects.toThrow('ch-highlight');
  await expect(voice.postHighlight(post)).rejects.toBeInstanceOf(HighlightChannelError);
});

test('postHighlight maps permanent Discord refusals to typed errors and passes the rest through', async () => {
  let failure: unknown;
  const channel = {
    isSendable: () => true,
    send: async () => {
      throw failure;
    },
  };
  const f = fakeClient({ 'ch-highlight': channel });
  const n = new DiscordJsNotifier(f.client, withHighlight('ch-highlight'));
  const outcome = () => n.postHighlight(post).then(
    () => null,
    (err: unknown) => err,
  );

  // Thiếu quyền (Attach Files / Send Messages), mất quyền xem, kênh đã bị xoá → lỗi kênh, giữ lỗi gốc ở `cause`.
  for (const [code, status, message] of [
    [RESTJSONErrorCodes.MissingPermissions, 403, 'Missing Permissions'],
    [RESTJSONErrorCodes.MissingAccess, 403, 'Missing Access'],
    [RESTJSONErrorCodes.UnknownChannel, 404, 'Unknown Channel'],
  ] as const) {
    failure = discordError(code, status, message);
    const err = await outcome();
    expect(err, message).toBeInstanceOf(HighlightChannelError);
    expect((err as Error).cause, message).toBe(failure);
  }
  // Kênh lấy không được (bị xoá) ngay ở bước tìm kênh → cũng là lỗi kênh.
  const gone = discordError(RESTJSONErrorCodes.UnknownChannel, 404, 'Unknown Channel');
  const g = fakeClient({});
  g.client.channels.fetch = (async () => {
    throw gone;
  }) as never;
  await expect(new DiscordJsNotifier(g.client, withHighlight('ch-highlight')).postHighlight(post)).rejects.toBeInstanceOf(HighlightChannelError);

  // File quá lớn: mã 40005, hay 413 mà thân lỗi không có mã.
  failure = discordError(RESTJSONErrorCodes.RequestEntityTooLarge, 413, 'Request entity too large');
  expect(await outcome()).toBeInstanceOf(HighlightRejectedTooLargeError);
  // Thân lỗi không phải JSON (trang 413 của proxy): discord.js giữ thân thô, không có mã.
  failure = new DiscordAPIError(new ArrayBuffer(0) as never, undefined as never, 413, 'POST', url, {});
  expect(await outcome()).toBeInstanceOf(HighlightRejectedTooLargeError);

  // Lỗi khác (mạng, giới hạn tốc độ, Discord 5xx…) ném nguyên vẹn → service báo "thử lại sau".
  failure = new Error('mạng rớt');
  expect(await outcome()).toBe(failure);
  failure = discordError(RESTJSONErrorCodes.UnknownMessage, 404, 'Unknown Message');
  expect(await outcome()).toBe(failure);
});

test('highlightUploadLimit follows the guild boost tier: 10 MiB up to tier 1, 50 MiB from tier 2', async () => {
  const f = fakeClient({});
  const n = new DiscordJsNotifier(f.client, testConfig());
  const guildIds: string[] = [];
  let tier = GuildPremiumTier.None;
  f.client.guilds.fetch = (async (id: string) => {
    guildIds.push(id);
    return { id, premiumTier: tier };
  }) as never;

  expect(await n.highlightUploadLimit()).toBe(10_485_760);
  tier = GuildPremiumTier.Tier1;
  expect(await n.highlightUploadLimit()).toBe(10_485_760);
  tier = GuildPremiumTier.Tier2;
  expect(await n.highlightUploadLimit()).toBe(52_428_800);
  tier = GuildPremiumTier.Tier3;
  expect(await n.highlightUploadLimit()).toBe(52_428_800);
  expect(guildIds).toEqual(['test-guild', 'test-guild', 'test-guild', 'test-guild']);

  const failing = new Error('mạng rớt');
  f.client.guilds.fetch = (async () => {
    throw failing;
  }) as never;
  await expect(n.highlightUploadLimit()).rejects.toBe(failing);
});

test('deleteMessage deletes in the given channel, treats a vanished message as done and passes other errors through', async () => {
  const f = fakeClient({});
  const n = new DiscordJsNotifier(f.client, withHighlight('ch-highlight'));
  f.client.channels.fetch = (async (id: string) => (id === 'ch-old' ? f.sendable(id) : null)) as never;

  // Xoá theo kênh được truyền vào (kênh highlight cũ), không phải kênh đang cấu hình.
  await n.deleteMessage('ch-old', 'm-3');
  expect(f.deleted).toEqual([{ channelId: 'ch-old', messageId: 'm-3' }]);

  let failure: unknown;
  const channel = {
    isSendable: () => true,
    messages: {
      delete: async () => {
        throw failure;
      },
    },
  };
  f.client.channels.fetch = (async (id: string) => (id === 'ch-old' ? channel : null)) as never;

  // Tin đã bị xoá tay: coi như xong.
  failure = discordError(RESTJSONErrorCodes.UnknownMessage, 404, 'Unknown Message');
  await expect(n.deleteMessage('ch-old', 'm-3')).resolves.toBeUndefined();

  // Lỗi khác (thiếu quyền, mạng): ném nguyên vẹn — nơi gọi quyết định ghi log.
  failure = discordError(RESTJSONErrorCodes.MissingPermissions, 403, 'Missing Permissions');
  await expect(n.deleteMessage('ch-old', 'm-3')).rejects.toBe(failure);
  failure = new Error('mạng rớt');
  await expect(n.deleteMessage('ch-old', 'm-3')).rejects.toBe(failure);

  // Kênh không còn: tin cũng không còn → coi như xong.
  f.client.channels.fetch = (async () => {
    throw discordError(RESTJSONErrorCodes.UnknownChannel, 404, 'Unknown Channel');
  }) as never;
  await expect(n.deleteMessage('ch-gone', 'm-3')).resolves.toBeUndefined();
});

// ---------------------------------------------------------------------------
// Treo thưởng
// ---------------------------------------------------------------------------

const board: BountyBoardView = {
  sessionId: 5,
  startsAt: new Date('2026-10-22T14:00:00Z'),
  modeName: 'Cổ điển (Classic)',
  status: 'scheduled',
  bounties: [{ id: 1, title: 'Sống sót', description: null, points: 3, icon: '🎯' }],
};

function withBounty(channelId: string | null): Config {
  const config = testConfig();
  config.discord.bountyChannelId = channelId;
  return config;
}

test('postBountyCompleted posts the escaped line to the bounty channel without pinging anyone', async () => {
  const f = fakeClient({});
  f.client.channels.fetch = (async (id: string) => (id === 'ch-bounty' ? f.sendable(id) : null)) as never;
  const n = new DiscordJsNotifier(f.client, withBounty('ch-bounty'));

  await n.postBountyCompleted({ memberName: 'An *Vịt* @everyone', bountyTitle: 'Giết_3_ngỗng', points: 5 });
  expect(f.sent).toEqual([
    {
      channelId: 'ch-bounty',
      payload: { content: '✅ An \\*Vịt\\* @everyone hoàn thành **Giết\\_3\\_ngỗng** +5', allowedMentions: { parse: [] } },
    },
  ]);
});

test('postBountyCompleted does nothing without DISCORD_BOUNTY_CHANNEL_ID; a broken channel is an error', async () => {
  const f = fakeClient({});
  const off = new DiscordJsNotifier(f.client, withBounty(null));
  await off.postBountyCompleted({ memberName: 'An', bountyTitle: 'X', points: 1 });
  expect(f.sent).toEqual([]);

  const missing = new DiscordJsNotifier(fakeClient({}).client, withBounty('ch-bounty'));
  await expect(missing.postBountyCompleted({ memberName: 'An', bountyTitle: 'X', points: 1 })).rejects.toThrow('ch-bounty');
});

test('publishBountyBoard posts the built board in the given channel; updateBountyBoard edits it there', async () => {
  const f = fakeClient({});
  f.client.channels.fetch = (async (id: string) => (id === 'ch-b' ? f.sendable(id) : null)) as never;
  const n = new DiscordJsNotifier(f.client, withBounty('ch-bounty'));

  expect(await n.publishBountyBoard('ch-b', board)).toBe('m-1');
  expect(f.sent).toEqual([{ channelId: 'ch-b', payload: buildBountyBoardMessage(board) }]);

  const cancelled: BountyBoardView = { ...board, status: 'cancelled', bounties: [] };
  await n.updateBountyBoard('ch-b', 'm-1', cancelled);
  expect(f.edited).toEqual([{ channelId: 'ch-b', messageId: 'm-1', payload: buildBountyBoardMessage(cancelled) }]);
});

test('updateBountyBoard maps a vanished message or channel to MessageGoneError and passes other errors through', async () => {
  const f = fakeClient({});
  const n = new DiscordJsNotifier(f.client, withBounty('ch-bounty'));
  let failure: unknown;
  const channel = {
    isSendable: () => true,
    messages: {
      edit: async () => {
        throw failure;
      },
    },
  };
  f.client.channels.fetch = (async (id: string) => (id === 'ch-b' ? channel : null)) as never;

  failure = discordError(RESTJSONErrorCodes.UnknownMessage, 404, 'Unknown Message');
  await expect(n.updateBountyBoard('ch-b', 'm-1', board)).rejects.toBeInstanceOf(MessageGoneError);
  failure = discordError(RESTJSONErrorCodes.MissingPermissions, 403, 'Missing Permissions');
  await expect(n.updateBountyBoard('ch-b', 'm-1', board)).rejects.toBe(failure);

  f.client.channels.fetch = (async () => {
    throw discordError(RESTJSONErrorCodes.UnknownChannel, 404, 'Unknown Channel');
  }) as never;
  await expect(n.updateBountyBoard('ch-b', 'm-1', board)).rejects.toBeInstanceOf(MessageGoneError);
});
