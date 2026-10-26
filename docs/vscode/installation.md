# Installation

Pulse for VS Code is not on the Marketplace or Open VSX yet. You build the `.vsix` from the
Pulse repository and install it.

## Build and install

```sh
git clone https://github.com/Miragon/pulse.git && cd pulse
pnpm install --frozen-lockfile
pnpm --filter pulse-vscode run package               # writes apps/vscode/pulse-vscode-<version>.vsix
code --install-extension apps/vscode/pulse-vscode-*.vsix
```

Then tell Pulse which engines to show: [Configuration](./configuration.md).

## Try it on a seeded engine

From the root of the repository, start an Operaton engine with demo instances (Podman or Docker)
and build the extension:

```sh
pnpm --filter pulse-vscode run engine:up   # Operaton on :18080, seeded with demo instances
pnpm --filter pulse-vscode run build
```

Open `apps/vscode` in VS Code and press **F5** ("Run Pulse"). For hands-on testing there is a
shop sandbox with two engines (Operaton and CIB seven with login), about 200 instances,
incidents with real stack traces and a model that drifted:

```sh
pnpm --filter pulse-vscode run sandbox:open     # builds Pulse, starts the engines, opens the sandbox
pnpm --filter pulse-vscode run sandbox:traffic  # optional: live orders until Ctrl+C
```

Its test charter is in `apps/vscode/sandbox/README.md`.

## Next steps

- [Configuration](./configuration.md): add your own engines.
- [Usage](./usage.md): what the views and panels do.
