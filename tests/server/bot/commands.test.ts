import type { Member, PrismaClient } from '@prisma/client';
import { ApplicationCommandOptionType, MessageFlags } from 'discord.js';
import type { APIEmbed } from 'discord.js';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { commandDefinitions, filterRoleChoices, parseDayInput } from '../../../src/server/bot/commands.js';
import type { GuildMemberSource } from '../../../src/server/bot/guild-directory.js';
import { handleInteraction } from '../../../src/server/bot/interactions.js';
import type {
  AutocompleteInteractionLike,
  CommandInteractionLike,
  ComponentInteractionLike,
  InteractionLike,
  ReplyPayload,
  SelectMenuInteractionLike,
} from '../../../src/server/bot/interactions.js';
import type { Ctx } from '../../../src/server/ctx.js';
import { listRoles } from '../../../src/server/modules/roles/service.js';
import { reviewReport, submitReport } from '../../../src/server/modules/stats/reports.js';
import type { RoleDto } from '../../../src/shared/api-types.js';
import { makeTestCtx } from '../../helpers/ctx.js';
import { resetDb, testDb } from '../../helpers/db.js';
import { createMember, roleByKey } from '../../helpers/factories.js';
import type { FakeNotifier } from '../../helpers/fakes.js';

let ctx: Ctx;
let notifier: FakeNotifier;
let errors: ReturnType<typeof vi.spyOn>;
let warns: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  await resetDb();
  ({ ctx, notifier } = makeTestCtx());
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  warns = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

// ---------------------------------------------------------------------------
// Định nghĩa lệnh
// ---------------------------------------------------------------------------

test('definitions are valid for Discord', () => {
  const defs = commandDefinitions();
  expect(defs.map((d) => d.name)).toEqual(['baocao', 'bxh', 'hoso']);
  for (const d of defs) {
    expect(d.name).toMatch(/^[a-z0-9_-]{1,32}$/);
    expect(d.description.length).toBeGreaterThanOrEqual(1);
    expect(d.description.length).toBeLessThanOrEqual(100);
    expect(d.dm_permission).toBe(false);
    // Tuỳ chọn bắt buộc phải đứng trước tuỳ chọn không bắt buộc; mô tả ≤ 100 ký tự.
    let seenOptional = false;
    for (const o of d.options ?? []) {
      expect(o.name).toMatch(/^[a-z0-9_]{1,32}$/);
      expect(o.description.length).toBeGreaterThanOrEqual(1);
      expect(o.description.length).toBeLessThanOrEqual(100);
      if (o.required) expect(seenOptional).toBe(false);
      else seenOptional = true;
    }
  }

  const [baocao, bxh, hoso] = defs;
  expect(baocao?.options).toHaveLength(5);
  // `so_lieu_phu` (chỉ số phụ, không bắt buộc) đứng ngay sau `so_lieu` (spec chỉ số phụ §6).
  expect(baocao?.options?.map((o) => o.name)).toEqual(['role', 'so_lieu', 'so_lieu_phu', 'ngay', 'ghi_chu']);
  expect(baocao?.options?.[0]).toMatchObject({ type: ApplicationCommandOptionType.String, required: true, autocomplete: true });
  expect(baocao?.options?.[1]).toMatchObject({ type: ApplicationCommandOptionType.Integer, required: true, min_value: 0, max_value: 100 });
  expect(baocao?.options?.[2]).toMatchObject({ type: ApplicationCommandOptionType.Integer, min_value: 0, max_value: 100 });
  expect(baocao?.options?.[2]?.required ?? false).toBe(false);
  expect(baocao?.options?.[3]).toMatchObject({ type: ApplicationCommandOptionType.String });
  expect(baocao?.options?.[3]?.required ?? false).toBe(false);
  expect(baocao?.options?.[4]).toMatchObject({ type: ApplicationCommandOptionType.String, max_length: 300 });
  expect(baocao?.options?.[4]?.required ?? false).toBe(false);

  expect(bxh?.options).toHaveLength(1);
  expect(bxh?.options?.[0]).toMatchObject({ type: ApplicationCommandOptionType.String, name: 'role', required: true, autocomplete: true });
  expect(hoso?.options ?? []).toEqual([]);
});

