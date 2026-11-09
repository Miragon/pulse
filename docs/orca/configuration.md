# Configuration

## Engines

Pulse for Orca reads your engines as profiles in `.pulse.json`, the project file the
[Pulse CLI](../cli/configuration.md) reads too, with the same rules as
[Pulse for VS Code](../vscode/configuration.md#engines): one profile format,
`@miragon/pulse-profile`; `url`, `flavor`, `engine`, `auth.type`, `cockpitUrl` and `readOnly`,
and a profile that names a credential, sets `headers` or that the format refuses shows as a
problem in the panel while the other profiles still list engines.

The plugin takes the project file its setting names, else the `.pulse.json` at the root of the
focused workspace, else one engine on `localhost:8080`. It reads the file again when it changes.
The gear in the panel opens it, created from a template when there is none. A workspace that holds
the project file only under its former name, `.pulse-cli.json`, shows one problem asking you to
rename it and lists none of its engines, not even the one on `localhost:8080`; the gear opens that
file and creates no second one.

Credentials go in with the login form of the panel, which opens when an engine needs one. They
live in Orca's secret storage, in the OS key store, bound to the project file's path and the
engine's address: after you rename `.pulse-cli.json` to `.pulse.json`, the panel asks for each
login once more. The tabs Pulse opens (`.pulse/views` in the workspace) do not depend on the
file's name and stay.

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
