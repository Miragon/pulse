/**
 * Durations of the workflow commands (`--wait-timeout`, `--stale-after`, design §17.1.2): a number
 * with an optional unit `ms`, `s`, `m` or `h`; a bare number is milliseconds like `--timeout`.
 * Pure.
 */

import { usageError } from '../errors.js';

const DURATION = /^(\d+)(ms|s|m|h)?$/;

const UNITS = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 } as const;

type Unit = keyof typeof UNITS;

/** The largest unit first: `formatDuration` prints the largest exact one. */
const LARGEST_FIRST: readonly Unit[] = ['h', 'm', 's'];

const MAX_MS = 24 * UNITS.h;

/** Milliseconds of `raw`, between 1 ms and 24 h; anything else is a usage error naming `label`. */
export function parseDuration(raw: string, label: string): number {
  const match = DURATION.exec(raw);
  const unit = (match?.[2] ?? 'ms') as Unit;
  const ms = match === null ? Number.NaN : Number(match[1]) * UNITS[unit];
  if (!(ms >= 1 && ms <= MAX_MS)) {
    throw usageError(
      `${label} expects a duration like 500ms, 30s, 2m or 1h, got "${raw}"`,
      'A number without a unit is milliseconds; the duration must be between 1ms and 24h.',
    );
  }
  return ms;
}

/** The duration in its largest exact unit: 90000 → `90s`, 120000 → `2m`, 1500 → `1500ms`. */
export function formatDuration(ms: number): string {
  const unit = LARGEST_FIRST.find((candidate) => ms % UNITS[candidate] === 0);
  return unit === undefined ? `${ms}ms` : `${ms / UNITS[unit]}${unit}`;
}
