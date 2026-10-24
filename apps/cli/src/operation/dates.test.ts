import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { OperateError } from '../errors.js';
import { DATE_TIME_HINT, normalizeDateTime } from './dates.js';

const ENGINE_FORMAT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{4}$/;

/** Instant of an engine formatted value (`+0200` → `+02:00` so Date.parse reads it). */
function instantOf(engine: string): number {
  return Date.parse(engine.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0');
}

function daysIn(year: number, month: number): number {
  const date = new Date(0);
  // setUTCFullYear does not map years 0-99 to 1900-1999 like Date.UTC
  date.setUTCFullYear(year, month, 0);
  return date.getUTCDate();
}

const offsetArb = fc.record({
  sign: fc.constantFrom('+', '-'),
  hours: fc.integer({ min: 0, max: 23 }),
  minutes: fc.integer({ min: 0, max: 59 }),
  style: fc.constantFrom('colon', 'compact', 'z'),
});

const isoArb = fc
  .record({
    date: fc.date({
      min: new Date('0001-01-01T00:00:00Z'),
      max: new Date('9999-12-30T00:00:00Z'),
      noInvalidDate: true,
    }),
    precision: fc.constantFrom('minutes', 'seconds', 'fraction'),
    fraction: fc.stringMatching(/^\d{1,9}$/),
    offset: offsetArb,
  })
  .map(({ date, precision, fraction, offset }) => {
    const iso = date.toISOString();
    const base =
      precision === 'minutes'
        ? iso.slice(0, 16)
        : precision === 'seconds'
          ? iso.slice(0, 19)
          : `${iso.slice(0, 19)}.${fraction}`;
    const zone =
      offset.style === 'z'
        ? 'Z'
        : `${offset.sign}${pad(offset.hours)}${offset.style === 'colon' ? ':' : ''}${pad(offset.minutes)}`;
    return `${base}${zone}`;
  });

function expectUsageError(raw: string): void {
  try {
    normalizeDateTime(raw);
  } catch (error) {
    expect(error).toBeInstanceOf(OperateError);
    expect((error as OperateError).code).toBe('USAGE');
    expect((error as OperateError).message).toBe(`Invalid date-time "${raw}"`);
    expect((error as OperateError).details.hint).toBe(DATE_TIME_HINT);
    return;
  }
  throw new Error(`expected "${raw}" to be rejected`);
}

describe('normalizeDateTime', () => {
  it.each([
    ['2024-05-01T10:00:00.000+0200', '2024-05-01T10:00:00.000+0200'],
    ['2024-05-01T10:00:00.000-0530', '2024-05-01T10:00:00.000-0530'],
    ['2024-05-01T10:00:00Z', '2024-05-01T10:00:00.000+0000'],
    ['2024-05-01T10:00:00.5Z', '2024-05-01T10:00:00.500+0000'],
    ['2024-05-01T10:00:00.12Z', '2024-05-01T10:00:00.120+0000'],
    ['2024-05-01T10:00:00.123456789+02:00', '2024-05-01T10:00:00.123+0200'],
    ['2024-05-01T10:00:00+02:00', '2024-05-01T10:00:00.000+0200'],
    ['2024-05-01T10:00:00-0130', '2024-05-01T10:00:00.000-0130'],
    ['2024-05-01T10:00Z', '2024-05-01T10:00:00.000+0000'],
    ['2024-05-01T10:00+02:00', '2024-05-01T10:00:00.000+0200'],
    ['2024-05-01T10:00', '2024-05-01T10:00:00.000+0000'],
    ['2024-05-01T10:00:00', '2024-05-01T10:00:00.000+0000'],
    ['2024-05-01', '2024-05-01T00:00:00.000+0000'],
    ['2024-02-29', '2024-02-29T00:00:00.000+0000'],
    ['2000-02-29T23:59:59.999Z', '2000-02-29T23:59:59.999+0000'],
    ['2023-12-31T00:00:00-23:59', '2023-12-31T00:00:00.000-2359'],
    ['0000-01-01', '0000-01-01T00:00:00.000+0000'],
  ])('normalizes %s', (raw, expected) => {
    expect(normalizeDateTime(raw)).toBe(expected);
  });

  it.each([
    '',
    'yesterday',
    '2024-5-1',
    '24-05-01',
    '2024-05-01T10',
    '2024-05-01 10:00:00',
    '2024-05-01t10:00:00z',
    '2024-05-01T10:00:00.Z',
    '2024-05-01T10:00:00+2',
    '2024-05-01T10:00:00+02',
    '2024-05-01T10:00:00+02:000',
    '2024-05-01Z',
    ' 2024-05-01',
    'x2024-05-01',
    'abc2001-05-01',
    '2024-05-01 ',
    '2024-00-10',
    '2024-13-10',
    '2024-01-00',
    '2024-01-32',
    '2023-02-29',
    '1900-02-29',
    '2024-04-31',
    '2024-06-31',
    '2024-09-31',
    '2024-11-31',
    '2024-05-01T24:00',
    '2024-05-01T10:60',
    '2024-05-01T10:00:60',
    '2024-05-01T10:00:00+24:00',
    '2024-05-01T10:00:00+0060',
  ])('rejects %j', (raw) => {
    expectUsageError(raw);
  });

  it('accepts the last day of every month', () => {
    expect(normalizeDateTime('2024-01-31')).toBe('2024-01-31T00:00:00.000+0000');
    expect(normalizeDateTime('2023-02-28')).toBe('2023-02-28T00:00:00.000+0000');
    expect(normalizeDateTime('2024-04-30')).toBe('2024-04-30T00:00:00.000+0000');
    expect(normalizeDateTime('2024-12-31')).toBe('2024-12-31T00:00:00.000+0000');
  });

  it('lists every accepted form in the hint', () => {
    expect(DATE_TIME_HINT).toContain('2024-05-01,');
    expect(DATE_TIME_HINT).toContain('2024-05-01T10:00:00.000+0200');
    expect(DATE_TIME_HINT).toContain('without an offset are UTC');
  });

  it('always produces the engine format', () => {
    fc.assert(
      fc.property(isoArb, (raw) => {
        expect(normalizeDateTime(raw)).toMatch(ENGINE_FORMAT);
      }),
    );
  });

  it('is idempotent', () => {
    fc.assert(
      fc.property(isoArb, (raw) => {
        const once = normalizeDateTime(raw);
        expect(normalizeDateTime(once)).toBe(once);
      }),
    );
  });

  it('keeps the instant of ISO input with an offset', () => {
    fc.assert(
      fc.property(isoArb, (raw) => {
        expect(instantOf(normalizeDateTime(raw))).toBe(Date.parse(raw));
      }),
    );
  });

  it('treats input without an offset as UTC', () => {
    fc.assert(
      fc.property(
        fc.date({
          min: new Date('0001-01-01T00:00:00Z'),
          max: new Date('9999-12-31T00:00:00Z'),
          noInvalidDate: true,
        }),
        fc.constantFrom(10, 16, 19, 23),
        (date, length) => {
          const raw = date.toISOString().slice(0, length);
          const asUtc = length === 10 ? `${raw}T00:00:00Z` : `${raw}Z`;
          expect(instantOf(normalizeDateTime(raw))).toBe(Date.parse(asUtc));
        },
      ),
    );
  });

  it('rejects invalid calendar dates', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 9999 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 9 }),
        (year, month, beyond) => {
          const day = daysIn(year, month) + beyond;
          if (day > 99) return;
          expect(() => normalizeDateTime(`${pad(year, 4)}-${pad(month)}-${pad(day)}`)).toThrow(
            OperateError,
          );
        },
      ),
    );
  });

  it('accepts every valid calendar date', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 9999 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 31 }),
        (year, month, rawDay) => {
          const day = Math.min(rawDay, daysIn(year, month));
          const date = `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
          expect(normalizeDateTime(date)).toBe(`${date}T00:00:00.000+0000`);
        },
      ),
    );
  });
});
