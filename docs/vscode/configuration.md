# Configuration

## Engines

Pulse reads your engines as profiles in `.pulse.json`, the project file the
[Pulse CLI](../cli/configuration.md) reads too, so the extension and the CLI see the same engines:

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

Pulse reads `url`, `flavor` (`camunda7`, `cibseven` or `operaton`; `camunda7` when absent), `engine`
(the default engine only), `auth.type` (`none`, `basic` or `oauth`; without a type a `username`
means `basic`), `cockpitUrl` and `readOnly` (no writes from Pulse either), by the rules of the CLI
and the MCP server: one profile format, `@miragon/pulse-profile`. URLs lose trailing slashes, and a
profile with a value the format refuses never becomes an engine. Pulse reads profile by profile: a
profile that names a credential (a password, a token or the variable that holds one), sets
`headers`, uses a key the format does not know, the auth type `bearer` or `passthrough`, or lacks
its `url` (Pulse reads no `PULSE_CLI_*` variable) shows up as a problem in the Engines view instead
of connecting, and the problem says what to change; the other profiles of the file still list
engines. A profile with `oauth` lists its engine, but Pulse does not connect to it and says to set
`auth.type` to `none`, or to `basic` without the OAuth keys, or to keep the profile for the CLI.
Pulse does not apply `environment`, `timeout` and `output`, yet a value of theirs the format refuses
is a problem too.

Set credentials with _Pulse: Set Credentials…_. They live in VS Code's secret storage.

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
(`http.proxy`, `http.systemCertificates`, `http.proxyStrictSSL`), through `@miragon/pulse-http`,
the transport the CLI and the MCP server send through too. It never follows a redirect, reads at
most 64 MiB of an answer, gives up on a call after 60 s and shows a password the engine echoes
in an error as `***` (a password of four characters or more). A certificate VS Code does not trust and a host name that does not resolve each say so,
with what to check.
