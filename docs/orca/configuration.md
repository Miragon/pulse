# Configuration

## Engines

Pulse for Orca reads your engines as profiles in `.pulse.json`, the project file the
[Pulse CLI](../cli/configuration.md) reads too, with the same rules as
[Pulse for VS Code](../vscode/configuration.md#engines): one profile format,
`@miragon/pulse-profile`; `url`, `flavor` (`camunda8` for a [Camunda 8](../vscode/camunda8.md)
cluster, read-only), `engine`, `auth.type`, `cockpitUrl` and `readOnly`, and a profile that names a
credential, sets `headers` or that the format refuses shows as a problem in the panel while the
other profiles still list engines. A note on the file itself (a `defaultProfile` that names no
profile, a key the format does not know) shows as a warning.

The plugin takes the project file its setting names, else the `.pulse.json` at the root of the
focused workspace. It reads your CLI config too, the file of your own engines that the CLI and
Pulse for VS Code read, found as the CLI finds it (`~/.config/pulse-cli/config.json`, the rules in
[Pulse for VS Code](../vscode/configuration.md#engines)): its profiles follow those of the project
file, and one of the same name takes that profile's place as a whole. With `PULSE_CLI_CONFIG` set
in Orca's environment, Pulse reads only the file it names, like the CLI. Without any profile it
lists one engine on `localhost:8080`. It reads both files again when they change. A file that is
there but Pulse can't read (a folder of that name, a file without read access), or a missing file
`PULSE_CLI_CONFIG` names, shows as a problem and lists no engine, not even the one on
`localhost:8080`. The gear in the panel opens the project file, created from a template when there
is none; with `PULSE_CLI_CONFIG` set, the panel names that file as the source and the gear opens it
instead. The panel shows where your CLI config is, with no copy action, since Orca gives its panel
no clipboard; Orca opens files of a workspace only, so Pulse opens it only where a workspace holds
it, and never creates it. A workspace that holds the project file only under its former name,
`.pulse-cli.json`, shows one problem asking you to rename it and lists none of its engines, not
even the one on `localhost:8080`; the gear opens that file and creates no second one.

Credentials go in with the login form of the panel, which opens when an engine needs one: a
username and password, or a Camunda 8 client's ID and secret. They live in Orca's secret storage,
in the OS key store, bound to the file's path and the engine's address, and a client's also to its
token endpoint; Pulse reads none of the credentials your CLI config holds for the CLI.

## Settings

The plugin's settings are in Orca's settings, under Pulse:

| Setting                                              | Values                                                                      | Default                    |
| ---------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------- |
| Project file                                         | the path of a `.pulse.json`                                                 | the focused workspace's    |
| Writes                                               | on engines on this machine only, also on remote engines with a login, never | this machine only          |
| Environments                                         | JSON, per profile: `local`, `test`, `production`                            | loopback hosts are `local` |
| Live updates (local, test, production, unclassified) | default, on, off                                                            | local and test on          |

A `.vscode/settings.json` next to the project file adds its `pulse.environments`, as it does for
the extension. Production and unclassified engines ask you to type their host before a write;
the [write rules](../vscode/configuration.md) are the extension's.
