/**
 * The secrets `pulse-cli config set` reads from stdin and the notices on stderr after
 * `config set` (Basic auth and bearer tokens).
 */

import type { Command } from "commander"
import {
  FAMILY_NAMES,
  replacedAuthorization,
  replacedFamily,
  SETTING_NAMES,
  settingsFamily,
  storedFamily,
} from "../../config/auth-edit.js"
import type { Env } from "../../config/pick.js"
import type { Profile } from "../../config/types.js"
import { unsetVariableWarnings, type VariableNames } from "../../config/variable.js"
import { usageError } from "../../errors.js"
import type { CliContext } from "../context.js"
import { readStdinPassword, type StdinSecret } from "../stdin-password.js"
import { STORED_TOKEN, storedTokenWarning } from "./config-bearer.js"

/** The secrets `config set` read from stdin; each is stored literally. */
export interface SetSecrets {
  readonly password?: string | undefined
  readonly token?: string | undefined
}

/** The stdin options of `config set`, by the flag that reads them. */
const STDIN_OPTIONS = [
  ["authPasswordStdin", "--auth-password-stdin"],
  ["authTokenStdin", "--auth-token-stdin"],
] as const

/**
 * The secrets `config set` reads from stdin: a Basic auth password or a bearer token; both would
 * read stdin.
 */
export async function readSetSecrets(command: Command, context: CliContext): Promise<SetSecrets> {
  const options = command.opts<Partial<Record<(typeof STDIN_OPTIONS)[number][0], boolean>>>()
  const given = STDIN_OPTIONS.filter(([key]) => options[key] === true).map(([, flag]) => flag)
  if (given.length > 1) {
    throw usageError(
      `${given.join(" and ")} both read stdin`,
      "A profile uses Basic auth or a bearer token; give the option of one of them.",
    )
  }
  const { runtime } = context
  const read = async (key: (typeof STDIN_OPTIONS)[number][0], secret?: StdinSecret) =>
    options[key] === true ? await readStdinPassword(runtime, secret) : undefined
  return {
    password: await read("authPasswordStdin"),
    token: await read("authTokenStdin", STORED_TOKEN),
  }
}

/** What `config set` did that deserves a note on stderr. */
export interface SetOutcome {
  readonly name: string
  readonly path: string
  readonly before: Profile | undefined
  readonly after: Profile | undefined
  /** What was read from stdin (and stored literally). */
  readonly secrets: SetSecrets
  /** The variable names given to the `--*-env` options. */
  readonly changes: VariableNames
  readonly env: Env
}

function familyNotice(outcome: SetOutcome): string | undefined {
  const replaced = replacedFamily(outcome.before?.auth, outcome.after?.auth)
  const by = settingsFamily(outcome.after?.auth)
  if (replaced === undefined || by === undefined) return undefined
  return `Notice: removed the ${SETTING_NAMES[replaced]} settings of the profile; ${FAMILY_NAMES[by]} replaces them.`
}

function headerNotice(outcome: SetOutcome): string | undefined {
  const family = storedFamily(outcome.after?.auth)
  if (family === undefined || !replacedAuthorization(outcome.before, outcome.after)) {
    return undefined
  }
  return `Notice: removed the Authorization header of the profile; ${FAMILY_NAMES[family]} replaces it.`
}

/**
 * Notes on stderr after `config set`. An unset variable is not named: given by mistake, the
 * "name" may be the secret itself.
 */
export function setNotices(outcome: SetOutcome): string[] {
  const { secrets, changes, env, path } = outcome
  return [
    familyNotice(outcome),
    headerNotice(outcome),
    secrets.password !== undefined
      ? `Warning: the password is stored in plain text in ${path} (mode 0600). Prefer --auth-password-env <VAR>, which stores only the name of an environment variable.`
      : undefined,
    secrets.token === undefined ? undefined : storedTokenWarning(path),
    ...unsetVariableWarnings(changes, env),
  ].filter((notice) => notice !== undefined)
}