// ---------------------------------------------------------------------------
// Gợi ý role
// ---------------------------------------------------------------------------

/** RoleDto tối giản cho test thuần (không cần DB); không có chỉ số phụ. */
function role(key: string, nameVi: string, nameEn = key, icon = '🎲', metricLabel = 'Số điểm'): RoleDto {
  return {
    id: 0,
    key,
    faction: 'goose',
    nameVi,
    nameEn,
    description: '',
    metricLabel,
    maxPerGame: 10,
    extraMetricLabel: null,
    extraMaxPerGame: null,
    extraPoints: null,
    mapNote: null,
    modeKey: null,
    icon,
    hasImage: false,
    active: true,
    sortOrder: 0,
  };
}

/** Ám sát như seed: chỉ số chính "Số mạng đã giết" (tối đa 15), chỉ số phụ "Số lần ám sát trong cuộc họp" (tối đa 2, +3). */
const assassinRole: RoleDto = {
  ...role('assassin', 'Ám sát', 'Assassin', '🗡️', 'Số mạng đã giết'),
  faction: 'duck',
  maxPerGame: 15,
  extraMetricLabel: 'Số lần ám sát trong cuộc họp',
  extraMaxPerGame: 2,
  extraPoints: 3,
};

test('role search ignores diacritics', async () => {
  const roles = await listRoles(ctx);
  expect(filterRoleChoices(roles, 'kiem si')[0]).toEqual({ name: '⚔️ Kiếm sĩ — Số mạng chém', value: 'swordsman' });
  expect(filterRoleChoices(roles, 'KIẾM')[0]?.value).toBe('swordsman');
  expect(filterRoleChoices(roles, 'cuckoo')[0]?.value).toBe('cuckoo');
  expect(filterRoleChoices(roles, 'Cò gáy')[0]?.value).toBe('cuckoo');
  expect(filterRoleChoices(roles, '').length).toBeLessThanOrEqual(25);
  // Chuỗi trống → 25 role đầu theo thứ tự danh mục.
  expect(filterRoleChoices(roles, '').map((c) => c.value)).toEqual(roles.slice(0, 25).map((r) => r.key));
  expect(filterRoleChoices(roles, 'khong co role nao ten nay')).toEqual([]);
});

test('role search ranks nameVi prefix matches first, matches key and nameEn, caps at 25 and clips long names', () => {
  const hunter = role('goose_hunter', 'Kẻ săn ngỗng', 'Goose Hunter');
  const goose = role('goose', 'Ngỗng', 'Goose', '🪿', 'Số lần vote trúng Vịt');
  const duck = role('duck', 'Vịt', 'Duck');
  // "ngong" khớp cả hai; "Ngỗng" bắt đầu bằng nó nên xếp trước dù đứng sau trong danh sách.
  expect(filterRoleChoices([hunter, goose, duck], 'ngong').map((c) => c.value)).toEqual(['goose', 'goose_hunter']);
  // Khớp theo key và tên tiếng Anh, không phân biệt hoa thường.
  expect(filterRoleChoices([hunter, goose, duck], 'HUNTER').map((c) => c.value)).toEqual(['goose_hunter']);
  expect(filterRoleChoices([hunter, goose, duck], 'duck').map((c) => c.value)).toEqual(['duck']);
  expect(filterRoleChoices([hunter, goose, duck], '  ngỗng  ').map((c) => c.value)).toEqual(['goose', 'goose_hunter']);
  // Tên gợi ý = "{icon} {nameVi} — {metricLabel}".
  expect(filterRoleChoices([goose], 'ngong')[0]?.name).toBe('🪿 Ngỗng — Số lần vote trúng Vịt');

  const many = Array.from({ length: 30 }, (_, i) => role(`r${i}`, `Role ${i}`));
  expect(filterRoleChoices(many, 'role')).toHaveLength(25);
  expect(filterRoleChoices(many, '')).toHaveLength(25);

  const long = role('long', 'A'.repeat(120), 'Long');
  const [choice] = filterRoleChoices([long], 'aaa');
  expect(choice?.value).toBe('long');
  expect([...(choice?.name ?? '')]).toHaveLength(100);
});

