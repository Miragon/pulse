/** `pulse-cli guide config`: profiles, project files, the environment, named engines and headers. */

import type { GuideTopic } from "./topic.js"

export const CONFIG_TOPIC: GuideTopic = {
  name: "config",
  summary: "Profiles, config and project files, environment variables, engines, headers, timeouts",
  text: `# pulse-cli guide config: profiles, project files, environment and engines

Every setting is resolved on its own: flag > environment variable > profile > default.
\`pulse-cli config show\` prints the values an operation command resolves and where each one comes
from.

## Profiles

\`\`\`sh
pulse-cli config set local --url http://localhost:8080/engine-rest --default
pulse-cli config set prod --url https://camunda.example.com/engine-rest --read-only
pulse-cli config list
pulse-cli config show --profile prod
pulse-cli config use local
pulse-cli ping --profile prod
pulse-cli config unset prod readOnly
pulse-cli config delete prod
\`\`\`

- \`config set <profile>\` creates or updates a profile; only the given values change. The first
  profile becomes the default; \`config use\` makes another one the default, \`--profile\` or
  \`PULSE_CLI_PROFILE\` pick one per call.
- \`config set\` stores \`--output\` in the profile and prints in the \`-o\` format; \`config show\`
  shows the values an operation command resolves (its own \`-o\` only formats the output).
- \`config unset <profile> <key...>\` removes settings (\`url\`, \`engine\`, \`auth\`, \`output\`,
  \`timeout\`, \`headers\`, \`readOnly\`, ...); \`config delete\` removes the profile. An edit that
  changes or removes OAuth settings removes the cached login of the old ones, unless another
  profile of the file shares it; that of a project file in a repository stays (another worktree
  may use it), \`pulse-cli auth logout\` ends it.
- \`pulse-cli config path\` prints the config file location (\`--config <path>\` overrides it; a file
  named with \`--config\` or \`PULSE_CLI_CONFIG\` must exist, \`config set\` creates it).
- Use read-only profiles (\`--read-only\`) for production engines: they refuse every command whose
  effect is not \`read\`. Use only \`--config\` files you trust.

## Project file

A repository can share its profiles in \`.pulse-cli.json\`, looked up from the working directory up to
the repository root. They join the profiles of your config file: on a name clash your own profile
wins as a whole, and the project's \`defaultProfile\` (one of its own profiles) wins inside the
repository. A project file names engines, never credentials: they come from the environment
(\`PULSE_CLI_TOKEN\`, \`PULSE_CLI_TOKEN_COMMAND\`, \`PULSE_CLI_PASSWORD\`,
\`PULSE_CLI_OAUTH_CLIENT_SECRET\`) or a profile of the same name in your own file.

\`\`\`sh
pulse-cli config set svc --project --url http://localhost:8112/engine-rest/svc --default
pulse-cli config list
pulse-cli config path --project
\`\`\`

- \`config set|unset|use|delete --project\` write the project file (a new one goes to the repository
  root); without \`--project\` they write your own file. \`config list\` shows the \`scope\` of each
  profile (\`user\` or \`project\`), \`config show\` the file of the selected one.
- \`--config\` and \`PULSE_CLI_CONFIG\` name one config file and leave the project file out.

## Environment

- Variables: \`PULSE_CLI_URL\`, \`PULSE_CLI_ENGINE\`, \`PULSE_CLI_FLAVOR\`, \`PULSE_CLI_PROFILE\`,
  \`PULSE_CLI_CONFIG\`, \`PULSE_CLI_OUTPUT\`, \`PULSE_CLI_TIMEOUT\`, \`PULSE_CLI_READ_ONLY\`,
  \`PULSE_CLI_AUTH\`, \`PULSE_CLI_USERNAME\`, \`PULSE_CLI_PASSWORD\`, \`PULSE_CLI_TOKEN\`,
  \`PULSE_CLI_TOKEN_COMMAND\`, \`PULSE_CLI_OAUTH_*\`, \`PULSE_CLI_HEADERS\`.
- Each value is resolved on its own, so with \`--url\` or \`PULSE_CLI_URL\` set the credentials of the
  profile go to that URL: check \`pulse-cli config show\` when a shell has a leftover \`PULSE_CLI_URL\`.

## Engines, headers and timeouts

- \`--engine <name>\` addresses a named process engine (\`/engine/{name}/...\`); \`ping\` checks it.
- \`--flavor <name>\` (\`PULSE_CLI_FLAVOR\`, profile key \`flavor\`) names the product:
  \`operaton\`, \`cibseven\` or \`camunda7\` (default). It selects the commands of that engine.
- \`-H 'Name: value'\` (repeatable), \`PULSE_CLI_HEADERS\` (one per line) or the headers of a profile
  (\`config set --header\`) add request headers such as an API key; they merge per name: profile,
  then \`PULSE_CLI_HEADERS\`, then \`-H\`. Secret headers are masked unless \`--show-secrets\`.
- \`--timeout <ms>\` bounds every request (default 30000, \`PULSE_CLI_TIMEOUT\`).

\`\`\`sh
pulse-cli ping --engine default
pulse-cli config set prod --url https://camunda.example.com/engine-rest --header 'X-Tenant-Id: acme'
pulse-cli process-instance list --profile local --timeout 10000 -H 'X-Request-Id: 42'
\`\`\`
`,
}
