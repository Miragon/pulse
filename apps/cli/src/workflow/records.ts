/**
 * Typed reads of engine response objects (DTOs) and of engine timestamps. The workflow commands
 * never trust the shape of a response: a missing or mistyped property reads as undefined. Pure.
 */

import { isRecord } from '../util.js';

/** An engine DTO. */
export type Rec = Readonly<Record<string, unknown>>;

/** The objects of a JSON array (anything else gives an empty list). */
export function records(value: unknown): Rec[] {
  return Array.isArray(value) ? (value as unknown[]).filter(isRecord) : [];
}

/** A non-empty string property. */
export function str(record: Rec | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** A string property, or an empty string when it is missing (identifiers the engine always sends). */
export function field(record: Rec | undefined, key: string): string {
  return str(record, key) ?? '';
}

/** A number property (also a BigInt of `parseJson`, as a number). */
export function num(record: Rec | undefined, key: string): number | undefined {
  const value = record?.[key];
  if (typeof value === 'bigint') return Number(value);
  return typeof value === 'number' ? value : undefined;
}

/** A number property, or 0 when it is missing (counts). */
export function amount(record: Rec | undefined, key: string): number {
  return num(record, key) ?? 0;
}

/** True only for a boolean `true`. */
export function yes(record: Rec | undefined, key: string): boolean {
  return record?.[key] === true;
}

/** `count` of a `CountResultDto`, 0 when absent. */
export function countOf(value: unknown): number {
  return isRecord(value) ? amount(value, 'count') : 0;
}

/** The key part of a process definition id (`order:3:1f2...` → `order`). */
export function definitionKeyOf(definitionId: string | undefined): string | undefined {
  const key = definitionId?.split(':')[0] ?? '';
  return key === '' ? undefined : key;
}

/** RFC 822 offsets (`+0200`) as ISO offsets (`+02:00`), which every Date parser accepts. */
const RFC822_OFFSET = /([+-]\d{2})(\d{2})$/;

/** Milliseconds of an engine timestamp (`2024-05-01T10:00:00.000+0200`), or undefined. */
export function engineTime(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const time = Date.parse(value.replace(RFC822_OFFSET, '$1:$2'));
  return Number.isNaN(time) ? undefined : time;
}

/** An instant in the engine format, in UTC: `2024-05-01T08:00:00.000+0000`. */
export function engineFormat(ms: number): string {
  return new Date(ms).toISOString().replace('Z', '+0000');
}

/** Ordinal string order, independent of the locale. */
export function compareText(left: string, right: string): number {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

/** Order of optional timestamps: earlier first, missing ones last. */
export function compareTime(left: string | undefined, right: string | undefined): number {
  const a = engineTime(left) ?? Number.POSITIVE_INFINITY;
  const b = engineTime(right) ?? Number.POSITIVE_INFINITY;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