test('role choice names show the secondary metric in parentheses and are still clipped to 100 chars', () => {
  // Role có chỉ số phụ: "{icon} {tên} — {nhãn chính} (+ {nhãn phụ})" (spec chỉ số phụ §7).
  expect(filterRoleChoices([assassinRole], 'am sat')[0]).toEqual({
    name: '🗡️ Ám sát — Số mạng đã giết (+ Số lần ám sát trong cuộc họp)',
    value: 'assassin',
  });
  // Role thường không đổi.
  expect(filterRoleChoices([role('goose', 'Ngỗng', 'Goose', '🪿', 'Số lần vote trúng Vịt')], 'ngong')[0]?.name).toBe('🪿 Ngỗng — Số lần vote trúng Vịt');

  const longExtra: RoleDto = { ...assassinRole, extraMetricLabel: 'B'.repeat(120) };
  const [choice] = filterRoleChoices([longExtra], 'am sat');
  expect(choice?.value).toBe('assassin');
  expect(choice?.name.startsWith('🗡️ Ám sát — Số mạng đã giết (+ BBB')).toBe(true);
  expect([...(choice?.name ?? '')]).toHaveLength(100);
});

// ---------------------------------------------------------------------------
// Ngày chơi
// ---------------------------------------------------------------------------

test('day input', () => {
  expect(parseDayInput('31/10', '2026-11-02')).toBe('2026-10-31');
  expect(parseDayInput('31/12', '2027-01-01')).toBe('2026-12-31');
  expect(parseDayInput(undefined, '2026-11-02')).toBe('2026-11-02');
  expect(parseDayInput('hôm qua', '2026-11-02')).toBeNull();
});

test('day input accepts d/M and YYYY-MM-DD, trims, rejects impossible dates', () => {
  expect(parseDayInput('', '2026-11-02')).toBe('2026-11-02');
  expect(parseDayInput('   ', '2026-11-02')).toBe('2026-11-02');
  expect(parseDayInput(' 1/2 ', '2026-11-02')).toBe('2026-02-01');
  expect(parseDayInput('02/11', '2026-11-02')).toBe('2026-11-02'); // hôm nay không phải tương lai
  expect(parseDayInput('03/11', '2026-11-02')).toBe('2025-11-03'); // tương lai → năm trước
  expect(parseDayInput('2026-10-31', '2026-11-02')).toBe('2026-10-31');
  expect(parseDayInput('2026-11-30', '2026-11-02')).toBe('2026-11-30'); // dạng đầy đủ giữ nguyên năm
  for (const bad of ['30/02', '31/13', '0/10', '32/10', '2026-02-30', '2026-13-01', '26-10-31', '31-10-2026', '31/10/2026', 'abc', '1']) {
    expect(parseDayInput(bad, '2026-11-02'), bad).toBeNull();
  }
  // 29/02: năm nay có → được; tương lai mà năm trước không có ngày đó → không hợp lệ.
  expect(parseDayInput('29/02', '2028-03-01')).toBe('2028-02-29');
  expect(parseDayInput('29/02', '2028-01-15')).toBeNull();
  expect(parseDayInput('29/02', '2027-03-01')).toBeNull();
});

// ---------------------------------------------------------------------------
// Tương tác giả
// ---------------------------------------------------------------------------

/** GuildMember giả (kiểu cấu trúc) của người gõ lệnh. */
const guildMember = (id: string, name = `User ${id}`): GuildMemberSource => ({
  id,
  displayName: name,
  displayAvatarURL: () => `https://cdn.test/${id}.png`,
  roles: { cache: new Map([['test-guild', {}]]) },
  guild: { id: 'test-guild' },
});

type Step =
  | { step: 'defer'; ephemeral: boolean }
  | { step: 'edit'; content?: string; embeds?: APIEmbed[] }
  | { step: 'reply'; content: string; ephemeral: boolean };

type OptionValues = Record<string, string | number | undefined>;

/** Lệnh slash giả: ghi lại từng lời trả lời (ẩn hay công khai, chữ hay embed). */
class FakeCommand implements InteractionLike, CommandInteractionLike {
  steps: Step[] = [];

