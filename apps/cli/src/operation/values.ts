/**
 * Converts raw command line values of query params, path params, body fields and typed variables:
 * integers and numbers are validated, enums checked, booleans parsed and date-times normalized.
 * Pure; every failure is a usage error `<label> expects <what>, got "<raw>"`.
 */

import { usageError } from '../errors.js';
import { DATE_TIME_HINT, normalizeDateTime } from './dates.js';

/** The typing information shared by `ParamSpec`, `BodyFieldSpec` items and multipart fields. */
export interface ScalarSpec {
  readonly type: string;
  /** `int32`, `int64` (also beyond 2^53, as BigInt) or `int16` (Short variables). */
  readonly format?: string;
  readonly enum?: readonly string[];
}

export type Scalar = string | number | bigint | boolean;

interface Range {
  readonly min: bigint;
  readonly max: bigint;
}

const RANGES: Readonly<Record<string, Range>> = {
  int16: { min: -(2n ** 15n), max: 2n ** 15n - 1n },
  int32: { min: -(2n ** 31n), max: 2n ** 31n - 1n },
  int64: { min: -(2n ** 63n), max: 2n ** 63n - 1n },
};
/** Integers without a format: what a JSON number holds exactly. */
const SAFE: Range = { min: BigInt(Number.MIN_SAFE_INTEGER), max: BigInt(Number.MAX_SAFE_INTEGER) };

const INTEGER = /^-?\d+$/;

function invalid(label: string, expected: string, raw: string, hint?: string) {
  return usageError(`${label} expects ${expected}, got "${raw}"`, hint);
}

/** A number when it is exact as one, else a BigInt (int64 values beyond 2^53). */
function toInteger(raw: string, label: string, spec: ScalarSpec, hint?: string): number | bigint {
  if (!INTEGER.test(raw)) throw invalid(label, 'an integer', raw, hint);
  const range = (spec.format === undefined ? undefined : RANGES[spec.format]) ?? SAFE;
  const value = BigInt(raw);
  if (value < range.min || value > range.max) {
    throw invalid(label, `an integer between ${range.min} and ${range.max}`, raw, hint);
  }
  return value >= SAFE.min && value <= SAFE.max ? Number(value) : value;
}

function toNumber(raw: string, label: string, hint?: string): number {
  const value = Number(raw);
  if (raw.trim() === '' || !Number.isFinite(value)) throw invalid(label, 'a number', raw, hint);
  return value;
}

function toBoolean(raw: string, label: string, hint?: string): boolean {
  const normalized = raw.toLowerCase();
  if (normalized !== 'true' && normalized !== 'false') {
    throw invalid(label, 'true or false', raw, hint);
  }
  return normalized === 'true';
}

function toEnum(raw: string, label: string, allowed: readonly string[]): string {
  if (!allowed.includes(raw)) throw invalid(label, `one of ${allowed.join(', ')}`, raw);
  return raw;
}

function toDateTime(raw: string, label: string): string {
  try {
    return normalizeDateTime(raw);
  } catch {
    throw invalid(label, 'a date-time', raw, DATE_TIME_HINT);
  }
}

/**
 * Converts one raw value per its spec. `label` is the option as the user typed it, e.g.
 * `--max-results`, `<metrics-name>` or `--var amount`; `hint` is added to type errors.
 */
export function convertScalar(spec: ScalarSpec, raw: string, label: string, hint?: string): Scalar {
  if (spec.enum !== undefined) return toEnum(raw, label, spec.enum);
  if (spec.type === 'integer') return toInteger(raw, label, spec, hint);
  if (spec.type === 'number') return toNumber(raw, label, hint);
  if (spec.type === 'boolean') return toBoolean(raw, label, hint);
  if (spec.format === 'date-time') return toDateTime(raw, label);
  return raw;
}
