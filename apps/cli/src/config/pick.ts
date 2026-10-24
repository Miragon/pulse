/** The precedence rule of config resolution: flag > environment > profile > default. */

import type { Source } from './types.js';

export type Env = Readonly<Record<string, string | undefined>>;

export interface Picked<T> {
  readonly value: T | undefined;
  readonly source: Source;
}

/** A flag or environment value: blank means unset, anything else is trimmed. */
export function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === '' ? undefined : value.trim();
}

/** The first defined value with its source; `default` with no value when none is defined. */
export function pick<T>(
  flag: T | undefined,
  env: T | undefined,
  profile: T | undefined,
): Picked<T> {
  if (flag !== undefined) return { value: flag, source: 'flag' };
  if (env !== undefined) return { value: env, source: 'env' };
  if (profile !== undefined) return { value: profile, source: 'profile' };
  return { value: undefined, source: 'default' };
}