  constructor(
    public commandName: string,
    private readonly opts: { options?: OptionValues; guildId?: string | null; member?: GuildMemberSource | null } = {},
  ) {}

  get guildId(): string | null {
    return this.opts.guildId === undefined ? 'test-guild' : this.opts.guildId;
  }

  get member(): GuildMemberSource | null {
    return this.opts.member === undefined ? guildMember('u1', 'Người gõ') : this.opts.member;
  }

  options = {
    getString: (name: string): string | null => {
      const v = this.opts.options?.[name];
      return typeof v === 'string' ? v : null;
    },
    getInteger: (name: string): number | null => {
      const v = this.opts.options?.[name];
      return typeof v === 'number' ? v : null;
    },
  };

  isButton(): this is ComponentInteractionLike {
    return false;
  }

  isStringSelectMenu(): this is SelectMenuInteractionLike {
    return false;
  }

  isChatInputCommand(): this is CommandInteractionLike {
    return true;
  }

  isAutocomplete(): this is AutocompleteInteractionLike {
    return false;
  }

  inCachedGuild(): this is CommandInteractionLike & { member: GuildMemberSource } {
    return this.member !== null;
  }

  async deferReply(options?: { flags?: MessageFlags.Ephemeral }): Promise<void> {
    this.steps.push({ step: 'defer', ephemeral: options?.flags === MessageFlags.Ephemeral });
  }

  async editReply(payload: string | ReplyPayload): Promise<void> {
    if (typeof payload === 'string') this.steps.push({ step: 'edit', content: payload });
    else {
      const entry: Step = { step: 'edit' };
      if (payload.content !== undefined) entry.content = payload.content;
      if (payload.embeds !== undefined) entry.embeds = [...payload.embeds];
      this.steps.push(entry);
    }
  }

  async reply(options: { content: string; flags: MessageFlags.Ephemeral }): Promise<void> {
    this.steps.push({ step: 'reply', content: options.content, ephemeral: options.flags === MessageFlags.Ephemeral });
  }

  /** Nội dung chữ của lời trả lời cuối. */
  get lastText(): string | undefined {
    const last = this.steps.at(-1);
    return last && 'content' in last ? last.content : undefined;
  }
}

/** Autocomplete giả: ghi lại danh sách gợi ý đã trả. */
class FakeAutocomplete implements InteractionLike, AutocompleteInteractionLike {
  responses: { name: string; value: string }[][] = [];

  constructor(
    public commandName: string,
    private readonly focused: string,
    public guildId: string | null = 'test-guild',
  ) {}

  options = { getFocused: (): string => this.focused };

  isButton(): this is ComponentInteractionLike {
    return false;
  }

  isStringSelectMenu(): this is SelectMenuInteractionLike {
    return false;
  }

  isChatInputCommand(): this is CommandInteractionLike {
    return false;
  }

  isAutocomplete(): this is AutocompleteInteractionLike {
    return true;
  }

  async respond(choices: readonly { name: string; value: string }[]): Promise<void> {
    this.responses.push([...choices]);
  }
}

const baocao = (options: OptionValues, extra: { guildId?: string | null; member?: GuildMemberSource | null } = {}) =>
  new FakeCommand('baocao', { options, ...extra });

const presser = () => testDb.member.findUniqueOrThrow({ where: { discordId: 'u1' } });
const reports = () => testDb.statReport.findMany({ orderBy: { id: 'asc' } });

/** Khai rồi duyệt ngay cho `member` (role `roleKey`, `value` [+ `extraValue` chỉ số phụ]), bằng một mod riêng. */
async function approvedReport(member: Member, roleKey: string, value: number, extraValue = 0): Promise<void> {
  const mod = (await testDb.member.findFirst({ where: { accessLevel: 'mod' } })) ?? (await createMember(testDb, { accessLevel: 'mod', displayName: 'Mod' }));
  const r = await submitReport(ctx, member.id, { roleId: (await roleByKey(testDb, roleKey)).id, value, extraValue, playedOn: '2026-10-22' });
  await reviewReport(ctx, { id: mod.id, accessLevel: mod.accessLevel }, r.id, { approve: true });
}

// ---------------------------------------------------------------------------
// Autocomplete
// ---------------------------------------------------------------------------

