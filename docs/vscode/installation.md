# Installation

Pulse for VS Code is an early version. It ships with every Pulse
release, on the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=miragon-gmbh.pulse) and on [Open VSX](https://open-vsx.org/extension/miragon-gmbh/pulse) (VSCodium, Cursor and
other editors on Open VSX).

## From the Marketplace

In the Extensions view search for **Miragon Pulse**, or from a shell:

```sh
code --install-extension miragon-gmbh.pulse
```

Each GitHub release also carries the `.vsix`. To build it from source:

```sh
git clone https://github.com/Miragon/pulse.git && cd pulse
pnpm install --frozen-lockfile
pnpm --filter pulse run package               # writes apps/vscode/pulse-<version>.vsix
code --install-extension apps/vscode/pulse-*.vsix
```

## Try it on a seeded engine

From the root of the repository, start an Operaton engine with demo instances (Podman or Docker)
and build the extension:

```sh
pnpm --filter pulse run engine:up   # Operaton on :18080, seeded with demo instances
pnpm --filter pulse run build
```

Open `apps/vscode` in VS Code and press **F5** ("Run Pulse"). For hands-on testing there is a
shop sandbox with two engines (Operaton and CIB seven with login), about 200 instances,
incidents with real stack traces and a model that drifted:

```sh
pnpm --filter pulse run sandbox:open     # builds Pulse, starts the engines, opens the sandbox
pnpm --filter pulse run sandbox:traffic  # optional: live orders until Ctrl+C
```

Its test charter is in `apps/vscode/sandbox/README.md`.

## Next steps

- [Configuration](./configuration.md): add your own engines.
- [Usage](./usage.md): what the views and panels do.
