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
  /** Số lần tra theo tên (nhóm hoặc kênh) — để thấy kênh giữ theo ID không cần tra tên. */
  const lookups = { byName: 0 };
  let next = 900;
  const admin: ChannelAdmin = {
    textChannelById: async (id) => {
      const channel = channels.find((c) => c.kind === 'text' && c.id === id);
      return channel ? { id: channel.id, parentId: channel.parentId } : null;
    },
    findCategory: async (name) => {
      lookups.byName += 1;
      return channels.find((c) => c.kind === 'category' && sameChannelName(c.name, name))?.id ?? null;
    },
    createCategory: async (name) => {
      const id = String(next++);
      channels.push({ id, name, kind: 'category', parentId: null });
      created.push(name);
      return id;
    },
    findTextChannel: async (name, categoryId) => {
      lookups.byName += 1;
      return channels.find((c) => c.kind === 'text' && c.parentId === categoryId && sameChannelName(c.name, name))?.id ?? null;
    },
    createTextChannel: async (plan: ChannelPlan, categoryId) => {
      const id = String(next++);
      channels.push({ id, name: plan.name, kind: 'text', parentId: categoryId });
      created.push(plan.name);
      return id;
    },
  };
  return { admin, created, channels, lookups };
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

// ---------------------------------------------------------------------------
// ID kênh đã có trong .env (chạy lại trên máy đang chạy)
// ---------------------------------------------------------------------------

test('channels already in .env are kept by ID even after renaming; only #highlight is created, in their category', async () => {
  // Admin đã đổi tên cả nhóm lẫn ba kênh: tra theo tên sẽ không thấy gì và tạo trùng cả bộ.
  const { admin, created, channels } = fakeAdmin([
    { id: '20', name: 'Hội Ngỗng', kind: 'category', parentId: null },
    { id: '21', name: 'lịch', kind: 'text', parentId: '20' },
    { id: '22', name: 'bình-chọn', kind: 'text', parentId: '20' },
    { id: '23', name: 'loa', kind: 'text', parentId: '20' },
  ]);
  const result = await ensureChannels(admin, {
    DISCORD_SCHEDULE_CHANNEL_ID: '21',
    DISCORD_VOTE_CHANNEL_ID: '22',
    DISCORD_ANNOUNCE_CHANNEL_ID: '23',
  });

  expect(created).toEqual(['highlight']); // không tạo nhóm "GGD Hub", không tạo lại ba kênh
  expect(channels.find((c) => c.name === 'highlight')?.parentId).toBe('20');
  expect(result.categoryId).toBe('20');
  expect(result.categoryCreated).toBe(false);
  expect(result.channels.map((c) => [c.envKey, c.created, c.keptById])).toEqual([
    ['DISCORD_SCHEDULE_CHANNEL_ID', false, true],
    ['DISCORD_VOTE_CHANNEL_ID', false, true],
    ['DISCORD_ANNOUNCE_CHANNEL_ID', false, true],
    ['DISCORD_HIGHLIGHT_CHANNEL_ID', true, false],
  ]);
  expect(envLines(result)).toEqual([
    'DISCORD_SCHEDULE_CHANNEL_ID=21',
    'DISCORD_VOTE_CHANNEL_ID=22',
    'DISCORD_ANNOUNCE_CHANNEL_ID=23',
    'DISCORD_HIGHLIGHT_CHANNEL_ID=900',
  ]);
});

test('a known ID that no longer resolves to a text channel falls back to the name lookup or creation', async () => {
  const { admin, created, channels } = fakeAdmin([
    { id: '10', name: 'GGD Hub', kind: 'category', parentId: null },
    { id: '11', name: 'lịch-chơi', kind: 'text', parentId: '10' },
    { id: '12', name: 'vote-mvp', kind: 'text', parentId: '10' },
  ]);
  const result = await ensureChannels(admin, {
    DISCORD_SCHEDULE_CHANNEL_ID: '99', // kênh đã bị xoá → tìm theo tên, thấy #lịch-chơi
    DISCORD_VOTE_CHANNEL_ID: '12',
    DISCORD_ANNOUNCE_CHANNEL_ID: '98', // đã bị xoá, không có kênh cùng tên → tạo mới
    DISCORD_HIGHLIGHT_CHANNEL_ID: '10', // là nhóm kênh, không phải kênh văn bản → tạo mới
  });

  expect(created).toEqual(['thông-báo', 'highlight']);
  expect(channels.filter((c) => created.includes(c.name)).map((c) => c.parentId)).toEqual(['10', '10']);
  expect(result.channels.map((c) => [c.created, c.keptById])).toEqual([
    [false, false],
    [false, true],
    [true, false],
    [true, false],
  ]);
  expect(envLines(result)).toEqual([
    'DISCORD_SCHEDULE_CHANNEL_ID=11',
    'DISCORD_VOTE_CHANNEL_ID=12',
    'DISCORD_ANNOUNCE_CHANNEL_ID=900',
    'DISCORD_HIGHLIGHT_CHANNEL_ID=901',
  ]);
});

test('kept channels outside any category: missing ones go into the "GGD Hub" category, found or created by name', async () => {
  const { admin, created, channels } = fakeAdmin([{ id: '31', name: 'chung', kind: 'text', parentId: null }]);
  // Server nhỏ dùng chung một kênh (không nằm trong nhóm nào) cho cả ba kênh bắt buộc.
  const result = await ensureChannels(admin, {
    DISCORD_SCHEDULE_CHANNEL_ID: '31',
    DISCORD_VOTE_CHANNEL_ID: ' 31 ',
    DISCORD_ANNOUNCE_CHANNEL_ID: '31',
    DISCORD_HIGHLIGHT_CHANNEL_ID: '   ', // trống = chưa biết
  });

  expect(created).toEqual([CATEGORY_NAME, 'highlight']);
  expect(result.categoryCreated).toBe(true);
  expect(channels.find((c) => c.name === 'highlight')?.parentId).toBe(result.categoryId);
  expect(envLines(result)).toEqual([
    'DISCORD_SCHEDULE_CHANNEL_ID=31',
    'DISCORD_VOTE_CHANNEL_ID=31',
    'DISCORD_ANNOUNCE_CHANNEL_ID=31',
    'DISCORD_HIGHLIGHT_CHANNEL_ID=901',
  ]);
});

test('all four channels known: nothing is looked up by name and no category is touched', async () => {
  const { admin, created, lookups } = fakeAdmin([
    { id: '41', name: 'a', kind: 'text', parentId: null },
    { id: '42', name: 'b', kind: 'text', parentId: null },
    { id: '43', name: 'c', kind: 'text', parentId: null },
    { id: '44', name: 'd', kind: 'text', parentId: null },
  ]);
  const result = await ensureChannels(admin, {
    DISCORD_SCHEDULE_CHANNEL_ID: '41',
    DISCORD_VOTE_CHANNEL_ID: '42',
    DISCORD_ANNOUNCE_CHANNEL_ID: '43',
    DISCORD_HIGHLIGHT_CHANNEL_ID: '44',
  });

  expect(created).toEqual([]);
  expect(lookups.byName).toBe(0);
  expect(result.categoryId).toBeNull();
  expect(result.categoryCreated).toBe(false);
  expect(result.channels.every((c) => c.keptById && !c.created)).toBe(true);
  expect(envLines(result)).toEqual([
    'DISCORD_SCHEDULE_CHANNEL_ID=41',
    'DISCORD_VOTE_CHANNEL_ID=42',
    'DISCORD_ANNOUNCE_CHANNEL_ID=43',
    'DISCORD_HIGHLIGHT_CHANNEL_ID=44',
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
