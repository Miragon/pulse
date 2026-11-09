# Installation

Pulse for Orca needs Orca 1.4.252 or later on the desktop. It is not published yet: until
[Miragon's Orca catalog](https://github.com/Miragon/orca-modelers) lists it next to the Miragon
modelers, you [load it from the source](#from-the-source). The two sections after it describe the
install once it is listed.

## From Orca's plugin directory

Turn on plugins in Orca once (Settings → Plugins → **Turn on plugins**). Then open
[Pulse in Orca's plugin directory](https://www.onorca.dev/plugins/miragon/orca-modelers/pulse-cockpit),
or search for **Pulse** in Settings → Plugins, and install it.

Pulse runs as a trusted worker, so Orca shows what it asks for before it runs: your engines over
the network, its own secrets, settings and storage, reading and writing workspace files, and
desktop notifications. The approval holds for exactly this version. New releases arrive through
Orca, and a release asks again when its access changes.

## From Miragon's catalog

If a release is not in Orca's directory yet, add the catalog in Settings → Plugins → ⋯ →
**Catalog sources…** (`https://github.com/miragon/orca-modelers.git`, ref `main`), or on the
command line. Each command prints the approval it needs and the same command with
`--approve <fingerprint>`:

```sh
orca plugin catalog add Miragon/orca-modelers
orca plugin install miragon.pulse-cockpit
```

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
