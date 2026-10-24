/** `pulse-cli guide auth`: Basic auth, bearer tokens, token commands and OAuth logins. */

import type { GuideTopic } from "./topic.js"

export const AUTH_TOPIC: GuideTopic = {
  name: "auth",
  summary: "Basic auth, bearer tokens and token commands, OAuth logins, what to do on exit 4",
  text: `# pulse-cli guide auth: Basic auth, bearer tokens and OAuth

The auth type comes from \`--auth none|basic|oauth|bearer\`, \`PULSE_CLI_AUTH\` or the profile; without
one, a username selects Basic auth and a token bearer auth. \`pulse-cli ping\` reports the auth in
use, \`pulse-cli config show\` every value with its source. Secrets are masked unless
\`--show-secrets\`.

## Basic auth

The username comes from \`--auth-user\`, \`PULSE_CLI_USERNAME\` or the profile, the password from
\`--auth-password-stdin\` (first line of stdin, never a flag), \`PULSE_CLI_PASSWORD\` or the profile
(best as a variable name: \`--auth-password-env <VAR>\`). A username or \`--auth-password-stdin\`
selects Basic auth, \`--auth none\` or \`PULSE_CLI_AUTH=none\` switch it off; missing values exit 3. A
401 hint says why no credentials were sent or which user the engine rejected.

\`\`\`sh
printf '%s\\n' "$CAMUNDA_PASSWORD" | pulse-cli ping --auth basic --auth-user demo --auth-password-stdin
pulse-cli config set prod --auth basic --auth-user demo --auth-password-env CAMUNDA_PASSWORD
\`\`\`

## Bearer tokens

Bearer tokens from elsewhere (SSO tooling, CI): \`PULSE_CLI_TOKEN\`, \`--auth-token-stdin\` or a profile
(\`--auth-token-env <VAR>\`) select \`--auth bearer\` (add it if \`PULSE_CLI_AUTH\` or the profile sets
another type); \`pulse-cli auth status\` shows its source and JWT expiry. It is never refreshed: on
exit 4 \`TOKEN_EXPIRED\` ask the user for a new token.

\`\`\`sh
pulse-cli config set ci --auth bearer --auth-token-env CI_ENGINE_TOKEN
\`\`\`

## Token commands

\`PULSE_CLI_TOKEN_COMMAND\` holds a command line that prints the token on its first line. pulse-cli
runs it in the working directory when it needs a token, reuses a JWT until shortly before it expires
(also in later calls) and runs it again after a 401. A failing command exits 4 with \`LOGIN_FAILED\`
and the end of its stderr. \`pulse-cli auth status\` runs it and shows the token's claims;
\`pulse-cli auth logout\` drops the cached token. A repository sets it for agents in the \`env\` of its
\`.claude/settings.json\`, so agent command lines stay short. Use an absolute path or no path: a
relative one (\`./token.sh\`) runs the script of whatever directory pulse-cli runs in.

\`\`\`json
{
  "env": {
    "PULSE_CLI_TOKEN_COMMAND": "curl -s -d grant_type=password -d client_id=pulse-cli-dev -d username=demo -d password=demo http://localhost:8180/realms/dev/protocol/openid-connect/token | jq -r .access_token"
  }
}
\`\`\`

## OAuth

OAuth (\`PULSE_CLI_OAUTH_*\` or a profile): a person runs \`pulse-cli auth login --profile <name>\` once
in a terminal, then commands refresh the token. Never run \`auth login\` yourself. On exit 4 with
\`LOGIN_REQUIRED\`, stop and ask the user to run the command from the hint in a terminal, then retry.
\`UNAUTHORIZED\`/\`FORBIDDEN\` despite a login is a gateway (issuer, audience, clock) or permission
problem: do not ask for a new login, report message and hint. \`pulse-cli auth status\` (no network)
tells if the login is usable. One login serves every OAuth profile of the same config file, project
file or repository that stores the same issuer, client, audience and scopes: after the user logged
in once, retry the others too. Use only \`--config\` files you trust.

\`\`\`sh
pulse-cli config set sso --auth oauth --oauth-issuer https://login.example.com/realms/camunda --oauth-client-id pulse-cli
\`\`\`

## Other schemes

API keys and gateway specific headers go into request headers (\`-H\`, \`PULSE_CLI_HEADERS\` or a
profile, see \`pulse-cli guide config\`). An \`Authorization\` header together with Basic auth, OAuth or
a bearer token is a configuration error (exit 3).
`,
}
