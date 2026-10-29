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
  expect(c.mail).toEqual({
    provider: 'smtp',
    host: 'smtp.gmail.com',
    port: 465,
    user: 'u',
    pass: 'p',
    from: 'GGD <u@gmail.com>',
  });
});

const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, ...noSmtp } = base;

test('BREVO_API_KEY switches email to Brevo and makes the SMTP variables optional', () => {
  expect(loadConfig({ ...noSmtp, BREVO_API_KEY: 'xkeysib-abc', MAIL_FROM: 'GGD Hub <hoi@gmail.com>' }).mail).toEqual({
    provider: 'brevo',
    apiKey: 'xkeysib-abc',
    sender: { name: 'GGD Hub', email: 'hoi@gmail.com' },
  });
  // Có Brevo thì biến SMTP còn sót lại bị bỏ qua.
  expect(loadConfig({ ...base, BREVO_API_KEY: 'k' }).mail).toMatchObject({ provider: 'brevo' });
  // MAIL_FROM chỉ có địa chỉ, hoặc tên trong ngoặc kép.
  expect(loadConfig({ ...noSmtp, BREVO_API_KEY: 'k', MAIL_FROM: ' hoi@gmail.com ' }).mail).toMatchObject({
    sender: { email: 'hoi@gmail.com' },
  });
  expect(loadConfig({ ...noSmtp, BREVO_API_KEY: 'k', MAIL_FROM: '"Hội GGD" <hoi@gmail.com>' }).mail).toMatchObject({
    sender: { name: 'Hội GGD', email: 'hoi@gmail.com' },
  });
});

test('with Brevo, MAIL_FROM must hold a usable address', () => {
  for (const from of ['GGD Hub', 'GGD <hoi>', 'GGD <hoi@gmail>', '<>']) {
    expect(() => loadConfig({ ...noSmtp, BREVO_API_KEY: 'k', MAIL_FROM: from }), from).toThrow(/MAIL_FROM: phải có dạng/);
  }
});

