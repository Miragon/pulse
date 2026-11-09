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
(`@miragon/pulse-engine-core`), and one adapter per engine family answers. Who talks to whom, about what and how, in pictures:
[docs/architecture-overview.md](docs/architecture-overview.md). The extension is the VS Code
host of the runtime view it shares with Pulse for Orca: six layers, each with its own globals
and dependency rules, each explaining its idea in its own README:
[the engine contract](../../packages/connectors/engine/engine-core/README.md),
[ports](../../packages/core/runtime-view/src/ports/README.md),
[core](../../packages/core/runtime-view/src/core/README.md),
[webview](../../packages/core/runtime-view/src/webview/README.md), [host](src/host/README.md),
[the C7 adapter](../../packages/connectors/engine/engine-adapter/src/README.md). A new engine
family is one more adapter package and one entry in each composition root
([how](docs/architecture-overview.md#4-one-adapter-for-operaton-cib-seven-and-camunda-7)).
Decisions and their reasons: [docs/adr](docs/adr/README.md).

## Development

Run these from the repository root; the repository's bar (`pnpm build && pnpm typecheck &&
pnpm test && pnpm lint`) covers the extension too.

| Command                                                        | What it does                                                                                 |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `pnpm --filter pulse-cockpit test`                             | unit tests and the webview tests in Chromium, with the coverage floors and the bundle budget |
| `pnpm --filter pulse-cockpit run typecheck`                    | the whole app, then each layer with its runtime's globals only                               |
| `pnpm --filter pulse-cockpit run lint`                         | ESLint with the extension's house rules                                                      |
| `pnpm lint:architecture:vscode`                                | the closed-world dependency rules of the layers                                              |
| `pnpm lint:deadcode`                                           | knip over every workspace, the extension included: no dead file, dependency or enum member   |
| `pnpm lint:deadcode:exports`                                   | knip over every workspace but docs: no unused export or exported type                        |
| `pnpm --filter @miragon/pulse-engine-adapter run test:engines` | conformance kit against a real engine (`PULSE_ENGINE_IMAGE`, testcontainers)                 |
| `pnpm --filter pulse-cockpit run test:smoke`                   | activation test in VS Code (`@vscode/test-cli`)                                              |
| `pnpm --filter pulse-cockpit run test:e2e`                     | Playwright drives VS Code against `engine:up`                                                |
| `pnpm --filter pulse-cockpit run test:smoke:docker`            | the smoke test in Docker under Xvfb (`apps/vscode/test/docker`): no VS Code window opens     |
| `pnpm --filter pulse-cockpit run test:e2e:docker`              | the e2e in Docker under Xvfb, against `engine:up`; screenshots land in test-results/e2e      |
| `pnpm --filter pulse-cockpit run dev`                          | browser dev host for the webview (fake engine or `PULSE_DEV_ENGINE`)                         |
| `pnpm --filter pulse-cockpit run sandbox:up`                   | shop sandbox for manual testing (`sandbox:traffic`, `sandbox:down`)                          |
| `pnpm --filter pulse-cockpit run docs:screenshots`             | one VS Code screenshot per use case into `apps/vscode/docs/screenshots` (sandbox running)    |
| `pnpm --filter pulse-cockpit run package`                      | the `.vsix`                                                                                  |

The C7 adapter bundles `@miragon/pulse-c7-core` from its build: after `pnpm install`, build it
once (`pnpm exec turbo run build --filter='pulse-cockpit^...'`, or `pnpm build`) before these
commands, and again after a change to c7-core. The webview tests need Chromium once:
`pnpm --filter pulse-cockpit exec playwright install chromium`.

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
