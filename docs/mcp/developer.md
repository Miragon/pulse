# Pulse developer guide

From a fresh clone to a running server in one command, or zero if you start with the hosted playground.

## Try it first (no install)

Point any MCP client at the [playground](https://pulse-playground.miragon.ai/mcp)
(`https://pulse-playground.miragon.ai/mcp`): a seeded engine, live traffic, and the full
analytics stack, read-only. See [Connect your Claude in 30 seconds](getting-started.md#connect-your-claude-in-30-seconds). Everything below is for running your own stack.

## Prerequisites

- Node.js 22.22.2 or later (`engines` in the root `package.json`)
- pnpm 10.32.1 (pinned via `packageManager`; `corepack enable` picks it up automatically)
- Docker: the local playground, and the engine jar's build when no JDK 21 is installed
- Optional: a JDK 21, which builds the engine jar and the Kotlin engine plugins faster

## Clone and run

```bash
git clone git@github.com:Miragon/pulse.git
cd pulse
pnpm play
```

`pnpm play` installs the dependencies, starts the playground in Docker (CIB seven with demo data
and live traffic, the OTEL Collector, Prometheus, Grafana; the first start builds the engine jar,
a few minutes), builds the server and runs it on `:8400` against the playground. Connect any MCP
host to `http://localhost:8400/mcp`, or open the inspector at `http://localhost:8400/mcp/inspector`.
It boots read-only; `--admin` adds the write tools, `--deploy` deployments, `--multi-engine` a
second engine. A variable set in your shell wins over the playground's settings. Ctrl-C stops the
server, the playground keeps running. Every port binds to `127.0.0.1`.

## Common tasks

| Command                                         | What it does                                                                                          |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `pnpm play:cli -- <args>`                       | The CLI against the playground engine                                                                 |
| `pnpm stack:up` / `stack:down` / `stack:status` | Start (`--multi-engine`, `--auth`), stop (`--wipe` drops the volumes) or show the playground          |
| `pnpm dev`                                      | The server with your own settings (`cp .env.example .env` first)                                      |
| `pnpm check`                                    | The bar for every change: install, build, typecheck, test, lint, format; a log per step in `reports/` |
| `pnpm check:all`                                | `check` plus the host simulation, the template, the Gradle build, the docs build, the engine suites   |
| `pnpm lint:fix` / `pnpm format`                 | ESLint and Prettier fixes                                                                             |

The gates one by one: `pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm format:check`.
`pnpm check` names every failure in one run: a red step stops none, each gate of `pnpm lint` is a
step of its own, and turbo goes on past a red package. In CI a failed test of `scripts/` is an
annotation on its file and a row in the job summary.
`pnpm dev` and `pnpm play` bind 127.0.0.1; `pnpm start` and Docker listen on all interfaces.

Mutation testing covers `@miragon/pulse-engine-core` only (owner decision, 2026-11-04;
`MUTATED_PACKAGES` in `scripts/check-package-scripts.mjs`):
`pnpm --fail-if-no-match --filter @miragon/pulse-engine-core exec stryker run` (`--mutate <file>`
narrows it). A pull request runs none: `.github/workflows/mutation-nightly.yml` mutates it each
night (incremental).

## Build your own server

The modules ship on public npm: `@miragon/pulse-engine-connector`,
`@miragon/pulse-analytics-connector`, `@miragon/pulse-widget-shell`, `@miragon/pulse-ui`, the two
client packages and `@miragon/pulse-engine-core`, released in lockstep (pin one version across all).
[`templates/composed-server/`](https://github.com/Miragon/pulse/tree/main/templates/composed-server)
is a ready-to-copy pnpm workspace that composes them with an example custom module (tools,
widget, guard tests included); its `CLAUDE.md` and `.claude/skills/` document the module
contract and the invariants, its `README.md` is the quick tour. CI runs the template against the
workspace's packed packages on every change (`scripts/test-template.sh`). Each release also
syncs it (tested against the published packages, with a committed lockfile) to the read-only
mirror [`Miragon/pulse-starter`](https://github.com/Miragon/pulse-starter)
("Use this template" ready; contribute in Miragon/pulse, not there).

## Documentation

- These pages are Markdown in `docs/`, next to the code they describe, and build into this VitePress site (`pnpm docs:dev`, `pnpm docs:build`), published to [miragon.github.io/pulse](https://miragon.github.io/pulse/) on every push to `main`. A change to env vars, tools, ports or the getting-started steps updates them in the same PR. `scripts/docs-refs.test.mjs` checks every tool name and repo path they cite, and each page's line budget.
- The product page [miragon.ai/tools/pulse](https://miragon.ai/tools/pulse/) is built from [Miragon/miragon-ai-docs](https://github.com/Miragon/miragon-ai-docs).
- [Reference](reference.md) lists every tool, toolset and the common env vars; [`engine-plugins/README.md`](https://github.com/Miragon/pulse/blob/main/engine-plugins/README.md) covers the Kotlin plugin build.
