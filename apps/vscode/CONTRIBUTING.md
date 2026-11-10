# Developing Pulse for VS Code

How the extension is built, tested and released. Using it is on the
[docs site](https://miragon.github.io/pulse/vscode/); the repository's setup and bar are in the
root [CONTRIBUTING.md](../../CONTRIBUTING.md). Screenshots of every use case:
[docs/screenshots](docs/screenshots/README.md). The Marketplace page is
[MARKETPLACE.md](MARKETPLACE.md), a copy of [README.md](README.md): change both together. Their
images use paths from the repository root (`/docs/assets/listing/vscode/…`), which GitHub resolves
and `vsce` rewrites to `https://github.com/Miragon/pulse/raw/HEAD/…`. The gallery images are the
screenshots of `docs/assets/vscode/` in a window frame from the `product-shots` skill
(`render.mjs --image … --chrome mac --theme dark`).

## Architecture

The core never knows which engine it talks to: it asks the ports of the engine contract
(`@miragon/pulse-engine-core`), and one adapter per dialect family answers. Who talks to whom, about what and how, in pictures:
[docs/architecture-overview.md](docs/architecture-overview.md). The extension is the VS Code
host of the runtime view it shares with Pulse for Orca: six layers, each with its own globals
and dependency rules, each explaining its idea in its own README:
[the engine contract](../../packages/connectors/engine/engine-core/README.md),
[ports](../../packages/core/runtime-view/src/ports/README.md),
[core](../../packages/core/runtime-view/src/core/README.md),
[webview](../../packages/core/runtime-view/src/webview/README.md), [host](src/host/README.md),
[the C7 adapter](../../packages/connectors/c7/c7-adapter/src/README.md). A new engine
family is one more adapter package and one entry in each composition root
([how](docs/architecture-overview.md#4-one-adapter-for-operaton-cib-seven-and-camunda-7)).
Decisions and their reasons: [docs/adr](docs/adr/README.md).

## Development

Run these from the repository root; the repository's bar (`pnpm build && pnpm typecheck &&
pnpm test && pnpm lint`) covers the extension too.

| Command                                                    | What it does                                                                                                                 |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter pulse-cockpit test`                         | the host's unit and architecture tests, coverage floors, brand and word scans of runtime view and host, the bundle budget    |
| `pnpm --filter @miragon/pulse-runtime-view test`           | the core, model, host kit and webview tests (the webview's in Chromium), with the coverage floors, the host kit's among them |
| `pnpm --filter @miragon/pulse-c7-adapter test`             | the C7 adapter against recorded REST routes and its error-path goldens, with the coverage floors                             |
| `pnpm --filter pulse-cockpit run typecheck`                | the app, then the host and the tooling with their globals only                                                               |
| `pnpm --filter @miragon/pulse-runtime-view run typecheck`  | the runtime view, then each layer with its runtime's globals only                                                            |
| `pnpm --filter pulse-cockpit run lint`                     | ESLint with the extension's house rules                                                                                      |
| `pnpm lint:architecture:vscode`                            | the closed-world dependency rules of the host                                                                                |
| `pnpm lint:architecture:runtime-view`                      | the closed-world dependency rules of the runtime view's layers                                                               |
| `pnpm lint:architecture:c7-adapter`                        | the closed-world dependency rules of the C7 adapter                                                                          |
| `pnpm lint:deadcode`                                       | knip over every workspace, the extension included: no dead file, dependency or enum member                                   |
| `pnpm lint:deadcode:exports`                               | knip over every workspace but docs: no unused export or exported type                                                        |
| `pnpm --filter @miragon/pulse-c7-adapter run test:engines` | conformance kit against a real engine (`PULSE_ENGINE_IMAGE`, testcontainers)                                                 |
| `pnpm --filter pulse-cockpit run test:smoke`               | activation test in VS Code (`@vscode/test-cli`)                                                                              |
| `pnpm --filter pulse-cockpit run test:e2e`                 | Playwright drives VS Code against `engine:up`                                                                                |
| `pnpm --filter pulse-cockpit run test:smoke:docker`        | the smoke test in Docker under Xvfb (`apps/vscode/test/docker`): no VS Code window opens                                     |
| `pnpm --filter pulse-cockpit run test:e2e:docker`          | the e2e in Docker under Xvfb, against `engine:up`; screenshots land in test-results/e2e                                      |
| `pnpm --filter pulse-cockpit run dev`                      | browser dev host for the webview (fake engine or `PULSE_DEV_ENGINE`)                                                         |
| `pnpm --filter pulse-cockpit run sandbox:up`               | shop sandbox for manual testing (`sandbox:traffic`, `sandbox:down`)                                                          |
| `pnpm --filter pulse-cockpit run docs:screenshots`         | one VS Code screenshot per use case into `apps/vscode/docs/screenshots` (sandbox running)                                    |
| `pnpm --filter pulse-cockpit run package`                  | the `.vsix`                                                                                                                  |

The extension bundles the runtime view and the C7 adapter, and they bundle
`@miragon/pulse-engine-core`, the adapter `@miragon/pulse-c7-core` too, from their builds: after
`pnpm install`, build them once (`pnpm exec turbo run build --filter='pulse-cockpit^...'`, or
`pnpm build`) before these commands, and again after a change to one of them. The webview tests
need Chromium once: `pnpm --filter @miragon/pulse-runtime-view exec playwright install chromium`.

The README's `apps/vscode/docs/demo.gif` comes from the `product-shots` skill in
[Miragon/corporate-identity](https://github.com/Miragon/corporate-identity), see
[CLAUDE.md](CLAUDE.md#commands). Its store banner comes from the same skill, see the repository's [CONTRIBUTING.md](../../CONTRIBUTING.md#product-images).

Rules for contributors and coding agents: [CLAUDE.md](CLAUDE.md).

## Release

The extension rides Pulse's release train: release-please bumps `apps/vscode/package.json`
with every Pulse release (tag `v<version>`), and after the release approval
`.github/workflows/publish-vscode-extension.yml` packages the .vsix once, publishes it as a
plain release to the Visual Studio Marketplace and Open VSX and attaches it to the GitHub
release. Every pull
request packages it too (CI job "VS Code package (vsce dry run)"); to check the release path by
hand, run the Release workflow with `dry_run`. The whole train:
[the repository's CLAUDE.md](../../CLAUDE.md#releases).