test('autocomplete answers directly with active roles matching the typed text', async () => {
  const i = new FakeAutocomplete('baocao', 'kiem');
  await handleInteraction(ctx, i);
  expect(i.responses).toHaveLength(1);
  expect(i.responses[0]?.[0]).toEqual({ name: '⚔️ Kiếm sĩ — Số mạng chém', value: 'swordsman' });
  expect(i.responses[0]?.length).toBeLessThanOrEqual(25);

  // Role có chỉ số phụ (Ám sát trong seed) nêu cả hai nhãn.
  const assassin = new FakeAutocomplete('baocao', 'am sat');
  await handleInteraction(ctx, assassin);
  expect(assassin.responses[0]?.[0]).toEqual({ name: '🗡️ Ám sát — Số mạng đã giết (+ Số lần ám sát trong cuộc họp)', value: 'assassin' });

  const all = new FakeAutocomplete('bxh', '');
  await handleInteraction(ctx, all);
  expect(all.responses[0]).toHaveLength(25);

  // Role đang tắt (role riêng chế độ đặc biệt) không được gợi ý; bật lên thì có.
  const off = new FakeAutocomplete('baocao', 'inquisitor');
  await handleInteraction(ctx, off);
  expect(off.responses).toEqual([[]]);
  await testDb.role.update({ where: { key: 'inquisitor' }, data: { active: true } });
  const on = new FakeAutocomplete('baocao', 'inquisitor');
  await handleInteraction(ctx, on);
  expect(on.responses[0]?.map((c) => c.value)).toEqual(['inquisitor']);
  expect(errors).not.toHaveBeenCalled();
});

test('autocomplete errors are logged and answered with no choices', async () => {
  const broken: Ctx = {
    ...ctx,
    db: {
      role: {
        findMany: async () => {
          throw new Error('db secret');
        },
      },
    } as unknown as PrismaClient,
  };
  const i = new FakeAutocomplete('baocao', 'kiem');
  await handleInteraction(broken, i);
  expect(i.responses).toEqual([[]]);
  expect(errors).toHaveBeenCalledTimes(1);

  // Server lạ → không gợi ý gì.
  const other = new FakeAutocomplete('baocao', 'kiem', 'other-guild');
  await handleInteraction(ctx, other);
  expect(other.responses).toEqual([[]]);
});

// ---------------------------------------------------------------------------
// /baocao
// ---------------------------------------------------------------------------

test('/baocao defers ephemerally, upserts the caller, submits a pending report and confirms', async () => {
  const swordsman = await roleByKey(testDb, 'swordsman');
  const i = baocao({ role: 'swordsman', so_lieu: 5 });
  await handleInteraction(ctx, i);

  expect(i.steps).toEqual([
    { step: 'defer', ephemeral: true },
    { step: 'edit', content: 'Đã gửi: ⚔️ Kiếm sĩ — 5 mạng chém ngày 22/10. Chờ mod duyệt nhé!' },
  ]);
  const me = await presser();
  expect(me).toMatchObject({ displayName: 'Người gõ', avatarUrl: 'https://cdn.test/u1.png', status: 'active' });
  expect(await reports()).toEqual([
    expect.objectContaining({
      memberId: me.id,
      roleId: swordsman.id,
      value: 5,
      playedOn: new Date('2026-10-22T00:00:00Z'),
      sessionId: null,
      note: null,
      status: 'pending',
      createdAt: ctx.now(),
    }),
  ]);
  expect(errors).not.toHaveBeenCalled();
});

test('/baocao takes dd/MM or YYYY-MM-DD for the day and keeps the note', async () => {
  const i = baocao({ role: 'swordsman', so_lieu: 3, ngay: '21/10', ghi_chu: '  Trận cuối  ' });
  await handleInteraction(ctx, i);
  expect(i.lastText).toBe('Đã gửi: ⚔️ Kiếm sĩ — 3 mạng chém ngày 21/10. Chờ mod duyệt nhé!');
  expect((await reports())[0]).toMatchObject({ playedOn: new Date('2026-10-21T00:00:00Z'), note: 'Trận cuối' });

  const iso = baocao({ role: 'swordsman', so_lieu: 0, ngay: '2026-10-20' });
  await handleInteraction(ctx, iso);
  expect(iso.lastText).toBe('Đã gửi: ⚔️ Kiếm sĩ — 0 mạng chém ngày 20/10. Chờ mod duyệt nhé!');
  expect(await reports()).toHaveLength(2);
});

