# Authentication

`pulse-cli` supports [Basic auth](#basic-auth), [bearer tokens](#bearer-tokens) you get elsewhere,
[token commands](#token-commands) that fetch one, for example from Keycloak, Microsoft Entra ID
or Auth0 ([single sign-on](#single-sign-on)), and [headers](#other-headers) for other schemes.

- The type comes from `--auth none|basic|bearer`, `PULSE_CLI_AUTH` or the profile. Without one,
  a username selects `basic` and a token selects `bearer`.
- Each value resolves on its own: flag > environment variable > profile. With `--url` or
  `PULSE_CLI_URL` set, the profile's credentials go to that URL: check `pulse-cli config show`.
- Secrets are never plain flags and are masked (`***`) in output unless `--show-secrets`.

Every option: `pulse-cli auth status --help`.

## Basic auth

For Camunda 7 Run with `camunda.bpm.run.auth.enabled=true`, CIB seven Run with
`camunda.bpm.run.auth.authentication=basic`, Operaton Run with `operaton.bpm.run.auth.enabled=true`,
or a filter or proxy in front of `/engine-rest`.

| Value    | Flag                    | Environment          | Profile (`auth` object)                     |
| -------- | ----------------------- | -------------------- | ------------------------------------------- |
| type     | `--auth <type>`         | `PULSE_CLI_AUTH`     | `type`: `none` or `basic`                   |
| username | `--auth-user <name>`    | `PULSE_CLI_USERNAME` | `username`                                  |
| password | `--auth-password-stdin` | `PULSE_CLI_PASSWORD` | `passwordEnv` (variable name) or `password` |

```sh
# per call: the password comes from stdin
printf '%s\n' "$CAMUNDA_PASSWORD" | pulse-cli ping --auth basic --auth-user demo --auth-password-stdin
# per shell: read it without echo and without shell history
read -rs PULSE_CLI_PASSWORD && export PULSE_CLI_PASSWORD
pulse-cli task list --assignee demo
# per profile: only the name of the variable is stored
pulse-cli config set staging --url https://staging.example.com/engine-rest --auth basic --auth-user demo --auth-password-env CAMUNDA_PASSWORD
```

- In a profile, store the variable name with `--auth-password-env`; a literal `password` is plain
  text in the `0600` config file (`config set` warns). Pass the name, never the password.
- A missing username or password exits 3. A 401 (exit 4) names the rejected user or the reason
  no credentials were sent.
- Use `https://` beyond `localhost`: Basic auth sends the password readable.

## Bearer tokens

When you already get an access token elsewhere (SSO tooling, a CI secret, `az`, `gcloud`),
`--auth bearer` sends it as `Authorization: Bearer <token>`. No refresh, no cache.

| Value | Flag                 | Environment       | Profile (`auth` object) / `config set` option         |
| ----- | -------------------- | ----------------- | ----------------------------------------------------- |
| type  | `--auth bearer`      | `PULSE_CLI_AUTH`  | `type: "bearer"` / `--auth bearer`                    |
| token | `--auth-token-stdin` | `PULSE_CLI_TOKEN` | `tokenEnv` (variable name) / `--auth-token-env <VAR>` |

```sh
# Microsoft Entra ID: a token for the API the engine's gateway expects
export PULSE_CLI_TOKEN=$(az account get-access-token --resource api://<engine-api-app-id> --query accessToken -o tsv)
pulse-cli process-instance list
# Google Cloud
export PULSE_CLI_TOKEN=$(gcloud auth print-access-token)
# CI job: the profile stores only the variable name
pulse-cli config set ci --url https://camunda.example.com/engine-rest --auth bearer --auth-token-env CI_ENGINE_TOKEN
```

- `PULSE_CLI_TOKEN` or `--auth-token-stdin` select `bearer` when no type is set. An explicit `basic` type
  wins: add `--auth bearer` or `PULSE_CLI_AUTH=bearer`.
- A JWT whose `exp` has passed fails before any request with `TOKEN_EXPIRED` (exit 4). Fetch a new
  token, or use a [token command](#token-commands). Opaque tokens are sent as they are.
- `pulse-cli auth status` shows the token's source and, for a JWT, its claims and expiry.

## Token commands

`PULSE_CLI_TOKEN_COMMAND` is a command line that prints a bearer token on the first line of its
stdout. pulse-cli runs it when it needs a token, which suits short-lived tokens such as a local
Keycloak dev realm. A repository sets it for agents in the `env` of its `.claude/settings.json`,
people in their shell or in direnv's `.envrc`.

```sh
export PULSE_CLI_TOKEN_COMMAND="$PWD/scripts/dev-token.sh"
pulse-cli task list
```

- Token sources in order: `--auth-token-stdin`, `PULSE_CLI_TOKEN`, `PULSE_CLI_TOKEN_COMMAND`, then
  the profile's `tokenEnv` or `token`.
- It runs in the working directory with stdin closed and must print the token, not JSON (use
  e.g. `jq -r .access_token`). Use an absolute path or no path: a relative one runs the script of
  whatever directory pulse-cli runs in.
- pulse-cli passes the engine it needs a token for: `PULSE_CLI_TOKEN_URL` (the REST API root) and,
  with a profile, `PULSE_CLI_TOKEN_PROFILE`. A command for a single login ignores them.
- A JWT is cached per engine URL until shortly before it expires, also for later and parallel
  calls. After a 401 pulse-cli runs the command once more and retries.
- A failing command exits 4 with `LOGIN_FAILED` and the end of its stderr. `auth status` runs it
  and shows the claims.

Only the environment sets a token command, never a profile or a
[project file](configuration.md#project-file): a project file cannot make pulse-cli run code.

### Single sign-on

`pulse-cli` has no login of its own: for an engine behind a company login, a token command
prints the token. Each provider's own tool or its token endpoint does the login, so the same
setting works for people and agents.

```sh
# Keycloak: a confidential client with service accounts enabled (client credentials)
export PULSE_CLI_TOKEN_COMMAND='curl -fsS -d grant_type=client_credentials -d client_id=pulse-cli -d "client_secret=$KEYCLOAK_CLIENT_SECRET" https://login.example.com/realms/camunda/protocol/openid-connect/token | jq -r .access_token'
# Microsoft Entra ID: the person logged in with `az login`
export PULSE_CLI_TOKEN_COMMAND='az account get-access-token --resource api://<engine-api-app-id> --query accessToken -o tsv'
# Auth0: a machine-to-machine application, the API identifier as audience
export PULSE_CLI_TOKEN_COMMAND='curl -fsS -H "content-type: application/json" -d "{\"grant_type\":\"client_credentials\",\"client_id\":\"$AUTH0_CLIENT_ID\",\"client_secret\":\"$AUTH0_CLIENT_SECRET\",\"audience\":\"https://engine.example.com\"}" https://<tenant>.auth0.com/oauth/token | jq -r .access_token'
```

- The token must carry what the engine's gateway checks: issuer, audience (Keycloak: an Audience
  mapper) and scopes.
- Up to 0.24 pulse-cli had `auth login`, `auth logout` and `--auth oauth`; a profile with
  `type: "oauth"` now fails with `CONFIG` (exit 3) and points here. Remove the profile's `auth`
  object from the config file and set a token command.

### Several logins

When engines need different logins (a consultant with several customers, or a local and a remote
engine in one repository), one script picks the login by `PULSE_CLI_TOKEN_URL`. Compare the URL
up to the host and its trailing slash, so `https://camunda.acme.com.evil.example` matches nothing:

```sh
#!/bin/sh
# ~/bin/pulse-token
case "$PULSE_CLI_TOKEN_URL" in
  https://camunda.acme.com/*) az account get-access-token --resource api://acme-engine --query accessToken -o tsv ;;
  http://localhost:8080/*) curl -fsS -d grant_type=client_credentials -d client_id=pulse-cli -d "client_secret=$KEYCLOAK_CLIENT_SECRET" http://localhost:9090/realms/camunda/protocol/openid-connect/token | jq -r .access_token ;;
  *) echo "no login for $PULSE_CLI_TOKEN_URL" >&2; exit 1 ;;
esac
```

`export PULSE_CLI_TOKEN_COMMAND="$HOME/bin/pulse-token"` once in your shell profile; each project
file then only names its engine URLs, and every profile gets its own login and its own cached
token.

## Other headers

API keys and gateway specific headers go into headers: `-H` per call, `PULSE_CLI_HEADERS` in the
environment, or `--header` in a profile. They merge per name: profile, then `PULSE_CLI_HEADERS`,
then `-H`. An `Authorization` header together with Basic auth or a bearer token is a
configuration error. Secret headers are masked unless `--show-secrets`.

```sh
export PULSE_CLI_HEADERS='X-API-Key: k-7f3a...'
pulse-cli config set prod --header 'X-Tenant-Id: acme'
```
