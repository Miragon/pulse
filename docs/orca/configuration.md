# Configuration

## Engines

Pulse for Orca reads your engines as profiles in `.pulse-cli.json`, the project file of the
[Pulse CLI](../cli/configuration.md), with the same rules as
[Pulse for VS Code](../vscode/configuration.md#engines): `url`, `flavor`, `engine`, `auth.type`,
`cockpitUrl` and `readOnly`, a profile the CLI refuses shown as a problem in the panel.

The plugin takes the project file its setting names, else the `.pulse-cli.json` at the root of
the focused workspace, else one engine on `localhost:8080`. It reads the file again when it
changes. The gear in the panel opens it, created from a template when there is none.

Credentials go in with the login form of the panel, which opens when an engine needs one. They
live in Orca's secret storage, in the OS key store, bound to the project file and the engine's
address.

## Settings

The plugin's settings are in Orca's settings, under Pulse:

| Setting                                              | Values                                                                      | Default                    |
| ---------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------- |
| Project file                                         | the path of a `.pulse-cli.json`                                             | the focused workspace's    |
| Writes                                               | on engines on this machine only, also on remote engines with a login, never | this machine only          |
| Environments                                         | JSON, per profile: `local`, `test`, `production`                            | loopback hosts are `local` |
| Live updates (local, test, production, unclassified) | default, on, off                                                            | local and test on          |

A `.vscode/settings.json` next to the project file adds its `pulse.environments`, as it does for
the extension. Production and unclassified engines ask you to type their host before a write;
the [write rules](../vscode/configuration.md) are the extension's.
