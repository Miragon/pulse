/**
 * `pulse-cli auth status`: where the bearer token comes from and, for a JWT, its claims
 * (auth-bearer.ts). pulse-cli never logs in itself: a token command prints the token.
 */

import type { Command } from "commander"
import { commandToken } from "../../auth/command-provider.js"
import type { BearerAuthConfig } from "../../config/types.js"
import type { Runtime } from "../../runtime.js"
import { subcommand } from "../command.js"
import type { CliContext } from "../context.js"
import { addGlobalOptions } from "../globals.js"
import { type Session, sessionAuthDeps } from "../session.js"
import { bearerStatusView, expiredError } from "./auth-bearer.js"
import { printView, withWidth } from "./auth-output.js"
import { authSession, bearerOf } from "./auth-session.js"
import type { UtilityCommand } from "./types.js"

/** `--auth-token-stdin` lets `auth status` show a piped bearer token. */
const STATUS_OPTIONS = ["profile", "config", "output", "auth-token-stdin"]
const OPTIONS_GROUP = "Options:"

const DESCRIPTION = [
  "Check the bearer token pulse-cli sends.",
  "",
  'pulse-cli never logs in itself. For single sign-on, PULSE_CLI_TOKEN_COMMAND names a command that prints a token (e.g. "az account get-access-token --query accessToken -o tsv"); "pulse-cli auth status" shows where the token comes from and, for a JWT, its subject, issuer, audience and expiry.',
].join("\n")

/**
 * `auth status` of a bearer token: the view, then TOKEN_EXPIRED for an expired JWT. A token
 * command runs (unless its token is cached); it fails before the view.
 */
async function bearerStatus(auth: BearerAuthConfig, session: Session, runtime: Runtime) {
  const display = withWidth(session, runtime)
  if (auth.command !== undefined) {
    const { entry, cached } = await commandToken(auth, sessionAuthDeps(session, runtime))
    printView(bearerStatusView(auth, entry.token, runtime.now(), cached), display, runtime)
    return
  }
  const now = runtime.now()
  printView(bearerStatusView(auth, auth.token, now), display, runtime)
  const expired = expiredError(auth, now)
  if (expired !== undefined) throw expired
}

async function runStatus(command: Command, context: CliContext): Promise<void> {
  const session = await authSession(command, context)
  await bearerStatus(bearerOf(session), session, context.runtime)
}

function registerStatus(auth: Command, context: CliContext): void {
  const command = subcommand(auth, "status").description(
    "Show the bearer token without sending it: its source (PULSE_CLI_TOKEN_COMMAND runs, unless its token is cached) and, for a JWT, subject, issuer, audience and expiry; an expired JWT given as such exits with TOKEN_EXPIRED (exit 4). Never prints a token.",
  )
  addGlobalOptions(command, STATUS_OPTIONS, OPTIONS_GROUP)
  command.action(() => runStatus(command, context))
}

export const authCommand: UtilityCommand = {
  name: "auth",
  nested: true,
  register(program, context) {
    const auth = subcommand(program, "auth")
      .summary("Check the bearer token")
      .description(DESCRIPTION)
    registerStatus(auth, context)
  },
}
