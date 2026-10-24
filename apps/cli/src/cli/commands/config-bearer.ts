/**
 * The bearer token part of `operate config set` (design §18): `--auth-token-env <VAR>`
 * (recommended: only the name of the variable is stored; `checkVariableNames` of
 * src/config/variable.ts refuses a token given in its place) and `--auth-token-stdin` (the token
 * itself, in plain text in the 0600 file), and the warning after storing a token.
 */

import type { Command } from "commander"
import type { BearerChanges } from "../../config/bearer-edit.js"
import { compact } from "../../util.js"
import type { StdinSecret } from "../stdin-password.js"

/** `config set --auth-token-stdin` stores what it reads. */
export const STORED_TOKEN: StdinSecret = {
  flag: "--auth-token-stdin",
  noun: "token",
  example: `printf '%s\\n' "$TOKEN" | operate config set <profile> --auth bearer --auth-token-stdin`,
}

export function addBearerOptions(command: Command): Command {
  return command
    .option(
      "--auth-token-env <VAR>",
      "Name of the environment variable that holds the bearer token (recommended)",
    )
    .option(
      "--auth-token-stdin",
      "Store the bearer token read from the first line of stdin (plain text in the file; discouraged)",
    )
}

/** The bearer changes of `config set`; `token` is what --auth-token-stdin read. */
export function bearerChanges(command: Command, token: string | undefined): BearerChanges {
  const { authTokenEnv } = command.opts<{ readonly authTokenEnv?: string }>()
  return compact({ authTokenEnv, authToken: token })
}

/** The warning after storing a token read from stdin: it is plain text in the file. */
export function storedTokenWarning(path: string): string {
  return `Warning: the bearer token is stored in plain text in ${path} (mode 0600). Prefer --auth-token-env <VAR>, which stores only the name of an environment variable.`
}
