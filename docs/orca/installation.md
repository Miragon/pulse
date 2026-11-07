# Installation

Pulse for Orca needs Orca 1.4.248 or later on the desktop. It runs as a trusted worker: Orca
asks you to approve the access it needs before it runs.

## From its repository

Every Pulse release publishes the plugin to its read-only repository
[Miragon/pulse-orca](https://github.com/Miragon/pulse-orca), tagged with the release:

```sh
orca plugin install Miragon/pulse-orca
```

Orca installs the newest version tag and prints what the plugin asks for: its own secrets,
settings and storage, reading and writing workspace files, and desktop notifications. It prints
the command that approves exactly this version too, `orca plugin install Miragon/pulse-orca
--approve <fingerprint>`. `orca plugin update` moves to the next release; each release asks again
when its access changes. Each Pulse release also carries the plugin folder as
`pulse-orca-<version>.tar.gz`.

## From the source

To try a change, build the plugin folder and load it as a development plugin:

```sh
pnpm install && pnpm build
orca plugin dev load apps/orca/dist                    # prints the approval command
orca plugin dev load apps/orca/dist --approve <fingerprint>
```

The VS Code extension's sandbox starts two seeded engines to try it on
(`pnpm --filter pulse-cockpit run sandbox:up`). Point the plugin at its project file in the
plugin's settings, then open the panel with `orca plugin open local.pulse-cockpit`.