test('/baocao resolves a role typed as its exact Vietnamese name, ignoring case and diacritics', async () => {
  for (const typed of ['Kiếm sĩ', 'KIEM SI', '  kiếm sĩ ']) {
    const i = baocao({ role: typed, so_lieu: 1 });
    await handleInteraction(ctx, i);
    expect(i.lastText, typed).toBe('Đã gửi: ⚔️ Kiếm sĩ — 1 mạng chém ngày 22/10. Chờ mod duyệt nhé!');
  }
  expect(await reports()).toHaveLength(3);

  // Khớp một phần hay tên tiếng Anh thì không — chỉ key hoặc đúng tên tiếng Việt.
  for (const typed of ['Kiếm', 'Swordsman', 'khong_co']) {
    const i = baocao({ role: typed, so_lieu: 1 });
    await handleInteraction(ctx, i);
    expect(i.steps, typed).toEqual([
      { step: 'defer', ephemeral: true },
      { step: 'edit', content: 'Không tìm thấy role' },
    ]);
  }
  expect(await reports()).toHaveLength(3);
  expect(errors).not.toHaveBeenCalled();
});

test('/baocao rejects an unparsable day with the hint copy', async () => {
  for (const ngay of ['hôm qua', '30/02', '22-10']) {
    const i = baocao({ role: 'swordsman', so_lieu: 2, ngay });
    await handleInteraction(ctx, i);
    expect(i.steps, ngay).toEqual([
      { step: 'defer', ephemeral: true },
      { step: 'edit', content: 'Ngày không hợp lệ (dùng dd/MM hoặc YYYY-MM-DD)' },
    ]);
  }
  expect(await reports()).toEqual([]);
});

test('/baocao passes so_lieu_phu as the secondary metric and confirms with "x + y"', async () => {
  const assassin = await roleByKey(testDb, 'assassin');
  const i = baocao({ role: 'assassin', so_lieu: 4, so_lieu_phu: 2 });
  await handleInteraction(ctx, i);
  expect(i.steps).toEqual([
    { step: 'defer', ephemeral: true },
    { step: 'edit', content: 'Đã gửi: 🗡️ Ám sát — 4 mạng đã giết + 2 lần ám sát trong cuộc họp ngày 22/10. Chờ mod duyệt nhé!' },
  ]);
  expect((await reports())[0]).toMatchObject({ roleId: assassin.id, value: 4, extraValue: 2, status: 'pending' });

  // Bỏ trống `so_lieu_phu` → 0; tin xác nhận vẫn nêu cả hai chỉ số.
  const none = baocao({ role: 'assassin', so_lieu: 3 });
  await handleInteraction(ctx, none);
  expect(none.lastText).toBe('Đã gửi: 🗡️ Ám sát — 3 mạng đã giết + 0 lần ám sát trong cuộc họp ngày 22/10. Chờ mod duyệt nhé!');
  expect((await reports())[1]).toMatchObject({ value: 3, extraValue: 0 });

  // Role thường: tin xác nhận như cũ, lần khai có extraValue 0.
  const plain = baocao({ role: 'swordsman', so_lieu: 5 });
  await handleInteraction(ctx, plain);
  expect(plain.lastText).toBe('Đã gửi: ⚔️ Kiếm sĩ — 5 mạng chém ngày 22/10. Chờ mod duyệt nhé!');
  expect((await reports())[2]).toMatchObject({ value: 5, extraValue: 0 });
  expect(errors).not.toHaveBeenCalled();
});

test('/baocao answers secondary-metric rule violations with the business message', async () => {
  const over = baocao({ role: 'assassin', so_lieu: 1, so_lieu_phu: 3 });
  await handleInteraction(ctx, over);
  expect(over.lastText).toBe('Chỉ số phụ phải từ 0 đến 2');

  const noExtra = baocao({ role: 'swordsman', so_lieu: 1, so_lieu_phu: 1 });
  await handleInteraction(ctx, noExtra);
  expect(noExtra.lastText).toBe('Role này không có chỉ số phụ');

  expect(await reports()).toEqual([]);
  expect(errors).not.toHaveBeenCalled();
});

