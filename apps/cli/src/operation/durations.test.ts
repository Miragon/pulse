import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { OperateError } from '../errors.js';
import { formatDuration, parseDuration } from './durations.js';

describe('parseDuration', () => {
  it.each([
    ['1', 1],
    ['500', 500],
    ['500ms', 500],
    ['30s', 30_000],
    ['2m', 120_000],
    ['1h', 3_600_000],
    ['24h', 86_400_000],
    ['1440m', 86_400_000],
  ])('reads %s as %i ms', (raw, ms) => {
    expect(parseDuration(raw, '--wait-timeout')).toBe(ms);
  });

  it.each(['', '0', '0s', '25h', '86400001', '1.5s', '-1s', ' 1s', '1 s', '1d', 's', '1S', 'abc'])(
    'rejects "%s" with a usage error naming the option',
    (raw) => {
      let error: unknown;
      try {
        parseDuration(raw, '--stale-after');
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(OperateError);
      expect(error).toMatchObject({
        code: 'USAGE',
        message: `--stale-after expects a duration like 500ms, 30s, 2m or 1h, got "${raw}"`,
        details: {
          hint: 'A number without a unit is milliseconds; the duration must be between 1ms and 24h.',
        },
      });
    },
  );
});

describe('formatDuration', () => {
  it.each([
    [1, '1ms'],
    [1500, '1500ms'],
    [1000, '1s'],
    [90_000, '90s'],
    [120_000, '2m'],
    [5_400_000, '90m'],
    [3_600_000, '1h'],
  ])('prints %i ms as %s', (ms, text) => {
    expect(formatDuration(ms)).toBe(text);
  });

  it('round trips with parseDuration (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 86_400_000 }), (ms) => {
        expect(parseDuration(formatDuration(ms), '--x')).toBe(ms);
      }),
    );
  });
});
