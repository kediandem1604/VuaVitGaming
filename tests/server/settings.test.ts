import { beforeEach, expect, test } from 'vitest';
import {
  DEFAULT_SETTINGS,
  getSettings,
  getTheme,
  setTheme,
  updateSettings,
  type Settings,
} from '../../src/server/modules/settings/service.js';
import { makeTestCtx } from '../helpers/ctx.js';
import { resetDb, testDb } from '../helpers/db.js';

beforeEach(resetDb);

const storedRows = () => testDb.appSetting.findMany({ orderBy: { key: 'asc' } });

test('settings defaults and bounds', async () => {
  const { ctx } = makeTestCtx();
  expect(await getSettings(ctx)).toEqual(DEFAULT_SETTINGS);
  expect(DEFAULT_SETTINGS).toEqual({ voteDurationHours: 12, autoEndHours: 4, reminderLeadMinutes: 15 });

  await expect(updateSettings(ctx, { voteDurationHours: 0 })).rejects.toMatchObject({ code: 'VALIDATION' });
  await expect(updateSettings(ctx, { voteDurationHours: 73 })).rejects.toMatchObject({ code: 'VALIDATION' });
  await expect(updateSettings(ctx, { autoEndHours: 0 })).rejects.toMatchObject({ code: 'VALIDATION' });
  await expect(updateSettings(ctx, { autoEndHours: 25 })).rejects.toMatchObject({ code: 'VALIDATION' });
  await expect(updateSettings(ctx, { reminderLeadMinutes: 4 })).rejects.toMatchObject({ code: 'VALIDATION' });
  await expect(updateSettings(ctx, { reminderLeadMinutes: 121 })).rejects.toMatchObject({ code: 'VALIDATION' });
  // Phải là số nguyên; kiểu sai (từ body JSON) cũng bị chặn.
  await expect(updateSettings(ctx, { voteDurationHours: 1.5 })).rejects.toMatchObject({ code: 'VALIDATION' });
  await expect(
    updateSettings(ctx, { autoEndHours: '4' as unknown as number }),
  ).rejects.toMatchObject({ code: 'VALIDATION' });

  // Biên hợp lệ hai đầu đều được nhận.
  expect(await updateSettings(ctx, { voteDurationHours: 1, autoEndHours: 24, reminderLeadMinutes: 5 })).toEqual({
    voteDurationHours: 1,
    autoEndHours: 24,
    reminderLeadMinutes: 5,
  });
  expect(await updateSettings(ctx, { voteDurationHours: 72, autoEndHours: 1, reminderLeadMinutes: 120 })).toEqual({
    voteDurationHours: 72,
    autoEndHours: 1,
    reminderLeadMinutes: 120,
  });
});

test('updateSettings stores only the given keys and returns the merged settings', async () => {
  const { ctx } = makeTestCtx();

  expect(await updateSettings(ctx, { voteDurationHours: 24 })).toEqual({
    voteDurationHours: 24,
    autoEndHours: 4,
    reminderLeadMinutes: 15,
  });
  expect(await storedRows()).toEqual([{ key: 'vote_duration_hours', value: '24' }]);
  expect(await getSettings(ctx)).toEqual({ voteDurationHours: 24, autoEndHours: 4, reminderLeadMinutes: 15 });

  // Lần sau chỉ đụng khoá được truyền; giá trị cũ giữ nguyên.
  expect(await updateSettings(ctx, { reminderLeadMinutes: 30 })).toEqual({
    voteDurationHours: 24,
    autoEndHours: 4,
    reminderLeadMinutes: 30,
  });
  expect(await storedRows()).toEqual([
    { key: 'reminder_lead_minutes', value: '30' },
    { key: 'vote_duration_hours', value: '24' },
  ]);

  // Ghi đè khoá đã có: vẫn một dòng.
  await updateSettings(ctx, { voteDurationHours: 6 });
  expect(await storedRows()).toEqual([
    { key: 'reminder_lead_minutes', value: '30' },
    { key: 'vote_duration_hours', value: '6' },
  ]);

  // Patch rỗng: không ghi gì, trả về cài đặt hiện tại.
  expect(await updateSettings(ctx, {})).toEqual({ voteDurationHours: 6, autoEndHours: 4, reminderLeadMinutes: 30 });
  expect(await storedRows()).toHaveLength(2);
});

test('unknown keys are rejected and nothing is stored', async () => {
  const { ctx } = makeTestCtx();
  await expect(
    updateSettings(ctx, { voteDurationHours: 10, somethingElse: 1 } as unknown as Partial<Settings>),
  ).rejects.toMatchObject({ code: 'VALIDATION' });
  expect(await storedRows()).toEqual([]);
  expect(await getSettings(ctx)).toEqual(DEFAULT_SETTINGS);
});

test('an invalid patch leaves every key untouched', async () => {
  const { ctx } = makeTestCtx();
  await updateSettings(ctx, { voteDurationHours: 24 });
  // Một khoá sai làm cả patch bị từ chối, kể cả khoá hợp lệ đi cùng.
  await expect(updateSettings(ctx, { voteDurationHours: 48, autoEndHours: 99 })).rejects.toMatchObject({
    code: 'VALIDATION',
  });
  expect(await getSettings(ctx)).toEqual({ voteDurationHours: 24, autoEndHours: 4, reminderLeadMinutes: 15 });
});

test('unparseable or invalid stored values fall back to the default', async () => {
  const { ctx } = makeTestCtx();
  await testDb.appSetting.createMany({
    data: [
      { key: 'vote_duration_hours', value: 'abc' },
      { key: 'auto_end_hours', value: '' },
      { key: 'reminder_lead_minutes', value: '30' },
    ],
  });
  expect(await getSettings(ctx)).toEqual({ voteDurationHours: 12, autoEndHours: 4, reminderLeadMinutes: 30 });

  // Giá trị ngoài khoảng cho phép (sửa tay trong DB) cũng không được dùng.
  await testDb.appSetting.update({ where: { key: 'reminder_lead_minutes' }, data: { value: '0' } });
  expect(await getSettings(ctx)).toEqual(DEFAULT_SETTINGS);

  // Khoá lạ trong bảng không ảnh hưởng.
  await testDb.appSetting.create({ data: { key: 'khoa_la', value: '1' } });
  expect(await getSettings(ctx)).toEqual(DEFAULT_SETTINGS);
});

test('the shared theme defaults to night and ignores unknown stored values', async () => {
  const { ctx } = makeTestCtx();
  expect(await getTheme(ctx)).toBe('night');
  expect(await setTheme(ctx, 'halloween')).toBe('halloween');
  expect(await getTheme(ctx)).toBe('halloween');
  // Chủ đề không nằm trong cài đặt số.
  expect(await getSettings(ctx)).toEqual(DEFAULT_SETTINGS);

  await expect(setTheme(ctx, 'christmas' as 'night')).rejects.toMatchObject({ code: 'VALIDATION' });
  expect(await getTheme(ctx)).toBe('halloween');

  await testDb.appSetting.update({ where: { key: 'theme' }, data: { value: 'sửa tay' } });
  expect(await getTheme(ctx)).toBe('night');
});
