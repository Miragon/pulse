# Contributing to Pulse

Issues, pull requests and discussions are welcome on [GitHub](https://github.com/Miragon/pulse).
This page covers building, testing and releasing Pulse from this repository; using it is on the
[docs site](https://miragon.github.io/pulse/).

## Set up

A fresh clone needs Node.js 22.22.2 or later, pnpm (`corepack enable`, or `npm i -g pnpm@10.32.1` on
Node.js 25 and later) and Docker; no JDK (Gradle runs in a container without one), no `.env`:

```bash
pnpm play               # installs, starts the playground, builds, MCP server on :8400 + MCP Inspector
pnpm play:cli -- ping   # the CLI against the playground engine
pnpm stack:status       # what runs; pnpm stack:up / stack:down start and stop the playground
pnpm check              # the bar for every change: build, typecheck, test, lint, format
```

More tasks and the manual checks: [developer guide](docs/mcp/developer.md). Each client has its own
page: [CLI development](docs/cli/development.md), the [VS Code extension](apps/vscode/CONTRIBUTING.md) and the
[Orca plugin](apps/orca/CONTRIBUTING.md).

## What's in this repository

| Path                                                                                          | Package                                             | Role                                                                          |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------- |
| [`apps/mcp-server/`](apps/mcp-server)                                                         | `ghcr.io/miragon/pulse-server`                      | The MCP server: composes the modules, serves HTTP on `:8400`                  |
| [`apps/cli/`](apps/cli)                                                                       | `@miragon/pulse-cli`                                | The command line interface                                                    |
| [`apps/vscode/`](apps/vscode)                                                                 | `pulse-cockpit` (a .vsix)                           | Pulse for VS Code                                                             |
| [`apps/orca/`](apps/orca)                                                                     | `pulse-cockpit` (an Orca plugin, not published yet) | Pulse for Orca                                                                |
| [`packages/connectors/engine/engine-connector/`](packages/connectors/engine/engine-connector) | `@miragon/pulse-engine-connector`                   | Operations tools and widgets for Camunda 7 engines                            |
| [`packages/connectors/engine/engine-core/`](packages/connectors/engine/engine-core)           | `@miragon/pulse-engine-core`                        | Core of the engine family: the contract every dialect implements              |
| [`packages/connectors/c7/c7-client/`](packages/connectors/c7/c7-client)                       | `@miragon/pulse-c7-client`                          | SDK of the Camunda 7 REST dialect family: typed REST SDK and client           |
| [`packages/connectors/c7/c7-core/`](packages/connectors/c7/c7-core)                           | `@miragon/pulse-c7-core`                            | Core of the Camunda 7 REST dialect family: workflow domain, engine REST rules |
| [`packages/connectors/c7/c7-adapter/`](packages/connectors/c7/c7-adapter)                     | `@miragon/pulse-c7-adapter` (private)               | The C7 adapter of the editor hosts' runtime view                              |
| [`packages/core/ui/`](packages/core/ui)                                                       | `@miragon/pulse-ui`                                 | Design kit for Pulse views and your own React UIs                             |
| [`packages/core/widget-shell/`](packages/core/widget-shell)                                   | `@miragon/pulse-widget-shell`                       | View runtime and server boot for composed MCP servers                         |
| [`packages/core/runtime-view/`](packages/core/runtime-view)                                   | `@miragon/pulse-runtime-view` (private)             | The runtime view the VS Code extension and the Orca plugin share              |
| [`packages/core/profile/`](packages/core/profile)                                             | `@miragon/pulse-profile`                            | One profile format for the CLI, the editors and the MCP server                |
| [`packages/core/http/`](packages/core/http)                                                   | `@miragon/pulse-http`                               | One engine transport for the CLI, the editors and the MCP server              |
| [`playground/`](playground)                                                                   | —                                                   | Demo engine, Compose stack and the public playground                          |
| [`templates/composed-server/`](templates/composed-server)                                     | `Miragon/pulse-starter`                             | [Starter](docs/mcp/build-your-own.md) for your own server                     |

The rules for code changes, the architecture invariants and what each check covers are in
[`CLAUDE.md`](CLAUDE.md).

## Pull requests

Use [semantic commit messages](https://www.conventionalcommits.org/): they drive the release. Keep
`pnpm build && pnpm typecheck && pnpm test && pnpm lint` green (`pnpm check` runs them in that
order). A user-visible change (environment variables, tools, ports, getting-started steps) updates
the docs in `docs/` in the same pull request.

## Releases

[release-please](https://github.com/googleapis/release-please) releases everything together:
semantic commits on `main` open a release PR, and merging it publishes the server image, the npm
packages, the CLI (npm, binaries, image, Homebrew `miragon/tap/pulse-cli`) and the VS Code
extension (Marketplace and Open VSX).

## Product images

The banners of the READMEs come from the `product-shots` skill of
[Miragon/corporate-identity](https://github.com/Miragon/corporate-identity), described in
[`.miragon/product-shots.json`](.miragon/product-shots.json). The CLI card shows the terminal of
the docs site's landing demo (journey `.miragon/shots/landing-terminal.mjs`); the Pulse and VS Code
cards show the extension's webview from its dev page (light and dark), the MCP card the incident
view (`.miragon/shots/card-recipe.mjs`, at twice the card's size so it stays sharp). Render them again
from the repository root after the views or the skill changed:

```bash
node packages/core/runtime-view/dev/webview/serve.mjs --build   # the webview dev page the VS Code card loads
node "<product-shots skill>/scripts/listing.mjs"
```
