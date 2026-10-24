/**
 * `operate config set|unset` changes of a profile's bearer token (design §18): the name of the
 * variable that holds the token (recommended) or the token itself, read from stdin. Each replaces
 * the other; `config unset <profile> token` (or `tokenEnv`) removes the token in either form.
 */

import { compact } from '../util.js';
import { normalizeToken } from './bearer.js';
import { configError } from './config-error.js';
import type { BEARER_AUTH_KEYS, ProfileAuth } from './types.js';
import { TOKEN_VARIABLE, validateVariableName } from './variable.js';

export interface BearerChanges {
  /** Name of the variable holding the token; replaces a stored token. */
  readonly authTokenEnv?: string;
  /** Literal token from stdin (discouraged: stored in plain text); replaces a stored tokenEnv. */
  readonly authToken?: string;
}

type BearerKey = (typeof BEARER_AUTH_KEYS)[number];

/** True when a bearer token option was given. */
export function hasBearerOptions(changes: BearerChanges): boolean {
  return changes.authTokenEnv !== undefined || changes.authToken !== undefined;
}

/** The bearer keys of the changed auth object: stored values, replaced by the given option. */
export function changedBearerKeys(
  existing: ProfileAuth | undefined,
  changes: BearerChanges,
): Pick<ProfileAuth, BearerKey> {
  const { authTokenEnv, authToken } = changes;
  if (authTokenEnv !== undefined && authToken !== undefined) {
    throw configError(
      '--auth-token-env and --auth-token-stdin exclude each other',
      'Store the name of the environment variable that holds the token (recommended), or the token itself.',
    );
  }
  if (authTokenEnv !== undefined) {
    return { tokenEnv: validateVariableName(authTokenEnv, TOKEN_VARIABLE) };
  }
  if (authToken !== undefined) return { token: normalizeToken(authToken, '--auth-token-stdin') };
  return compact({ tokenEnv: existing?.tokenEnv, token: existing?.token });
}

/** The key names of `config unset` for the bearer token, for help texts and hints. */
export const BEARER_UNSET_KEYS: readonly BearerKey[] = ['token', 'tokenEnv'];

/** The auth keys a bearer key name of `config unset` removes (`auth.` prefix allowed), if any. */
export function bearerUnsetKeys(key: string): readonly BearerKey[] | undefined {
  const bare = key.startsWith('auth.') ? key.slice('auth.'.length) : key;
  return (BEARER_UNSET_KEYS as readonly string[]).includes(bare) ? BEARER_UNSET_KEYS : undefined;
}
