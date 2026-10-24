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
      "Log in with OAuth 2.0 (authorization code flow with PKCE) and manage the cached",
      "tokens.",
      "",
      'A person runs "pulse-cli auth login" once in a terminal; every other command',
      "reads the token cache and refreshes the token on its own. Agents never log in",
      "themselves: without a usable login a command fails with LOGIN_REQUIRED (exit 4).",
      "",
      "A bearer token from elsewhere (--auth bearer, PULSE_CLI_TOKEN) needs no login:",
      '"pulse-cli auth status" shows where it comes from and, for a JWT, its subject,',
      "issuer, audience and expiry.",
      "",
      "Options:",
      "  -h, --help      Display help for command",
      "",
      "Commands:",
      "  login           Log in with the OAuth settings of the profile: prints the",
      "                  authorization URL, opens the system browser and waits for the",
      "                  login at http://127.0.0.1:<port>/callback. Replaces a cached",
      "                  login. Meant for a person in a terminal, not for agents.",
      "  status          Show the cached OAuth login without network access: user,",
      "                  scopes and the expiry of the access and refresh token. Exit 0",
      "                  when commands can run without a new login, else LOGIN_REQUIRED",
      "                  (exit 4). With a bearer token: its source",
      "                  (PULSE_CLI_TOKEN_COMMAND runs, unless its token is cached)",
      "                  and, for a JWT, subject, issuer, audience and expiry; an",
      "                  expired JWT given as such exits with TOKEN_EXPIRED (exit 4).",
      "                  Never prints a token.",
      "  logout          Revoke the refresh token at the authorization server (when it",
      "                  supports revocation) and remove the cached login, for every",
      "                  profile that shares it. Works for a profile whose OAuth",
      "                  settings no longer resolve.",
      "  help [command]  Display help for a command",
    ],
  ],
  [
    "auth login",
    [
      "Usage: pulse-cli auth login [options]",
      "",
      "Log in with the OAuth settings of the profile: prints the authorization URL,",
      "opens the system browser and waits for the login at",
      "http://127.0.0.1:<port>/callback. Replaces a cached login. Meant for a person in",
      "a terminal, not for agents.",
      "",
      "Options:",
      "  --no-browser           Only print the URL; do not start the system browser",
      "  --login-timeout <ms>   How long to wait for the login, default 300000",
      "  --profile <name>       Profile of the config file (env PULSE_CLI_PROFILE)",
      "  --config <path>        Config file location (env PULSE_CLI_CONFIG)",
      "  -o, --output <format>  json or table; default: table on a terminal, else json",
      "                         (env PULSE_CLI_OUTPUT)",
      "  --timeout <ms>         Request timeout in milliseconds, default 30000 (env",
      "                         PULSE_CLI_TIMEOUT)",
      "  --verbose              Trace requests and responses on stderr",
      "  -h, --help             Display help for command",
    ],
  ],
  [
    "auth status",
    [
      "Usage: pulse-cli auth status [options]",
      "",
      "Show the cached OAuth login without network access: user, scopes and the expiry",
      "of the access and refresh token. Exit 0 when commands can run without a new",
      "login, else LOGIN_REQUIRED (exit 4). With a bearer token: its source",
      "(PULSE_CLI_TOKEN_COMMAND runs, unless its token is cached) and, for a JWT,",
      "subject, issuer, audience and expiry; an expired JWT given as such exits with",
      "TOKEN_EXPIRED (exit 4). Never prints a token.",
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
  [
    "auth logout",
    [
      "Usage: pulse-cli auth logout [options]",
      "",
      "Revoke the refresh token at the authorization server (when it supports",
      "revocation) and remove the cached login, for every profile that shares it. Works",
      "for a profile whose OAuth settings no longer resolve.",
      "",
      "Options:",
      "  --profile <name>       Profile of the config file (env PULSE_CLI_PROFILE)",
      "  --config <path>        Config file location (env PULSE_CLI_CONFIG)",
      "  -o, --output <format>  json or table; default: table on a terminal, else json",
      "                         (env PULSE_CLI_OUTPUT)",
      "  --timeout <ms>         Request timeout in milliseconds, default 30000 (env",
      "                         PULSE_CLI_TIMEOUT)",
      "  --verbose              Trace requests and responses on stderr",
      "  -h, --help             Display help for command",
    ],
  ],
]

describe("help texts", () => {
  it.each(HELP)('documents "pulse-cli %s" with its arguments and options', async (path, lines) => {
    expect(await help(path.split(" "))).toBe(`${lines.join("\n")}\n`)
  })
})