test('without BREVO_API_KEY every missing SMTP variable is named', () => {
  expect(() => loadConfig(noSmtp)).toThrow(/SMTP_HOST: thiếu biến \(hoặc đặt BREVO_API_KEY\)/);
  let message = '';
  try {
    loadConfig({ ...noSmtp, BREVO_API_KEY: '  ' }); // để trống = chưa đặt
  } catch (err) {
    message = (err as Error).message;
  }
  for (const key of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS']) expect(message).toContain(key);
  expect(() => loadConfig({ ...base, SMTP_PORT: 'abc' })).toThrow(/SMTP_PORT: phải là số/);
  expect(() => loadConfig({ ...base, MAIL_FROM: '' })).toThrow(/MAIL_FROM/);
});

test('missing variable is named in the error', () => {
  const { DISCORD_TOKEN, ...rest } = base;
  expect(() => loadConfig(rest)).toThrow(/DISCORD_TOKEN/);
});

test('short SESSION_SECRET rejected', () => {
  expect(() => loadConfig({ ...base, SESSION_SECRET: 'short' })).toThrow(/SESSION_SECRET/);
});

test('TRUST_PROXY_HOPS defaults to 1 and must be an integer >= 0', () => {
  expect(loadConfig(base).trustProxyHops).toBe(1);
  expect(loadConfig({ ...base, TRUST_PROXY_HOPS: '2' }).trustProxyHops).toBe(2);
  expect(loadConfig({ ...base, TRUST_PROXY_HOPS: '0' }).trustProxyHops).toBe(0);
  expect(loadConfig({ ...base, TRUST_PROXY_HOPS: '' }).trustProxyHops).toBe(1); // để trống = chưa đặt
  expect(() => loadConfig({ ...base, TRUST_PROXY_HOPS: 'abc' })).toThrow(/TRUST_PROXY_HOPS/);
  expect(() => loadConfig({ ...base, TRUST_PROXY_HOPS: '-1' })).toThrow(/TRUST_PROXY_HOPS/);
  expect(() => loadConfig({ ...base, TRUST_PROXY_HOPS: '1.5' })).toThrow(/TRUST_PROXY_HOPS/);
});

test('dev login only on localhost', () => {
  expect(loadConfig({ ...base, DEV_LOGIN: '1' }).devLogin).toBe(true);
  expect(loadConfig({ ...base, DEV_LOGIN: '1', PUBLIC_URL: 'https://ggd.example.com' }).devLogin).toBe(false);
});

test('PUBLIC_URL is normalised without trailing slashes', () => {
  expect(loadConfig({ ...base, PUBLIC_URL: 'https://ggd.example.com/' }).publicUrl).toBe('https://ggd.example.com');
  expect(loadConfig({ ...base, PUBLIC_URL: 'https://ggd.example.com///' }).publicUrl).toBe('https://ggd.example.com');
  expect(loadConfig({ ...base, PUBLIC_URL: 'https://example.com/ggd/' }).publicUrl).toBe('https://example.com/ggd');
  expect(loadConfig({ ...base, PUBLIC_URL: 'https://ggd.example.com' }).publicUrl).toBe('https://ggd.example.com');
  // Dev login vẫn nhận ra localhost sau khi bỏ dấu `/`.
  expect(loadConfig({ ...base, DEV_LOGIN: '1', PUBLIC_URL: 'http://localhost:3000/' })).toMatchObject({
    publicUrl: 'http://localhost:3000',
    devLogin: true,
  });
});

test('DISCORD_HIGHLIGHT_CHANNEL_ID is optional: unset or blank → null, otherwise the id', () => {
  expect(loadConfig(base).discord.highlightChannelId).toBeNull();
  expect(loadConfig({ ...base, DISCORD_HIGHLIGHT_CHANNEL_ID: '' }).discord.highlightChannelId).toBeNull();
  expect(loadConfig({ ...base, DISCORD_HIGHLIGHT_CHANNEL_ID: '   ' }).discord.highlightChannelId).toBeNull();
  expect(loadConfig({ ...base, DISCORD_HIGHLIGHT_CHANNEL_ID: '4' }).discord.highlightChannelId).toBe('4');
});

test('DISCORD_BOUNTY_CHANNEL_ID is optional: unset or blank → null, otherwise the id', () => {
  expect(loadConfig(base).discord.bountyChannelId).toBeNull();
  expect(loadConfig({ ...base, DISCORD_BOUNTY_CHANNEL_ID: '' }).discord.bountyChannelId).toBeNull();
  expect(loadConfig({ ...base, DISCORD_BOUNTY_CHANNEL_ID: '  ' }).discord.bountyChannelId).toBeNull();
  expect(loadConfig({ ...base, DISCORD_BOUNTY_CHANNEL_ID: '5' }).discord.bountyChannelId).toBe('5');
});

test('on Render, a missing PUBLIC_URL falls back to RENDER_EXTERNAL_URL', () => {
  const onRender = { ...base, RENDER_EXTERNAL_URL: 'https://ggd-hub.onrender.com' };
  expect(loadConfig({ ...onRender, PUBLIC_URL: undefined }).publicUrl).toBe('https://ggd-hub.onrender.com');
  expect(loadConfig({ ...onRender, PUBLIC_URL: '' }).publicUrl).toBe('https://ggd-hub.onrender.com');
  // Tên miền riêng (PUBLIC_URL đặt tay) thắng địa chỉ onrender.com.
  expect(loadConfig({ ...onRender, PUBLIC_URL: 'https://ggd.example.com' }).publicUrl).toBe('https://ggd.example.com');
  // Thiếu cả hai thì vẫn báo đúng tên biến cần đặt.
  expect(() => loadConfig({ ...base, PUBLIC_URL: undefined })).toThrow(/PUBLIC_URL/);
});
