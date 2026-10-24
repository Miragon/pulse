# Configuration

Every setting is resolved per value: **flag > environment variable > profile > default**.
`operate config show` prints the effective values and where each one comes from. Profiles live in
your config file and, for a repository, in its [project file](#project-file).

The short form for agents: `operate guide config`; every option: `operate config <command> --help`.

## Global options

These work on every API command, `api` and `ping`, after the command path
(`operate task list -o table`): target (`--url`, `--engine`, `--platform`, `--profile`,
`--config`), output
(`-o`, `--fields`, `--pretty`, `--out-file`, `--verbose`), guards (`--dry-run`, `--yes`,
`--read-only`), requests (`--timeout`, `-H`) and [authentication](authentication.md). The list with
meanings and variables: `operate ping --help`.

## Environment variables

| Variable                | Meaning                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| `OPERATE_URL`           | REST API root                                                                              |
| `OPERATE_ENGINE`        | Named process engine                                                                       |
| `OPERATE_PLATFORM`      | Engine product: `operaton`, `cibseven` or `camunda7` (default), see [Engines](#engines)    |
| `OPERATE_PROFILE`       | Profile to use instead of the default profile                                              |
| `OPERATE_CONFIG`        | Config file location; the file must exist, and no project file is used                     |
| `OPERATE_OUTPUT`        | `json` or `table`                                                                          |
| `OPERATE_TIMEOUT`       | Request timeout in milliseconds                                                            |
| `OPERATE_AUTH`          | Authentication type: `none`, `basic`, `oauth` or `bearer`                                  |
| `OPERATE_USERNAME`      | Username for Basic auth                                                                    |
| `OPERATE_PASSWORD`      | Password for Basic auth                                                                    |
| `OPERATE_TOKEN`         | Bearer token obtained elsewhere, see [Bearer tokens](authentication.md#bearer-tokens)      |
| `OPERATE_TOKEN_COMMAND` | Command that prints a bearer token, see [Token commands](authentication.md#token-commands) |
| `OPERATE_OAUTH_*`       | OAuth settings, see [OAuth](authentication.md#oauth)                                       |
| `OPERATE_HEADERS`       | Extra headers `Name: value`, one per line, e.g. an API key                                 |
| `OPERATE_READ_ONLY`     | `1`/`true`/`yes`/`on` or `0`/`false`/`no`/`off`; anything else is an error                 |

## Config file

Lookup order: `--config <path>`, `OPERATE_CONFIG`, `$XDG_CONFIG_HOME/operate/config.json`,
`~/.config/operate/config.json` (Windows: `%APPDATA%\operate\config.json`). `operate config path`
prints the location. A file named with `--config` or `OPERATE_CONFIG` must exist and is the only
file read. operate validates every value and writes the file with mode `0600`; you can also edit
it by hand:

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
        "clientId": "operate-cli"
      },
      "readOnly": true
    }
  }
}
```

- Profile keys: `url`, `cockpitUrl` (for links only, never called), `engine`, `platform`, `auth` (see
  [Authentication](authentication.md)), `output`, `timeout`, `headers`, `readOnly`.
- Profile names use letters, digits, `.`, `_` and `-` and start with a letter or digit.
- URLs with credentials or a query string are rejected.

## Engines

`platform` says which product runs behind the URL: `operaton`, `cibseven` or `camunda7`. It
selects the engine adapter and with it the commands, help and `describe`. Without it operate uses
`camunda7`, which works for all three today. `engine` stays what it was: the name of a process
engine (`/engine/{name}`).

```sh
operate config set local --platform operaton
OPERATE_PLATFORM=cibseven operate ping
operate ping --platform camunda7
```

An unknown value is an error that lists the known engines. Versions of operate before `platform`
existed reject a config file that contains it.

## Profiles

```sh
operate config set local --url http://localhost:8080/engine-rest --default
operate config set prod --url https://camunda.example.com/engine-rest --read-only
operate config set prod --cockpit-url https://camunda.example.com/operaton/app/cockpit/default/
operate config list
operate config show --profile prod
operate config use prod
operate ping --profile local
operate config unset prod readOnly
operate config delete prod
```

- `config set` creates or updates a profile; only the given values change. The first profile
  becomes the default, `config use` picks another, `--profile` or `OPERATE_PROFILE` pick one per
  call.
- Changing or removing a profile's OAuth settings removes the cached login of the old ones, unless
  another profile shares it, see [shared logins](authentication.md#shared-logins).
- `config show` accepts the global flags, so you can see what a combination resolves to.

## Project file

A repository can ship its profiles in `.operate.json`, in the format of the config file, so
neither developers nor agents need a setup step. operate looks it up from the working directory
up to the repository root; the nearest file wins. `--config` or `OPERATE_CONFIG` turn the lookup
off.

```sh
operate config set orders --project --url http://localhost:8112/engine-rest/orders --default
operate config list
operate config path --project
```

- Its profiles join yours. On a name clash your own profile wins as a whole. The project's
  `defaultProfile` wins inside the repository, so a bare `operate status` reaches its engine.
- A project file names engines, never credentials: passwords, secrets, tokens, their `*Env`
  variables and secret headers are refused. Credentials come from the environment
  (`OPERATE_TOKEN`, [`OPERATE_TOKEN_COMMAND`](authentication.md#token-commands),
  `OPERATE_PASSWORD`, `OPERATE_OAUTH_CLIENT_SECRET`), an OAuth login
  ([shared logins](authentication.md#shared-logins)) or a profile of the same name in your file.
- `config set|unset|use|delete --project` write the project file (mode `0644`).
  `config list` shows each profile's `scope` (`user` or `project`).
- Treat a project file like code: it decides where your credentials from the environment and its
  profiles' OAuth login are sent.