test('/baocao answers rule violations with the business message', async () => {
  const over = baocao({ role: 'swordsman', so_lieu: 99 });
  await handleInteraction(ctx, over);
  expect(over.lastText).toBe('Giá trị phải từ 0 đến 15');

  const old = baocao({ role: 'swordsman', so_lieu: 1, ngay: '01/10' });
  await handleInteraction(ctx, old);
  expect(old.lastText).toBe('Chỉ khai được trận trong 3 ngày gần nhất');

  // Role đang tắt được tìm thấy theo key nhưng service từ chối.
  const inactive = baocao({ role: 'inquisitor', so_lieu: 1 });
  await handleInteraction(ctx, inactive);
  expect(inactive.lastText).toBe('Role này đang tắt');

  expect(await reports()).toEqual([]);
  expect(errors).not.toHaveBeenCalled();
});

// ---------------------------------------------------------------------------
// /bxh
// ---------------------------------------------------------------------------

test('/bxh replies publicly with a faction-coloured top-10 embed', async () => {
  const an = await createMember(testDb, { displayName: 'An' });
  const binh = await createMember(testDb, { displayName: 'Bình' });
  await approvedReport(binh, 'swordsman', 4);
  await approvedReport(an, 'swordsman', 7);
  await approvedReport(an, 'goose', 2);

  const i = new FakeCommand('bxh', { options: { role: 'swordsman' } });
  await handleInteraction(ctx, i);
  expect(i.steps).toEqual([
    { step: 'defer', ephemeral: false },
    {
      step: 'edit',
      embeds: [
        {
          title: '👑 Bảng xếp hạng Kiếm sĩ — mùa 10/2026',
          description: ['1. 👑 An — 7 mạng chém (1 trận)', '2. Bình — 4 mạng chém (1 trận)'].join('\n'),
          color: 0xe5484d,
        },
      ],
    },
  ]);

  const goose = new FakeCommand('bxh', { options: { role: 'Ngỗng' } });
  await handleInteraction(ctx, goose);
  expect(goose.steps[1]).toEqual({
    step: 'edit',
    embeds: [{ title: '👑 Bảng xếp hạng Ngỗng — mùa 10/2026', description: '1. 👑 An — 2 lần vote trúng Vịt (1 trận)', color: 0x2f80ed }],
  });
  expect(errors).not.toHaveBeenCalled();
});

test('/bxh shows "N điểm" for a role with a secondary metric', async () => {
  const an = await createMember(testDb, { displayName: 'An' });
  const binh = await createMember(testDb, { displayName: 'Bình' });
  // An: 4 + 2×3 = 10 điểm; Bình: 7 + 0 = 7 điểm (một trận mỗi người).
  await approvedReport(an, 'assassin', 4, 2);
  await approvedReport(binh, 'assassin', 7);

  const i = new FakeCommand('bxh', { options: { role: 'assassin' } });
  await handleInteraction(ctx, i);
  expect(i.steps[1]).toEqual({
    step: 'edit',
    embeds: [
      {
        title: '👑 Bảng xếp hạng Ám sát — mùa 10/2026',
        description: ['1. 👑 An — 10 điểm (1 trận)', '2. Bình — 7 điểm (1 trận)'].join('\n'),
        color: 0xe5484d,
      },
    ],
  });
  expect(errors).not.toHaveBeenCalled();
});

test('/bxh for a role nobody reported says so; unknown role is answered as text', async () => {
  const i = new FakeCommand('bxh', { options: { role: 'cuckoo' } });
  await handleInteraction(ctx, i);
  expect(i.steps).toEqual([
    { step: 'defer', ephemeral: false },
    { step: 'edit', embeds: [{ title: '👑 Bảng xếp hạng Cò gáy — mùa 10/2026', description: 'Chưa có ai khai điểm mùa này', color: 0x8e4ec6 }] },
  ]);

  const missing = new FakeCommand('bxh', { options: { role: 'khong_co' } });
  await handleInteraction(ctx, missing);
  expect(missing.steps).toEqual([
    { step: 'defer', ephemeral: false },
    { step: 'edit', content: 'Không tìm thấy role' },
  ]);
  // /bxh không cần hồ sơ người gõ.
  expect(await testDb.member.count()).toBe(0);
});

