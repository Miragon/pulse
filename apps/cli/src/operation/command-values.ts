/** The parsed command line of an operation command, and helpers to read single flag values. */

import type { FileSystem } from '../runtime.js';
import { convertScalar, type Scalar, type ScalarSpec } from './values.js';

export type FlagValue = string | boolean | readonly string[];

export interface CommandValues {
  /** Positional arguments: path params in path order, then resource files (deployment create). */
  readonly args: readonly string[];
  /**
   * Operation option values keyed by catalog flag (kebab, no dashes): query param flags, body field
   * flags, variable map flags (string[]), 'body', 'value', 'validate' (boolean), 'base-dir', 'all'.
   * Booleans: true for --x, false for --no-x. Repeatable flags: string[]. Absent key = not given.
   */
  readonly flags: Readonly<Record<string, FlagValue | undefined>>;
}

export interface InputDeps {
  readonly fs: FileSystem;
  readStdin(): Promise<Uint8Array>;
}

/** A single-valued flag as text; for repeated values the last occurrence wins. */
export function lastString(value: FlagValue): string {
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'string') return value;
  return value.at(-1) ?? '';
}

/** A repeatable list flag: every occurrence split on commas, trimmed, empty entries dropped. */
export function listValues(value: FlagValue): string[] {
  return occurrences(value)
    .flatMap((occurrence) => occurrence.split(','))
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

/** A repeatable flag whose occurrences must not be split (e.g. `--var a=1,2`). */
export function occurrences(value: FlagValue): string[] {
  return typeof value === 'object' ? [...value] : [String(value)];
}

/** Types a scalar flag value; booleans from `--x` / `--no-x` arrive as `true` / `false`. */
export function scalarFlag(spec: ScalarSpec, value: FlagValue, label: string): Scalar {
  return convertScalar(spec, lastString(value), label);
}
