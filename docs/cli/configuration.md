# Configuration

Every setting is resolved per value: **flag > environment variable > profile > default**.
`pulse-cli config show` prints the effective values and where each one comes from. Profiles live in
your config file and, for a repository, in its [project file](#project-file).

Every option: `pulse-cli config <command> --help`.

## Global options

These work on every API command, `api` and `ping`, after the command path
(`pulse-cli task list -o table`): target (`--url`, `--engine`, `--flavor`, `--profile`,
`--config`), output
(`-o/--output`, `--fields`, `--pretty`, `--out-file`, `--verbose`), guards (`--dry-run`, `--yes`,
`--read-only`), requests (`--timeout`, `-H`) and [authentication](authentication.md). The list with
meanings and variables: `pulse-cli ping --help`.

## Environment variables

| Variable                  | Meaning                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------ |
| `PULSE_CLI_URL`           | REST API root                                                                              |
| `PULSE_CLI_ENGINE`        | Named process engine                                                                       |
| `PULSE_CLI_FLAVOR`        | Engine product: `operaton`, `cibseven` or `camunda7` (default), see [Engines](#engines)    |
| `PULSE_CLI_PROFILE`       | Profile to use instead of the default profile                                              |
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
`pulse-cli config path` prints the location. A file named with `--config` or `PULSE_CLI_CONFIG` must
exist and is the only file read.
pulse-cli validates every value and writes the file with mode `0600`; you can also edit it by hand:

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

- Profile keys: `url`, `cockpitUrl` (for links only, never called), `engine`, `flavor`, `auth`
  (see [Authentication](authentication.md)), `output`, `timeout`, `headers`, `readOnly`.
- Profile names use letters, digits, `.`, `_` and `-` and start with a letter or digit.
- URLs with credentials or a query string are rejected.

## Engines

`flavor` says which product runs behind the URL: `operaton`, `cibseven` or `camunda7`. It
selects the engine adapter and with it the commands, help and `describe`. Without it pulse-cli uses
`camunda7`, which works for all three today. `engine` stays what it was: the name of a process
engine (`/engine/{name}`).

```sh
pulse-cli config set local --flavor operaton
PULSE_CLI_FLAVOR=cibseven pulse-cli ping
pulse-cli ping --flavor camunda7
```

An unknown value is an error that lists the known engines. Before the CLI moved to Pulse the key
was called `platform`; that name is an unknown key now, and `--platform` an unknown option.

## Profiles

```sh
pulse-cli config set local --url http://localhost:8080/engine-rest --default
pulse-cli config set prod --url https://camunda.example.com/engine-rest --read-only
pulse-cli config set prod --cockpit-url https://camunda.example.com/operaton/app/cockpit/default/
pulse-cli config list
pulse-cli config show --profile prod
pulse-cli config use prod
pulse-cli ping --profile local
pulse-cli config unset prod readOnly
pulse-cli config delete prod
```

- `config set` creates or updates a profile; only the given values change. The first profile
  becomes the default, `config use` picks another, `--profile` or `PULSE_CLI_PROFILE` pick one per
  call.
- Changing or removing a profile's OAuth settings removes the cached login of the old ones, unless
  another profile shares it, see [shared logins](authentication.md#shared-logins).
- `config show` accepts the global flags, so you can see what a combination resolves to.

## Project file

A repository can ship its profiles in `.pulse-cli.json`, in the format of the config file, so
neither developers nor agents need a setup step. pulse-cli looks it up from the working directory
up to the repository root; the nearest file wins. `--config` or `PULSE_CLI_CONFIG` turn the lookup
off.

```sh
pulse-cli config set orders --project --url http://localhost:8112/engine-rest/orders --default
pulse-cli config list
pulse-cli config path --project
```

- Its profiles join yours. On a name clash your own profile wins as a whole. The project's
  `defaultProfile` wins inside the repository, so a bare `pulse-cli status` reaches its engine.
- A project file names engines, never credentials: passwords, secrets, tokens, their `*Env`
  variables and secret headers are refused. Credentials come from the environment
  (`PULSE_CLI_TOKEN`, [`PULSE_CLI_TOKEN_COMMAND`](authentication.md#token-commands),
  `PULSE_CLI_PASSWORD`, `PULSE_CLI_OAUTH_CLIENT_SECRET`), an OAuth login
  ([shared logins](authentication.md#shared-logins)) or a profile of the same name in your file.
- `config set|unset|use|delete --project` write the project file (mode `0644`).
  `config list` shows each profile's `scope` (`user` or `project`).
- Treat a project file like code: it decides where your credentials from the environment and its
  profiles' OAuth login are sent.
