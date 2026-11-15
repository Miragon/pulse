# Configuration

## Engines

Pulse reads your engines as profiles of the [Pulse CLI](../cli/configuration.md), so the extension
and the CLI see the same engines. They live in two files:

| File                                               | Holds                       | Read by                                                  |
| -------------------------------------------------- | --------------------------- | -------------------------------------------------------- |
| `.pulse.json` in your workspace, the project file  | the engines of a repository | your team, through the repository                        |
| `~/.config/pulse-cli/config.json`, your CLI config | your own engines            | every VS Code window, Pulse for Orca and the CLI for you |

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

Pulse reads `url`, `flavor` (`camunda7`, `cibseven` or `operaton`, `camunda7` when absent, or
[`camunda8`](./camunda8.md)), `engine` (the default engine only), `auth.type` (`none`, `basic`,
`oauth` on the Camunda 7 flavors, `clientCredentials` on `camunda8`; without a type a `username`
means `basic`), `cockpitUrl` and `readOnly` (no writes from Pulse either), by the rules of the CLI
and the MCP server: one profile format, `@miragon/pulse-profile`. URLs lose trailing slashes, and a
profile with a value the format refuses never becomes an engine. Pulse reads profile by profile: a
profile that sets `headers`, uses a key the format does not know, the auth type `bearer` or
`passthrough`, lacks its `url` (Pulse reads no `PULSE_CLI_*` variable but `PULSE_CLI_CONFIG`) or,
in a project file, names a credential (a password, a token or the variable that holds one) shows
up as a problem in the Engines view instead of connecting, and the problem says what to change; the
other profiles of the file still list engines. A profile with `oauth` lists its engine, but Pulse
does not connect to it and says to set `auth.type` to `none`, or to `basic` without the OAuth keys,
or to keep the profile for the CLI. Pulse does not apply `environment`, `timeout` and `output`, yet
a value of theirs the format refuses is a problem too.

Your CLI config sits where the CLI looks for it (`$XDG_CONFIG_HOME/pulse-cli/` for an absolute
`XDG_CONFIG_HOME`, `%APPDATA%\pulse-cli\` on Windows); a remote window (SSH, WSL, Dev Container)
reads the remote machine's. Pulse lists the profiles of every `.pulse.json` first, the first file
winning a name, then those of your CLI config, whose profile wins a name clash as a whole, as in the
CLI, even one Pulse can't use. With `PULSE_CLI_CONFIG` set, Pulse reads only the file it names by
its full path, like the CLI, and the Engines view says so. Without any profile it lists one engine
on `localhost:8080`. A file Pulse can't read, a missing file `PULSE_CLI_CONFIG` names, or a folder
that holds the project file only under its former name, `.pulse-cli.json`, shows as a problem and
lists no engine, not even that one. A file with a `camunda8` profile needs a CLI of your
extension's version or newer: the CLI up to 0.27 refuses the whole file, a newer one only that
profile, when you pick it.

_Pulse: Configure Engines_ (the gear of the Engines view) opens the file for your engines: with a
folder open the one you pick, this project's or your CLI config; without one your CLI config,
created readable by you only (mode `0600`) with a profile to fill in. _Pulse: Set Credentials…_
asks for a login (a username and password, or a client's ID and secret) and keeps it in VS Code's
secret storage, per profile and file; Pulse reads none of the credentials your CLI config holds.

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

| Engine                                   | `cockpitUrl`                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------------ |
| Camunda 7, Operaton, CIB seven (Cockpit) | ends in `/app/cockpit/<engine name>/`                                          |
| CIB seven webclient                      | ends in `/webapp/`                                                             |
| Camunda 8 (_Open in Operate_)            | ends in `/operate`, on SaaS `https://<region>.operate.camunda.io/<cluster id>` |

## Proxy and certificates

Pulse calls the engine's REST API from the extension host with VS Code's network settings
(`http.proxy`, `http.systemCertificates`, `http.proxyStrictSSL`), through `@miragon/pulse-http`,
the transport the CLI and the MCP server send through too. It never follows a redirect, reads at
most 64 MiB of an answer, gives up on a call after 60 s and shows a password, client secret or
token the engine echoes in an error as `***` (four characters or more). A certificate VS Code does
not trust and a host name that does not resolve each say so, with what to check.
