# Installation

Pulse for Orca needs Orca 1.4.252 or later on the desktop. It is listed in
[Miragon's Orca catalog](https://github.com/Miragon/orca-modelers), next to the Miragon modelers,
and every Pulse release publishes a new version there.

## From the catalog

Open [Pulse in Orca](https://onorca.dev/plugins/miragon.pulse-cockpit?catalog=https://github.com/miragon/orca-modelers.git)
and press **Install**. The first time, Orca asks whether to add the catalog.

On the command line, add the catalog once, then install the plugin. Each command prints the
approval it needs and the same command with `--approve <fingerprint>`:

```sh
orca plugin catalog add Miragon/orca-modelers
orca plugin install miragon.pulse-cockpit
```

Pulse runs as a trusted worker, so Orca shows what it asks for before it runs: its own secrets,
settings and storage, reading and writing workspace files, and desktop notifications. The
approval holds for exactly this version. New releases arrive through the catalog
(`orca plugin update`), and a release asks again when its access changes.

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