// ---------------------------------------------------------------------------
// /hoso
// ---------------------------------------------------------------------------

test('/hoso shows the member code, held roles this season and the web link, ephemerally', async () => {
  const me = await createMember(testDb, { discordId: 'u1', displayName: 'Tên cũ', memberCode: 'GGD-0007' });
  const other = await createMember(testDb, { displayName: 'Bình' });
  await approvedReport(me, 'swordsman', 7);
  await approvedReport(me, 'cuckoo', 3);
  // Role có chỉ số phụ: điểm mùa = 4 + 2×3 = 10 (chỉ hiện số, không có nhãn).
  await approvedReport(me, 'assassin', 4, 2);
  await approvedReport(other, 'goose', 9);

  const i = new FakeCommand('hoso');
  await handleInteraction(ctx, i);
  expect(i.steps[0]).toEqual({ step: 'defer', ephemeral: true });
  expect(i.steps).toHaveLength(2);
  const text = i.lastText ?? '';
  expect(text).toContain('GGD-0007');
  expect(text).toContain('⚔️ Kiếm sĩ (7), 🥚 Cò gáy (3)');
  expect(text).toContain('🗡️ Ám sát (10)');
  expect(text).not.toContain('Ngỗng');
  expect(text).toContain('http://localhost:3000/ho-so');
  // Hồ sơ được làm mới từ Discord.
  expect((await presser()).displayName).toBe('Người gõ');

  const newcomer = new FakeCommand('hoso', { member: guildMember('u2', 'Người mới') });
  await handleInteraction(ctx, newcomer);
  const created = await testDb.member.findUniqueOrThrow({ where: { discordId: 'u2' } });
  expect(newcomer.lastText).toContain(created.memberCode);
  expect(newcomer.lastText).toContain('Chưa giữ role nào mùa này');
  expect(errors).not.toHaveBeenCalled();
});

// ---------------------------------------------------------------------------
// Bỏ qua / từ chối / lỗi lạ
// ---------------------------------------------------------------------------

test('commands outside the main guild are refused like components', async () => {
  for (const i of [
    baocao({ role: 'swordsman', so_lieu: 1 }, { guildId: 'other-guild' }),
    baocao({ role: 'swordsman', so_lieu: 1 }, { guildId: null, member: null }),
    baocao({ role: 'swordsman', so_lieu: 1 }, { member: null }),
    new FakeCommand('bxh', { options: { role: 'swordsman' }, guildId: 'other-guild' }),
    new FakeCommand('hoso', { guildId: 'other-guild' }),
  ]) {
    await handleInteraction(ctx, i);
    expect(i.steps).toEqual([{ step: 'reply', content: 'Bot chỉ dùng trong server chính', ephemeral: true }]);
  }
  expect(await testDb.member.count()).toBe(0);
  expect(await reports()).toEqual([]);
});

test('unknown commands are ignored with a log line', async () => {
  const i = new FakeCommand('lalala');
  await handleInteraction(ctx, i);
  expect(i.steps).toEqual([]);
  expect(warns).toHaveBeenCalledTimes(1);
  expect(String(warns.mock.calls[0]?.[0])).toContain('lalala');
});

test('unexpected errors in a command are logged and answered generically', async () => {
  const broken: Ctx = {
    ...ctx,
    db: {
      member: {
        findUnique: async () => {
          throw new Error('db secret');
        },
      },
    } as unknown as PrismaClient,
  };
  const i = baocao({ role: 'swordsman', so_lieu: 1 });
  await handleInteraction(broken, i);
  expect(i.steps).toEqual([
    { step: 'defer', ephemeral: true },
    { step: 'edit', content: 'Có lỗi xảy ra, thử lại sau' },
  ]);
  expect(errors).toHaveBeenCalledTimes(1);
  expect(String(errors.mock.calls[0]?.[0])).toContain('/baocao');
  expect(notifier.announcements).toEqual([]);
});
