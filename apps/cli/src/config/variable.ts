/**
 * The names of the environment variables that hold secrets: the Basic
 * auth password (`--auth-password-env`, auth.passwordEnv), the OAuth client secret
 * (`--oauth-client-secret-env`, auth.clientSecretEnv) and the bearer token (`--auth-token-env`,
 * auth.tokenEnv). Many secrets are valid variable names (GitHub's `ghp_...`, passwords without
 * special characters), so a secret typed in place of the name must not be repeated: messages name
 * a variable only in the usual form, and `config set` refuses an unset name in another form
 * before anything is stored.
 */

import { configError } from "./config-error.js"
import type { Env } from "./pick.js"
import { ENV_NAME } from "./syntax.js"

/** A secret that a profile keeps in an environment variable, as messages name it. */
export interface SecretVariable {
  /** The option of `config set`: `--auth-token-env`. */
  readonly flag: string
  /** The key of the profile's auth object: `tokenEnv`. */
  readonly key: string
  /** What the variable holds: `token`. */
  readonly noun: string
  /** The value in examples: `<token>`. */
  readonly placeholder: string
  /** A variable name in the usual form, for examples. */
  readonly example: string
}

export const PASSWORD_VARIABLE: SecretVariable = {
  flag: "--auth-password-env",
  key: "passwordEnv",
  noun: "password",
  placeholder: "<password>",
  example: "CAMUNDA_PASSWORD",
}

export const CLIENT_SECRET_VARIABLE: SecretVariable = {
  flag: "--oauth-client-secret-env",
  key: "clientSecretEnv",
  noun: "client secret",
  placeholder: "<secret>",
  example: "OPERATE_CLIENT_SECRET",
}

export const TOKEN_VARIABLE: SecretVariable = {
  flag: "--auth-token-env",
  key: "tokenEnv",
  noun: "token",
  placeholder: "<token>",
  example: "CI_ENGINE_TOKEN",
}

/** A variable name as people write them: upper case letters, digits and "_", at most 64. */
const CONVENTIONAL_NAME = /^[A-Z_][A-Z0-9_]{0,63}$/
/** Longest word between "_" of a conventional name; longer runs look like a random token. */
const MAX_WORD = 24

/**
 * True for a variable name in the usual form. Secrets that are valid variable names (GitHub's
 * `ghp_...`, long alphanumeric reference tokens, most passwords) are not, so messages never
 * repeat them.
 */
export function isConventionalVariable(name: string): boolean {
  return CONVENTIONAL_NAME.test(name) && name.split("_").every((word) => word.length <= MAX_WORD)
}

/**
 * Checks the name given to the `--*-env` option of `config set`. An invalid name is not
 * repeated: it may be the secret itself, given by mistake.
 */
export function validateVariableName(name: string, variable: SecretVariable): string {
  const trimmed = name.trim()
  if (!ENV_NAME.test(trimmed)) {
    const { flag, example, noun } = variable
    throw configError(
      `Invalid ${flag}: expected the name of an environment variable`,
      `Use letters, digits and "_", not starting with a digit, e.g. ${flag} ${example}; the variable holds the ${noun}.`,
    )
  }
  return trimmed
}

/** True when `name` has a non-blank value in `env`. */
function isSet(name: string, env: Env): boolean {
  return (env[name] ?? "").trim() !== ""
}

/**
 * True when a variable name may be the secret itself: not in the usual form and not set in
 * `env`. `config set` refuses such a name, and the profile it prints masks one that a
 * hand-edited file holds.
 */
export function mayBeSecret(name: string, env: Env): boolean {
  return !isConventionalVariable(name) && !isSet(name, env)
}

/**
 * `config set --*-env <name>`: a valid name, and one that is either set now or in the usual
 * form. An unset name in another form is most likely the secret itself (`--auth-token-env
 * "$CI_TOKEN"`, `--auth-password-env s3cret_pw`): refused before anything is stored, without
 * repeating it.
 */
export function checkVariableName(name: string, env: Env, variable: SecretVariable): string {
  const valid = validateVariableName(name, variable)
  if (!mayBeSecret(valid, env)) return valid
  const { flag, noun, example } = variable
  throw configError(
    `${flag} names a variable that is not set and does not look like a variable name: it may be the ${noun} itself, so it is neither stored nor repeated`,
    `Pass the name of the variable that holds the ${noun}, not its value: ${flag} ${example}, not ${flag} "$${example}". A name in another form (lower case, very long) is accepted once the variable is set.`,
  )
}

/** The `--*-env` options of `config set`, by the name of their change. */
const OPTIONS = [
  ["authPasswordEnv", PASSWORD_VARIABLE],
  ["oauthClientSecretEnv", CLIENT_SECRET_VARIABLE],
  ["authTokenEnv", TOKEN_VARIABLE],
] as const

/** The variable names given to `config set`. */
export type VariableNames = Readonly<Partial<Record<(typeof OPTIONS)[number][0], string>>>

/** `checkVariableName` for every `--*-env` option given to `config set`. */
export function checkVariableNames(names: VariableNames, env: Env): void {
  for (const [option, variable] of OPTIONS) {
    const name = names[option]
    if (name !== undefined) checkVariableName(name, env, variable)
  }
}

/**
 * Warnings after `config set` stored the name of a variable that is not set in this environment
 * (`checkVariableNames` let only names in the usual form through). The name is not repeated:
 * given by mistake, it may be the secret itself.
 */
export function unsetVariableWarnings(names: VariableNames, env: Env): string[] {
  return OPTIONS.filter(([option]) => {
    const name = names[option]
    return name !== undefined && !isSet(name.trim(), env)
  }).map(
    ([, { flag, noun, example }]) =>
      `Warning: the variable named by ${flag} is not set in this environment. Pass the name of a variable that holds the ${noun} (e.g. ${example}), never the ${noun} itself; commands read it when they run.`,
  )
}

/**
 * The CONFIG error for the variable `name` that auth.passwordEnv (clientSecretEnv, tokenEnv) of
 * `profile` names, when it is not set or empty. The name is repeated only in the usual form: an
 * unusual one may be the secret itself, stored by mistake.
 */
export function unsetVariable(name: string, profile: string, variable: SecretVariable) {
  const { flag, key, noun, placeholder } = variable
  const another = `name another variable with \`operate config set ${profile} ${flag} <VAR>\``
  if (isConventionalVariable(name)) {
    return configError(
      `The ${noun} variable ${name} (auth.${key} of profile "${profile}") is not set or empty`,
      `Export it, e.g. export ${name}=${placeholder}, or ${another}.`,
    )
  }
  return configError(
    `The ${noun} variable named by auth.${key} of profile "${profile}" is not set or empty`,
    `Its name is not in the usual upper-case form, so it is not repeated: it may be a ${noun} stored by mistake. Check auth.${key} in the config file (\`operate config path\`), or ${another}.`,
  )
}
