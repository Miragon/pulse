# Authentication

`operate` supports [Basic auth](#basic-auth), [OAuth 2.0](#oauth) (authorization code flow with
PKCE, for Keycloak, Microsoft Entra ID, Auth0 or another OpenID Connect provider),
[bearer tokens](#bearer-tokens) you get elsewhere, [token commands](#token-commands) that fetch
one, and [headers](#other-headers) for other schemes.

- The type comes from `--auth none|basic|oauth|bearer`, `OPERATE_AUTH` or the profile. Without one,
  a username selects `basic` and a token selects `bearer`. OAuth is never implied.
- Each value resolves on its own: flag > environment variable > profile. With `--url` or
  `OPERATE_URL` set, the profile's credentials go to that URL: check `operate config show`.
- Secrets are never plain flags and are masked (`***`) in output unless `--show-secrets`.

The short form for agents: `operate guide auth`; every option: `operate auth <command> --help`.

## Basic auth

For Camunda 7 Run with `camunda.bpm.run.auth.enabled=true`, CIB seven Run with
`camunda.bpm.run.auth.authentication=basic`, Operaton Run with `operaton.bpm.run.auth.enabled=true`,
or a filter or proxy in front of `/engine-rest`.

| Value    | Flag                    | Environment        | Profile (`auth` object)                     |
| -------- | ----------------------- | ------------------ | ------------------------------------------- |
| type     | `--auth <type>`         | `OPERATE_AUTH`     | `type`: `none` or `basic`                   |
| username | `--auth-user <name>`    | `OPERATE_USERNAME` | `username`                                  |
| password | `--auth-password-stdin` | `OPERATE_PASSWORD` | `passwordEnv` (variable name) or `password` |

```sh
# per call: the password comes from stdin
printf '%s\n' "$CAMUNDA_PASSWORD" | operate ping --auth basic --auth-user demo --auth-password-stdin
# per shell: read it without echo and without shell history
read -rs OPERATE_PASSWORD && export OPERATE_PASSWORD
operate task list --assignee demo
# per profile: only the name of the variable is stored
operate config set staging --url https://staging.example.com/engine-rest --auth basic --auth-user demo --auth-password-env CAMUNDA_PASSWORD
```

- In a profile, store the variable name with `--auth-password-env`; a literal `password` is plain
  text in the `0600` config file (`config set` warns). Pass the name, never the password.
- A missing username or password exits 3. A 401 (exit 4) names the rejected user or the reason
  no credentials were sent.
- Use `https://` beyond `localhost`: Basic auth sends the password readable.

## OAuth

A person logs in once with `operate auth login` in a terminal; other commands use and refresh the
cached tokens. Without a usable login they fail with `LOGIN_REQUIRED` (exit 4) and name the command
to run, so agents never wait for a browser. Client credentials and the device flow are not
supported.

```sh
operate config set sso --url https://camunda.example.com/engine-rest --auth oauth --oauth-issuer https://login.example.com/realms/camunda --oauth-client-id operate-cli --oauth-audience engine-rest
```

```text
$ operate auth login --profile sso
Open this URL in a browser to log in:
  https://login.example.com/realms/camunda/protocol/openid-connect/auth?response_type=code&client_id=operate-cli&redirect_uri=...
Logged in as alice (profile "sso").

$ operate process-instance list --profile sso
```

| Value         | Environment                                                            | `config set` option                                        |
| ------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------- |
| type          | `OPERATE_AUTH=oauth`                                                   | `--auth oauth`                                             |
| issuer        | `OPERATE_OAUTH_ISSUER`                                                 | `--oauth-issuer <url>` (endpoints from discovery)          |
| endpoints     | `OPERATE_OAUTH_AUTHORIZATION_ENDPOINT`, `OPERATE_OAUTH_TOKEN_ENDPOINT` | `--oauth-authorization-endpoint`, `--oauth-token-endpoint` |
| client id     | `OPERATE_OAUTH_CLIENT_ID`                                              | `--oauth-client-id <id>`                                   |
| client secret | `OPERATE_OAUTH_CLIENT_SECRET`                                          | `--oauth-client-secret-env <VAR>` (confidential client)    |
| scopes        | `OPERATE_OAUTH_SCOPES`                                                 | `--oauth-scopes <scopes>`, default `openid offline_access` |
| audience      | `OPERATE_OAUTH_AUDIENCE`                                               | `--oauth-audience <audience>` (Auth0 style parameter)      |
| redirect port | `OPERATE_OAUTH_REDIRECT_PORT`                                          | `--oauth-redirect-port <port>`, default 0 (any free port)  |

- `auth login [--no-browser] [--login-timeout <ms>]` prints the URL, opens the browser and waits
  on `127.0.0.1`. Over SSH: set `--oauth-redirect-port 8765`, run
  `ssh -L 8765:127.0.0.1:8765 host` and open the URL locally.
- `auth status` shows user, scopes and expiry without network access; exit 4 when a new login is
  needed. `auth logout` revokes the refresh token (if the provider supports it) and removes the
  login.
- Tokens are cached in `~/.config/operate/tokens` (mode `0600`). Changing issuer, client, audience
  or scopes needs a new login.
- `UNAUTHORIZED` or `FORBIDDEN` after a successful login are gateway (issuer, audience, clock) or
  permission problems, not login problems. The gateway must expect exactly the issuer URL operate
  logs in with (`localhost` and `127.0.0.1` differ).
- URLs must use `https://` (`http://` only for loopback).

### Shared logins

One `operate auth login` serves every OAuth profile of the same origin that stores the same issuer
(or token endpoint), client id, audience and scopes. A repository with an engine per service needs
one login, not one per profile.

- The origin is your config file, a file named by `--config` or `OPERATE_CONFIG`, or the
  repository of a [project file](configuration.md#project-file), including all its worktrees.
  Separate clones and submodules are origins of their own.
- `auth login`, `status` and `logout` name the profiles a login serves; `logout` ends it for all.
- A login never serves another origin. Within its origin it goes wherever the profiles' URLs
  point: treat a project file like code.
- Run `auth logout` before you delete a repository whose login is still valid.

Client registration:

- **Keycloak**: a public client, Standard flow on, redirect URI `http://127.0.0.1/callback`, PKCE
  method `S256`. Users need `offline_access`. Keycloak ignores `audience`: add an Audience mapper.
- **Microsoft Entra ID**: a "Mobile and desktop applications" redirect URI
  `http://127.0.0.1/callback`, issuer `https://login.microsoftonline.com/<tenant-id>/v2.0`, and the
  API as a scope, e.g. `--oauth-scopes 'openid offline_access api://<app-id>/.default'`.
- **Auth0**: issuer `https://<tenant>.auth0.com/` with the trailing slash, the API identifier as
  `--oauth-audience`, redirect URI `http://127.0.0.1:8765/callback` with
  `--oauth-redirect-port 8765`.

## Bearer tokens

When you already get an access token elsewhere (SSO tooling, a CI secret, `az`, `gcloud`),
`--auth bearer` sends it as `Authorization: Bearer <token>`. No login, no refresh, no cache.

| Value | Flag                 | Environment     | Profile (`auth` object) / `config set` option         |
| ----- | -------------------- | --------------- | ----------------------------------------------------- |
| type  | `--auth bearer`      | `OPERATE_AUTH`  | `type: "bearer"` / `--auth bearer`                    |
| token | `--auth-token-stdin` | `OPERATE_TOKEN` | `tokenEnv` (variable name) / `--auth-token-env <VAR>` |

```sh
# Microsoft Entra ID: a token for the API the engine's gateway expects
export OPERATE_TOKEN=$(az account get-access-token --resource api://<engine-api-app-id> --query accessToken -o tsv)
operate process-instance list
# Google Cloud
export OPERATE_TOKEN=$(gcloud auth print-access-token)
# CI job: the profile stores only the variable name
operate config set ci --url https://camunda.example.com/engine-rest --auth bearer --auth-token-env CI_ENGINE_TOKEN
```

- `OPERATE_TOKEN` or `--auth-token-stdin` select `bearer` when no type is set. An explicit `basic`
  or `oauth` type wins: add `--auth bearer` or `OPERATE_AUTH=bearer`.
- A JWT whose `exp` has passed fails before any request with `TOKEN_EXPIRED` (exit 4). Fetch a new
  token, or use a [token command](#token-commands). Opaque tokens are sent as they are.
- `operate auth status` shows the token's source and, for a JWT, its claims and expiry.

## Token commands

`OPERATE_TOKEN_COMMAND` is a command line that prints a bearer token on the first line of its
stdout. operate runs it when it needs a token, which suits short-lived tokens such as a local
Keycloak dev realm. A repository sets it for agents in the `env` of its `.claude/settings.json`,
people in their shell or in direnv's `.envrc`.

```sh
export OPERATE_TOKEN_COMMAND="$PWD/scripts/dev-token.sh"
operate task list
```

- Token sources in order: `--auth-token-stdin`, `OPERATE_TOKEN`, `OPERATE_TOKEN_COMMAND`, then
  the profile's `tokenEnv` or `token`.
- It runs in the working directory with stdin closed and must print the token, not JSON (use
  e.g. `jq -r .access_token`). Use an absolute path or no path: a relative one runs the script of
  whatever directory operate runs in.
- A JWT is cached until shortly before it expires, also for later and parallel calls. After a 401
  operate runs the command once more and retries.
- A failing command exits 4 with `LOGIN_FAILED` and the end of its stderr. `auth status` runs it
  and shows the claims, `auth logout` removes the cached token.

Only the environment sets a token command, never a profile or a
[project file](configuration.md#project-file): a project file cannot make operate run code.

## Other headers

API keys and gateway specific headers go into headers: `-H` per call, `OPERATE_HEADERS` in the
environment, or `--header` in a profile. They merge per name: profile, then `OPERATE_HEADERS`,
then `-H`. An `Authorization` header together with Basic auth, OAuth or a bearer token is a
configuration error. Secret headers are masked unless `--show-secrets`.

```sh
export OPERATE_HEADERS='X-API-Key: k-7f3a...'
operate config set prod --header 'X-Tenant-Id: acme'
```
