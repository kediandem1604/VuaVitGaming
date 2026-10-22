import { expect, test } from 'vitest';
import { loadConfig } from '../../src/server/config.js';

const base = {
  DATABASE_URL: 'postgresql://x',
  PUBLIC_URL: 'http://localhost:3000',
  SESSION_SECRET: 'x'.repeat(32),
  DISCORD_TOKEN: 't',
  DISCORD_CLIENT_ID: 'c',
  DISCORD_CLIENT_SECRET: 's',
  DISCORD_GUILD_ID: 'g',
  DISCORD_SCHEDULE_CHANNEL_ID: '1',
  DISCORD_VOTE_CHANNEL_ID: '2',
  DISCORD_ANNOUNCE_CHANNEL_ID: '3',
  DISCORD_ADMIN_ROLE_IDS: ' 10, 11 ,',
  DISCORD_MOD_ROLE_IDS: '',
  SMTP_HOST: 'smtp.gmail.com',
  SMTP_PORT: '465',
  SMTP_USER: 'u',
  SMTP_PASS: 'p',
  MAIL_FROM: 'GGD <u@gmail.com>',
};

test('parses comma lists and defaults', () => {
  const c = loadConfig(base);
  expect(c.discord.adminRoleIds).toEqual(['10', '11']);
  expect(c.discord.modRoleIds).toEqual([]);
  expect(c.port).toBe(3000);
  expect(c.smtp.port).toBe(465);
});

test('missing variable is named in the error', () => {
  const { DISCORD_TOKEN, ...rest } = base;
  expect(() => loadConfig(rest)).toThrow(/DISCORD_TOKEN/);
});

test('short SESSION_SECRET rejected', () => {
  expect(() => loadConfig({ ...base, SESSION_SECRET: 'short' })).toThrow(/SESSION_SECRET/);
});

test('dev login only on localhost', () => {
  expect(loadConfig({ ...base, DEV_LOGIN: '1' }).devLogin).toBe(true);
  expect(loadConfig({ ...base, DEV_LOGIN: '1', PUBLIC_URL: 'https://ggd.example.com' }).devLogin).toBe(false);
});
