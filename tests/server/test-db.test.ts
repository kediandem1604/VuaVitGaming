import { expect, test } from 'vitest';
import { dockerHelp, testDbMode } from '../helpers/test-db.js';

test('docker is the default test database', () => {
  expect(testDbMode({})).toBe('docker');
  expect(testDbMode({ GGD_TEST_DB: '' })).toBe('docker');
});

test('GGD_TEST_DB=embedded selects the embedded database, any case', () => {
  expect(testDbMode({ GGD_TEST_DB: 'embedded' })).toBe('embedded');
  expect(testDbMode({ GGD_TEST_DB: 'EMBEDDED' })).toBe('embedded');
});

test('an unknown GGD_TEST_DB value is rejected instead of silently ignored', () => {
  expect(() => testDbMode({ GGD_TEST_DB: 'embeded' })).toThrow(/GGD_TEST_DB/);
});

test('docker help tells the user both ways out and keeps the original error', () => {
  const text = dockerHelp('Cannot connect to the Docker daemon');
  expect(text).toContain('Docker Desktop');
  expect(text).toContain('GGD_TEST_DB=embedded');
  expect(text).toContain('54330');
  expect(text).toContain('Cannot connect to the Docker daemon');
});
