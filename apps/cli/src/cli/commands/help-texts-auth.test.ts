/** The help texts of the auth commands, word for word. */

import { describe, expect, it } from "vitest"
import { helpOf } from "../../../test/support/help-text.js"
import { run } from "../run.js"

const help = (args: readonly string[]) => helpOf(run, args)

/** The complete help of the auth commands (80 columns, not a terminal). */
const HELP: readonly (readonly [string, readonly string[]])[] = [
  [
    "auth",
    [
      "Usage: pulse-cli auth [options] [command]",
      "",
      "Check the bearer token pulse-cli sends.",
      "",
      "pulse-cli never logs in itself. For single sign-on, PULSE_CLI_TOKEN_COMMAND",
      'names a command that prints a token (e.g. "az account get-access-token --query',
      'accessToken -o tsv"); "pulse-cli auth status" shows where the token comes from',
      "and, for a JWT, its subject, issuer, audience and expiry.",
      "",
      "Options:",
      "  -h, --help      Display help for command",
      "",
      "Commands:",
      "  status          Show the bearer token without sending it: its source",
      "                  (PULSE_CLI_TOKEN_COMMAND runs, unless its token is cached)",
      "                  and, for a JWT, subject, issuer, audience and expiry; an",
      "                  expired JWT given as such exits with TOKEN_EXPIRED (exit 4).",
      "                  Never prints a token.",
      "  help [command]  Display help for a command",
    ],
  ],
  [
    "auth status",
    [
      "Usage: pulse-cli auth status [options]",
      "",
      "Show the bearer token without sending it: its source (PULSE_CLI_TOKEN_COMMAND",
      "runs, unless its token is cached) and, for a JWT, subject, issuer, audience and",
      "expiry; an expired JWT given as such exits with TOKEN_EXPIRED (exit 4). Never",
      "prints a token.",
      "",
      "Options:",
      "  --profile <name>       Profile of the config file (env PULSE_CLI_PROFILE)",
      "  --config <path>        Config file location (env PULSE_CLI_CONFIG)",
      "  -o, --output <format>  json or table; default: table on a terminal, else json",
      "                         (env PULSE_CLI_OUTPUT)",
      "  --auth-token-stdin     Read the bearer token from the first line of stdin (env",
      "                         PULSE_CLI_TOKEN)",
      "  -h, --help             Display help for command",
    ],
  ],
]

describe("help texts", () => {
  it.each(HELP)('documents "pulse-cli %s" with its arguments and options', async (path, lines) => {
    expect(await help(path.split(" "))).toBe(`${lines.join("\n")}\n`)
  })
})
