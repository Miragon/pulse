# Configuration

Each setting resolves per value: **flag > environment variable > profile > default**, but a URL
(`--url`, `PULSE_CLI_URL`) without `--profile` selects [no profile](#profiles). `pulse config show`
prints the effective values and where each comes from. Profiles live in your config file and, for
a repository, in its [project file](#project-file). Every option: `pulse config <command> --help`.

## Global options

These work on every API command, `api` and `ping`, after the command path
(`pulse task list -o table`): target (`--url`, `--engine`, `--flavor`, `--profile`, `--config`),
output (`-o/--output`, `--fields`, `--pretty`, `--out-file`, `--verbose`), guards (`--dry-run`,
`--yes`, `--read-only`), requests (`--timeout`, `-H`) and [authentication](authentication.md). The
list with meanings and variables: `pulse ping --help`.

## Environment variables

| Variable                  | Meaning                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------ |
| `PULSE_CLI_URL`           | REST API root; without `--profile` it selects [no profile](#profiles)                      |
| `PULSE_CLI_ENGINE`        | Named process engine                                                                       |
| `PULSE_CLI_FLAVOR`        | Engine product: `operaton`, `cibseven` or `camunda7` (default), see [Engines](#engines)    |
| `PULSE_CLI_PROFILE`       | Profile to use instead of the default profile; a URL without `--profile` leaves it out     |
| `PULSE_CLI_CONFIG`        | Config file location; the file must exist, and no project file is used                     |
| `PULSE_CLI_OUTPUT`        | `json` or `table`                                                                          |
| `PULSE_CLI_TIMEOUT`       | Request timeout in milliseconds                                                            |
| `PULSE_CLI_AUTH`          | Authentication type: `none`, `basic`, `oauth` or `bearer`                                  |
| `PULSE_CLI_USERNAME`      | Username for Basic auth                                                                    |
| `PULSE_CLI_PASSWORD`      | Password for Basic auth                                                                    |
| `PULSE_CLI_TOKEN`         | Bearer token obtained elsewhere, see [Bearer tokens](authentication.md#bearer-tokens)      |
| `PULSE_CLI_TOKEN_COMMAND` | Command that prints a bearer token, see [Token commands](authentication.md#token-commands) |
| `PULSE_CLI_OAUTH_*`       | OAuth settings, see [OAuth](authentication.md#oauth)                                       |
| `PULSE_CLI_HEADERS`       | Extra headers `Name: value`, one per line, e.g. an API key                                 |
| `PULSE_CLI_READ_ONLY`     | `1`/`true`/`yes`/`on` or `0`/`false`/`no`/`off`; anything else is an error                 |

## Config file

Lookup order: `--config <path>`, `PULSE_CLI_CONFIG`, `$XDG_CONFIG_HOME/pulse-cli/config.json`,
`~/.config/pulse-cli/config.json` (Windows: `%APPDATA%\pulse-cli\config.json`).
`pulse config path` prints the location. A file named with `--config` or `PULSE_CLI_CONFIG` must
exist and is the only file read.
The CLI validates every value and writes the file with mode `0600`; you can also edit it by hand:

```json
{
  "defaultProfile": "local",
  "profiles": {
    "local": {
      "url": "http://localhost:8080/engine-rest",
      "engine": "default",
      "auth": { "type": "none" },
      "output": "table",
      "timeout": 10000
    },
    "staging": {
      "url": "https://staging.example.com/engine-rest",
      "auth": { "type": "basic", "username": "demo", "passwordEnv": "CAMUNDA_PASSWORD" }
    },
    "prod": {
      "url": "https://camunda.example.com/engine-rest",
      "cockpitUrl": "https://camunda.example.com/operaton/app/cockpit/default/",
      "auth": {
        "type": "oauth",
        "issuer": "https://login.example.com/realms/camunda",
        "clientId": "pulse-cli"
      },
      "readOnly": true
    }
  }
}
```

- Profile keys: `url`, `cockpitUrl` (for links only, never called), `engine`, `flavor`,
  `environment` (kept, not read), `auth` ([Authentication](authentication.md)), `output`,
  `timeout`, `headers`, `readOnly`: the format of `@miragon/pulse-profile`, which the MCP server
  reads too (its `auth.type` `passthrough` only the server serves).
- Profile names use letters, digits, `.`, `_` and `-` and start with a letter or digit.
- A profile with a value the format refuses (a URL with credentials or a query, an unknown key, a
  key twice) fails when a command uses it, naming why, as `config list` does; the others work.
  Only text that gives no profiles (invalid JSON, a wrong outer shape) fails the whole file.

## Engines

`flavor` says which product runs behind the URL: `operaton`, `cibseven` or `camunda7`. It
selects the engine adapter and with it the commands, help and `describe`. Without it the CLI uses
`camunda7`, which works for all three today. `engine` is the name of a process engine
(`/engine/{name}`). An unknown flavor is an error that lists the known ones.

```sh
pulse config set local --url http://localhost:8080/engine-rest --flavor operaton
PULSE_CLI_FLAVOR=cibseven pulse ping
pulse ping --flavor camunda7
```

## Profiles

```sh
pulse config set local --url http://localhost:8080/engine-rest --default
pulse config set prod --url https://camunda.example.com/engine-rest --read-only
pulse config set prod --cockpit-url https://camunda.example.com/operaton/app/cockpit/default/
pulse config list
pulse config show --profile prod
pulse config use prod
pulse ping --profile local
pulse config unset prod readOnly
pulse config delete prod
```

- `config set` creates or updates a profile; only the given values change, and a new profile
  needs `--url`. The first profile becomes the default, `config use` picks another, `--profile`
  or `PULSE_CLI_PROFILE` pick one per call. `config unset` removes any key a profile holds
  (`auth.<key>` one of its auth object), so it repairs a refused one. A name or a key twice you
  fix in an editor: the commands write the whole file and leave such a file as it is.
- Changing or removing a profile's OAuth settings removes the cached login of the old ones, unless
  another profile shares it, see [shared logins](authentication.md#shared-logins).
- A URL without `--profile` (`--url`, a non-empty `PULSE_CLI_URL`) leaves out `PULSE_CLI_PROFILE`
  and the `defaultProfile`: nothing of a profile applies (headers, auth, engine, flavor,
  `cockpitUrl`, timeout, output, `readOnly`), your other `PULSE_CLI_*` variables do. Beside
  `--profile p` either replaces only its URL. `config show` takes the flags and shows the result.

## Project file

A repository can ship its profiles in `.pulse.json`, in the format of the config file, so
neither developers nor agents need a setup step. The CLI looks it up from the working directory
up to the repository root; the nearest file wins. `--config` or `PULSE_CLI_CONFIG` turn the lookup
off.

```sh
pulse config set orders --project --url http://localhost:8112/engine-rest/orders --default
pulse config list
pulse config path --project
```

```json
{
  "$schema": "https://unpkg.com/@miragon/pulse-profile/schema/pulse.schema.json",
  "defaultProfile": "orders",
  "profiles": { "orders": { "url": "http://localhost:8112/engine-rest/orders" } }
}
```

- Its profiles join yours. On a name clash your own profile wins as a whole. The project's
  `defaultProfile`, without one its only profile, wins inside the repository, so a bare
  `pulse status` reaches its engine unless `PULSE_CLI_URL` is set. A `defaultProfile` that names
  none of its profiles, or an only profile without a valid name, leaves no default (a command
  needs `--profile`, `PULSE_CLI_PROFILE` or a URL), never yours.
- A project file names engines, never credentials: a profile with a password, secret, token,
  their `*Env` variable or a secret header is refused, so no command reads a variable a
  repository chose. Credentials come from the environment
  (`PULSE_CLI_TOKEN`, [`PULSE_CLI_TOKEN_COMMAND`](authentication.md#token-commands),
  `PULSE_CLI_PASSWORD`, `PULSE_CLI_OAUTH_CLIENT_SECRET`), an OAuth login
  ([shared logins](authentication.md#shared-logins)) or a profile of the same name in your file.
- `config set|unset|use|delete --project` write the project file (mode `0644`).
  `config list` shows each profile's `scope` (`user` or `project`).
- `$schema` lets your editor check the file against the JSON Schema of the profile format
  (`schema/pulse.schema.json` in `@miragon/pulse-profile`); the CLI keeps the key when it writes
  the file. The URL above serves the latest release; `@miragon/pulse-profile@<version>` pins
  yours. [Pulse for VS Code](../vscode/configuration.md) reads the same profiles.
- Treat a project file like code: it decides where your credentials from the environment and its
  profiles' OAuth login are sent.
