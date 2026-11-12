/** The character classes and shapes the checks of names, keys and values share. */

/** Control characters (C0, DEL, C1): RFC 7617 and RFC 6749 forbid them in credentials. */
export const CONTROL = /\p{Cc}/u

/** A portable environment variable name. */
export const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * A profile name: letters, digits, ".", "_" and "-", starting with a letter or digit. Names
 * appear in commands people and agents run, as the `engine` selector of the MCP tools and as the
 * engine id metrics carry. Digits alone are a name too: the parser keeps the order of the file's
 * text, where JSON.parse would move such keys to the front.
 */
export const PROFILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** An environment id: lower case letters, digits and "-", starting with a letter or digit. */
export const ENVIRONMENT_ID = /^[a-z0-9][a-z0-9-]*$/

/**
 * A key a message may name. An unknown key that does not look like one may be a credential
 * typed in the wrong place, so it is never shown.
 */
const KEY_LIKE = /^\$?[A-Za-z][A-Za-z0-9_-]{0,39}$/

/** A variable name as people write them: upper case letters, digits and "_", at most 64. */
const CONVENTIONAL_NAME = /^[A-Z_][A-Z0-9_]{0,63}$/
/** The longest word between "_" of a conventional name; longer runs look like a random token. */
const MAX_WORD = 24

/** True for a string that is not blank. */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== ""
}

/** True for a JSON object: no array, no null. */
export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** True for a key a message may name. */
export function isKeyLike(key: string): boolean {
  return KEY_LIKE.test(key)
}

/**
 * True for a variable name in the usual form. Many secrets are valid variable names too
 * (GitHub's `ghp_...`, long alphanumeric tokens, most passwords), so a message names a variable
 * only in this form.
 */
export function isConventionalVariable(name: string): boolean {
  return CONVENTIONAL_NAME.test(name) && name.split("_").every((word) => word.length <= MAX_WORD)
}
