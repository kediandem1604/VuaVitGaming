import { expect, test } from 'vitest';
import { encodeCustomId, parseCustomId } from '../../../src/server/bot/custom-ids.js';
import type { CustomIdData } from '../../../src/server/bot/custom-ids.js';

test('custom id roundtrip and garbage', () => {
  expect(parseCustomId(encodeCustomId({ kind: 'att', action: 'join', sessionId: 7 }))).toEqual({
    kind: 'att',
    action: 'join',
    sessionId: 7,
  });
  expect(parseCustomId('vote:3:9')).toEqual({ kind: 'vote', roundId: 3, categoryId: 9 });
  expect(parseCustomId('att:join:abc')).toBeNull();
});

test('encode produces the exact documented formats', () => {
  expect(encodeCustomId({ kind: 'att', action: 'join', sessionId: 12 })).toBe('att:join:12');
  expect(encodeCustomId({ kind: 'att', action: 'leave', sessionId: 12 })).toBe('att:leave:12');
  expect(encodeCustomId({ kind: 'vote', roundId: 3, categoryId: 9 })).toBe('vote:3:9');
});

test('every encoded value parses back to the same data', () => {
  const samples: CustomIdData[] = [
    { kind: 'att', action: 'join', sessionId: 1 },
    { kind: 'att', action: 'leave', sessionId: 2147483647 },
    { kind: 'vote', roundId: 10, categoryId: 1 },
  ];
  for (const d of samples) expect(parseCustomId(encodeCustomId(d))).toEqual(d);
});

test('ids must be positive integers in canonical form', () => {
  for (const s of ['att:join:0', 'att:join:-1', 'att:join:1.5', 'att:join:01', 'att:join:', 'att:join: 1', 'att:join:1 ']) {
    expect(parseCustomId(s), s).toBeNull();
  }
  for (const s of ['vote:0:1', 'vote:1:0', 'vote:x:1', 'vote:1:-2', 'vote::1', 'vote:1:']) {
    expect(parseCustomId(s), s).toBeNull();
  }
});

test('wrong shape is rejected', () => {
  for (const s of [
    '',
    'att',
    'att:join',
    'att:join:1:2',
    'att:go:1',
    'ATT:join:1',
    'vote:1',
    'vote:1:2:3',
    'other:1:2',
    'att:join:1\n',
    `att:join:${'1'.repeat(98)}`, // 107 ký tự — quá giới hạn 100 của Discord
  ]) {
    expect(parseCustomId(s), JSON.stringify(s)).toBeNull();
  }
});
