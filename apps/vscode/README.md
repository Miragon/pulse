# Pulse for VS Code

[![CI](https://github.com/Miragon/pulse/actions/workflows/ci.yml/badge.svg)](https://github.com/Miragon/pulse/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> [!IMPORTANT]
> **Spike phase.** Pulse for VS Code is an early prototype that explores whether this is worth
> building. It ships on the [Marketplace](https://marketplace.visualstudio.com/items?itemName=miragon-gmbh.pulse-cockpit) and [Open VSX](https://open-vsx.org/extension/miragon-gmbh/pulse-cockpit), see [Installation](https://miragon.github.io/pulse/vscode/installation). Changes to engine data
> are off for every engine but a local one unless you turn them on (`pulse.writes`).

A VS Code extension that shows what your process engine is running, right next to your BPMN
models: definitions, instances, incidents and variables, with the badges on the deployed
diagram. It works with [Operaton](https://operaton.org), [CIB seven](https://cibseven.org) and
Camunda 7.

![Pulse in VS Code: from the engine to its process and an instance with an incident, the expired card fixed in its variables and the retry that clears the incident](docs/demo.gif)

Installation, configuration and usage are on the docs site:
[miragon.github.io/pulse/vscode](https://miragon.github.io/pulse/vscode/). Screenshots of every
use case: [docs/screenshots](docs/screenshots/README.md).

## Architecture

The core never knows which engine it talks to: it asks the ports of a contract, and one adapter
per engine family answers. Who talks to whom, about what and how, in pictures:
[docs/architecture-overview.md](docs/architecture-overview.md). The extension is one package
with six layers under `src/`, each with its own globals and dependency rules, and each layer
explains its idea in its own README: [contract](src/contract/README.md),
[core](src/core/README.md), [webview](src/webview/README.md), [host](src/host/README.md),
[the C7 adapter](src/adapters/c7/README.md). A new engine is one more adapter folder under
`src/adapters/` and one entry in the composition root
([how](docs/architecture-overview.md#4-one-adapter-for-operaton-cib-seven-and-camunda-7)).
Decisions and their reasons: [docs/adr](docs/adr/README.md).

## Development

Run these from the repository root; the repository's bar (`pnpm build && pnpm typecheck &&
pnpm test && pnpm lint`) covers the extension too.

| Command                                            | What it does                                                                                 |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `pnpm --filter pulse-cockpit test`                 | unit tests and the webview tests in Chromium, with the coverage floors and the bundle budget |
| `pnpm --filter pulse-cockpit run typecheck`        | the whole app, then each layer with its runtime's globals only                               |
| `pnpm --filter pulse-cockpit run lint`             | ESLint with the extension's house rules                                                      |
| `pnpm lint:architecture:vscode`                    | the closed-world dependency rules of the layers                                              |
| `pnpm lint:deadcode:vscode`                        | knip over the extension: no dead file, dependency, export or exported type                   |
| `pnpm --filter pulse-cockpit run test:mutation`    | Stryker mutation testing of contract, core, the C7 adapter and the model adapter             |
| `pnpm --filter pulse-cockpit run test:engines`     | conformance kit against a real engine (`PULSE_ENGINE_IMAGE`, testcontainers)                 |
| `pnpm --filter pulse-cockpit run test:smoke`       | activation test in VS Code (`@vscode/test-cli`)                                              |
| `pnpm --filter pulse-cockpit run test:e2e`         | Playwright drives VS Code against `engine:up`                                                |
| `pnpm --filter pulse-cockpit run dev`              | browser dev host for the webview (fake engine or `PULSE_DEV_ENGINE`)                         |
| `pnpm --filter pulse-cockpit run sandbox:up`       | shop sandbox for manual testing (`sandbox:traffic`, `sandbox:down`)                          |
| `pnpm --filter pulse-cockpit run docs:screenshots` | one VS Code screenshot per use case into `apps/vscode/docs/screenshots` (sandbox running)    |
| `pnpm --filter pulse-cockpit run package`          | the `.vsix`                                                                                  |

The webview tests need Chromium once: `pnpm --filter pulse-cockpit exec playwright install chromium`.

The README's `apps/vscode/docs/demo.gif` comes from the `product-shots` skill in
[Miragon/corporate-identity](https://github.com/Miragon/corporate-identity), see
[CLAUDE.md](CLAUDE.md#commands).

Rules for contributors and coding agents: [CLAUDE.md](CLAUDE.md).

## Release

The extension rides Pulse's release train: release-please bumps `apps/vscode/package.json`
with every Pulse release (tag `v<version>`), and after the release approval
`.github/workflows/publish-vscode-extension.yml` packages the .vsix once, publishes it as a
plain release to the Visual Studio Marketplace and Open VSX and attaches it to the GitHub
release. Every pull
request packages it too (CI job "VS Code package (vsce dry run)"); to check the release path by
hand, run the Release workflow with `dry_run`. The whole train:
[the repository's CLAUDE.md](../../CLAUDE.md#releases--toolkit-contributions).

## License

MIT
