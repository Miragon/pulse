/**
 * Normalizes date-time input to the engine format `yyyy-MM-dd'T'HH:mm:ss.SSSZ` with an RFC 822
 * offset, e.g. `2024-05-01T10:00:00.000+0200`. Pure.
 *
 *   2024-05-01                          → 2024-05-01T00:00:00.000+0000
 *   2024-05-01T10:00 / ...T10:00:00     → treated as UTC (+0000)
 *   ...T10:00:00.5Z / +02:00 / +0200    → fraction padded or truncated to 3 digits, offset kept
 */

import { usageError } from '../errors.js';

export const DATE_TIME_HINT =
  'Accepted forms: 2024-05-01, 2024-05-01T10:00, 2024-05-01T10:00:00, 2024-05-01T10:00:00Z, ' +
  '2024-05-01T10:00:00.000+02:00 and the engine format 2024-05-01T10:00:00.000+0200. ' +
  'Times without an offset are UTC.';

/** The date part is not captured: it sits at fixed positions once the pattern matched. */
const DATE_TIME =
  /^\d{4}-\d{2}-\d{2}(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

interface Parts {
  readonly year: string;
  readonly month: string;
  readonly day: string;
  readonly hour: string;
  readonly minute: string;
  readonly second: string;
  readonly fraction: string;
  readonly offset: string;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function inRange(value: string, min: number, max: number): boolean {
  const number = Number(value);
  return number >= min && number <= max;
}

/** `Z` → `+0000`, `+02:00` → `+0200`; absent → `+0000`. */
function rfc822Offset(offset: string | undefined): string {
  if (offset === undefined || offset === 'Z') return '+0000';
  return offset.replace(':', '');
}

function toParts(raw: string, match: RegExpExecArray): Parts {
  const [, hour, minute, second, fraction, offset] = match;
  return {
    year: raw.slice(0, 4),
    month: raw.slice(5, 7),
    day: raw.slice(8, 10),
    hour: hour ?? '00',
    minute: minute ?? '00',
    second: second ?? '00',
    fraction: (fraction ?? '').padEnd(3, '0').slice(0, 3),
    offset: rfc822Offset(offset),
  };
}

function isValid(parts: Parts): boolean {
  const year = Number(parts.year);
  return (
    inRange(parts.month, 1, 12) &&
    inRange(parts.day, 1, daysInMonth(year, Number(parts.month))) &&
    inRange(parts.hour, 0, 23) &&
    inRange(parts.minute, 0, 59) &&
    inRange(parts.second, 0, 59) &&
    inRange(parts.offset.slice(1, 3), 0, 23) &&
    inRange(parts.offset.slice(3, 5), 0, 59)
  );
}

/** Returns the engine format, or undefined if the input is not an accepted date-time. */
function parseDateTime(raw: string): string | undefined {
  const match = DATE_TIME.exec(raw);
  if (match === null) return undefined;
  const parts = toParts(raw, match);
  if (!isValid(parts)) return undefined;
  const { year, month, day, hour, minute, second, fraction, offset } = parts;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}.${fraction}${offset}`;
}

/** Normalizes to the engine format; throws a usage error listing the accepted forms. */
export function normalizeDateTime(raw: string): string {
  const normalized = parseDateTime(raw);
  if (normalized === undefined) throw usageError(`Invalid date-time "${raw}"`, DATE_TIME_HINT);
  return normalized;
}
