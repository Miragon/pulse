/**
 * Character classes shared by the validators of the auth settings (Basic auth and OAuth) and of
 * profile names.
 */

/** Control characters (C0, DEL, C1): RFC 7617 and RFC 6749 forbid them in credentials. */
export const CONTROL = /\p{Cc}/u;

/** A portable environment variable name. */
export const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** True for a string that is not blank. */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * A profile name: letters, digits, ".", "_" and "-", starting with a letter or digit. Names
 * appear in hints and commands that people and agents run, so the config file parser enforces it
 * as well as `config set`.
 */
export const PROFILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
