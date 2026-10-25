import { expect, test } from 'vitest';
import {
  CATEGORY_NAME,
  CHANNELS,
  ensureChannels,
  envLines,
  sameChannelName,
  type ChannelAdmin,
  type ChannelPlan,
} from '../../src/server/tools/discord-channels';

interface FakeChannel {
  id: string;
  name: string;
  kind: 'category' | 'text';
  parentId: string | null;
}

function fakeAdmin(initial: FakeChannel[] = []) {
  const channels = [...initial];
  const created: string[] = [];
  let next = 900;
  const admin: ChannelAdmin = {
    findCategory: async (name) =>
      channels.find((c) => c.kind === 'category' && sameChannelName(c.name, name))?.id ?? null,
    createCategory: async (name) => {
      const id = String(next++);
      channels.push({ id, name, kind: 'category', parentId: null });
      created.push(name);
      return id;
    },
    findTextChannel: async (name, categoryId) =>
      channels.find((c) => c.kind === 'text' && c.parentId === categoryId && sameChannelName(c.name, name))?.id ?? null,
    createTextChannel: async (plan: ChannelPlan, categoryId) => {
      const id = String(next++);
      channels.push({ id, name: plan.name, kind: 'text', parentId: categoryId });
      created.push(plan.name);
      return id;
    },
  };
  return { admin, created };
}

test('an empty server gets the category and all four channels inside it', async () => {
  const { admin, created } = fakeAdmin();
  const result = await ensureChannels(admin);

  expect(created).toEqual([CATEGORY_NAME, 'lịch-chơi', 'vote-mvp', 'thông-báo', 'highlight']);
  expect(result.categoryCreated).toBe(true);
  expect(result.channels.every((c) => c.created)).toBe(true);
  expect(envLines(result)).toEqual([
    'DISCORD_SCHEDULE_CHANNEL_ID=901',
    'DISCORD_VOTE_CHANNEL_ID=902',
    'DISCORD_ANNOUNCE_CHANNEL_ID=903',
    'DISCORD_HIGHLIGHT_CHANNEL_ID=904',
  ]);
});

test('running again reuses everything and creates nothing', async () => {
  const { admin, created } = fakeAdmin();
  const first = await ensureChannels(admin);
  created.length = 0;
  // Lần hai trên cùng server (đã có đủ nhóm và kênh).
  const second = await ensureChannels(admin);

  expect(created).toEqual([]);
  expect(second.categoryCreated).toBe(false);
  expect(second.channels.every((c) => !c.created)).toBe(true);
  expect(envLines(second)).toEqual(envLines(first));
});

test('only the missing channels are created; names match regardless of case', async () => {
  const { admin, created } = fakeAdmin([
    { id: '10', name: 'ggd hub', kind: 'category', parentId: null },
    { id: '11', name: 'LỊCH-CHƠI', kind: 'text', parentId: '10' },
    { id: '12', name: 'thông-báo', kind: 'text', parentId: '10' },
    // Cùng tên nhưng nằm ngoài nhóm → không tính.
    { id: '13', name: 'vote-mvp', kind: 'text', parentId: null },
  ]);
  const result = await ensureChannels(admin);

  expect(created).toEqual(['vote-mvp', 'highlight']);
  expect(result.categoryId).toBe('10');
  expect(envLines(result)).toEqual([
    'DISCORD_SCHEDULE_CHANNEL_ID=11',
    expect.stringMatching(/^DISCORD_VOTE_CHANNEL_ID=9\d\d$/),
    'DISCORD_ANNOUNCE_CHANNEL_ID=12',
    expect.stringMatching(/^DISCORD_HIGHLIGHT_CHANNEL_ID=9\d\d$/),
  ]);
});

test('a server set up before #highlight existed gets only that channel added', async () => {
  // Máy chủ đang chạy bản cũ: đã có nhóm và ba kênh đầu, chạy lại script chỉ thêm #highlight.
  const { admin, created } = fakeAdmin([
    { id: '10', name: 'GGD Hub', kind: 'category', parentId: null },
    { id: '11', name: 'lịch-chơi', kind: 'text', parentId: '10' },
    { id: '12', name: 'vote-mvp', kind: 'text', parentId: '10' },
    { id: '13', name: 'thông-báo', kind: 'text', parentId: '10' },
  ]);
  const result = await ensureChannels(admin);

  expect(created).toEqual(['highlight']);
  expect(result.categoryCreated).toBe(false);
  expect(result.channels.map((c) => c.created)).toEqual([false, false, false, true]);
  expect(envLines(result)).toEqual([
    'DISCORD_SCHEDULE_CHANNEL_ID=11',
    'DISCORD_VOTE_CHANNEL_ID=12',
    'DISCORD_ANNOUNCE_CHANNEL_ID=13',
    'DISCORD_HIGHLIGHT_CHANNEL_ID=900',
  ]);
});

test('the plan covers exactly the four channel variables the app needs', () => {
  expect(CHANNELS.map((c) => c.envKey)).toEqual([
    'DISCORD_SCHEDULE_CHANNEL_ID',
    'DISCORD_VOTE_CHANNEL_ID',
    'DISCORD_ANNOUNCE_CHANNEL_ID',
    'DISCORD_HIGHLIGHT_CHANNEL_ID',
  ]);
});

test('only #highlight grants the bot Attach Files', () => {
  expect(CHANNELS.filter((c) => c.botAttachFiles).map((c) => c.envKey)).toEqual(['DISCORD_HIGHLIGHT_CHANNEL_ID']);
  expect(CHANNELS.find((c) => c.envKey === 'DISCORD_HIGHLIGHT_CHANNEL_ID')?.name).toBe('highlight');
});
