/** `operate guide config`: profiles, project files, the environment, named engines and headers. */

import type { GuideTopic } from "./topic.js"

export const CONFIG_TOPIC: GuideTopic = {
  name: "config",
  summary: "Profiles, config and project files, environment variables, engines, headers, timeouts",
  text: `# operate guide config: profiles, project files, environment and engines

Every setting is resolved on its own: flag > environment variable > profile > default.
\`operate config show\` prints the values an operation command resolves and where each one comes
from.

## Profiles

\`\`\`sh
operate config set local --url http://localhost:8080/engine-rest --default
operate config set prod --url https://camunda.example.com/engine-rest --read-only
operate config list
operate config show --profile prod
operate config use local
operate ping --profile prod
operate config unset prod readOnly
operate config delete prod
\`\`\`

- \`config set <profile>\` creates or updates a profile; only the given values change. The first
  profile becomes the default; \`config use\` makes another one the default, \`--profile\` or
  \`OPERATE_PROFILE\` pick one per call.
- \`config set\` stores \`--output\` in the profile and prints in the \`-o\` format; \`config show\`
  shows the values an operation command resolves (its own \`-o\` only formats the output).
- \`config unset <profile> <key...>\` removes settings (\`url\`, \`engine\`, \`auth\`, \`output\`,
  \`timeout\`, \`headers\`, \`readOnly\`, ...); \`config delete\` removes the profile. An edit that
  changes or removes OAuth settings removes the cached login of the old ones, unless another
  profile of the file shares it; that of a project file in a repository stays (another worktree
  may use it), \`operate auth logout\` ends it.
- \`operate config path\` prints the config file location (\`--config <path>\` overrides it; a file
  named with \`--config\` or \`OPERATE_CONFIG\` must exist, \`config set\` creates it).
- Use read-only profiles (\`--read-only\`) for production engines: they refuse every command whose
  effect is not \`read\`. Use only \`--config\` files you trust.

## Project file

A repository can share its profiles in \`.operate.json\`, looked up from the working directory up to
the repository root. They join the profiles of your config file: on a name clash your own profile
wins as a whole, and the project's \`defaultProfile\` (one of its own profiles) wins inside the
repository. A project file names engines, never credentials: they come from the environment
(\`OPERATE_TOKEN\`, \`OPERATE_TOKEN_COMMAND\`, \`OPERATE_PASSWORD\`, \`OPERATE_OAUTH_CLIENT_SECRET\`)
or a profile of the same name in your own file.

\`\`\`sh
operate config set svc --project --url http://localhost:8112/engine-rest/svc --default
operate config list
operate config path --project
\`\`\`

- \`config set|unset|use|delete --project\` write the project file (a new one goes to the repository
  root); without \`--project\` they write your own file. \`config list\` shows the \`scope\` of each
  profile (\`user\` or \`project\`), \`config show\` the file of the selected one.
- \`--config\` and \`OPERATE_CONFIG\` name one config file and leave the project file out.

## Environment

- Variables: \`OPERATE_URL\`, \`OPERATE_ENGINE\`, \`OPERATE_PLATFORM\`, \`OPERATE_PROFILE\`,
  \`OPERATE_CONFIG\`, \`OPERATE_OUTPUT\`, \`OPERATE_TIMEOUT\`, \`OPERATE_READ_ONLY\`, \`OPERATE_AUTH\`,
  \`OPERATE_USERNAME\`, \`OPERATE_PASSWORD\`, \`OPERATE_TOKEN\`, \`OPERATE_TOKEN_COMMAND\`,
  \`OPERATE_OAUTH_*\`, \`OPERATE_HEADERS\`.
- Each value is resolved on its own, so with \`--url\` or \`OPERATE_URL\` set the credentials of the
  profile go to that URL: check \`operate config show\` when a shell has a leftover \`OPERATE_URL\`.

## Engines, headers and timeouts

- \`--engine <name>\` addresses a named process engine (\`/engine/{name}/...\`); \`ping\` checks it.
- \`--platform <name>\` (\`OPERATE_PLATFORM\`, profile key \`platform\`) names the product:
  \`operaton\`, \`cibseven\` or \`camunda7\` (default). It selects the commands of that engine.
- \`-H 'Name: value'\` (repeatable), \`OPERATE_HEADERS\` (one per line) or the headers of a profile
  (\`config set --header\`) add request headers such as an API key; they merge per name: profile,
  then \`OPERATE_HEADERS\`, then \`-H\`. Secret headers are masked unless \`--show-secrets\`.
- \`--timeout <ms>\` bounds every request (default 30000, \`OPERATE_TIMEOUT\`).

\`\`\`sh
operate ping --engine default
operate config set prod --url https://camunda.example.com/engine-rest --header 'X-Tenant-Id: acme'
operate process-instance list --profile local --timeout 10000 -H 'X-Request-Id: 42'
\`\`\`
`,
}
