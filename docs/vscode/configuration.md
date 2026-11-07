# Configuration

## Engines

Pulse reads your engines as profiles of the [Pulse CLI](../cli/configuration.md), so the
extension and the CLI see the same engines. They live in two files:

| File                                                  | Holds                       | Read by                                  |
| ----------------------------------------------------- | --------------------------- | ---------------------------------------- |
| `.pulse-cli.json` in your workspace, the project file | the engines of a repository | your team, through the repository        |
| `~/.config/pulse-cli/config.json`, your CLI config    | your own engines            | every VS Code window and the CLI for you |

Your CLI config sits where the CLI looks: under `$XDG_CONFIG_HOME/pulse-cli/` when set, on
Windows under `%APPDATA%\pulse-cli\`; a remote window (SSH, WSL, Dev Container) reads the remote
machine's. The profiles of both files join, and on a name clash your own profile wins as a whole,
as in the CLI. With `PULSE_CLI_CONFIG` set, Pulse reads only the file it names, like the CLI, and
the Engines view says so. Without any profile it shows `local` (`http://localhost:8080/engine-rest`).

_Pulse: Configure Engines_ (the gear of the Engines view) opens the file for your engines:
without a folder your CLI config, created readable by you only (mode `0600`) with a profile to
fill in; with a folder open, the file you pick. A profile looks like this:

```json
{
  "profiles": {
    "dev": {
      "url": "https://dev.example.com/engine-rest",
      "flavor": "operaton",
      "auth": { "type": "basic" },
      "cockpitUrl": "https://dev.example.com/operaton/app/cockpit/default/"
    }
  }
}
```

Pulse reads `url`, `flavor` (`camunda7`, `cibseven` or `operaton`; `camunda7` when absent),
`engine` (the default engine only), `auth.type` (`none`, `basic`; without a type a `username`
means `basic`), `cockpitUrl` and `readOnly` (no writes from Pulse either), with the CLI's rules:
URLs lose trailing slashes, and a value the CLI refuses never becomes a default. Such a profile,
and one Pulse cannot serve yet, shows up as a problem in the Engines view. Pulse reads no
`PULSE_CLI_*` variable but `PULSE_CLI_CONFIG`, so a profile needs its `url`, and it sends no
profile `headers`. Pulse reads profile by profile and skips the keys it does not use (`headers`,
`timeout`, `output`, credentials), so a file the CLI refuses as a whole, say one with a committed
password, can still list engines here: check it with `pulse-cli config list`.

Set credentials with _Pulse: Set Credentials…_. They live in VS Code's secret storage, per profile
and file; Pulse reads none of the credentials your CLI config may hold for the CLI.

## Settings

| Setting              | Values                                                                       | Default                    |
| -------------------- | ---------------------------------------------------------------------------- | -------------------------- |
| `pulse.environments` | per profile: `local`, `test`, `production`                                   | loopback hosts are `local` |
| `pulse.writes`       | `localOnly`, `enabled`, `disabled`                                           | `localOnly`                |
| `pulse.liveUpdates`  | per environment (`local`, `test`, `production`, `unclassified`): `on`, `off` | local and test on          |

Production engines show in red, and only by configuration:
`"pulse.environments": { "prod-eu": "production" }`. `pulse.writes` and `pulse.liveUpdates`
count only in your user settings: a workspace or a dev container cannot turn them on. With
`enabled`, production and unclassified engines ask you to type their host before a write.

Open views read the engine again while they are visible and VS Code has focus: local engines
every 5–30 s, test engines every 15–60 s, production and unclassified every 30–120 s once you
turn them on. They pause after 15 minutes without activity.

## Open in Cockpit

With `cockpitUrl`, the definition and instance panels get an _Open in Cockpit_ button. Pulse
never guesses this URL. It must be an `http` or `https` URL without credentials:

| Engine                                   | `cockpitUrl`                          |
| ---------------------------------------- | ------------------------------------- |
| Camunda 7, Operaton, CIB seven (Cockpit) | ends in `/app/cockpit/<engine name>/` |
| CIB seven webclient                      | ends in `/webapp/`                    |

## Proxy and certificates

Pulse calls the engine's REST API from the extension host with VS Code's network settings
(`http.proxy`, `http.systemCertificates`, `http.proxyStrictSSL`). It never follows a redirect,
reads at most 64 MiB of an answer and gives up on a call after 60 s.
