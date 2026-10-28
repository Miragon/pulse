# Pulse developer guide

A working development environment for Pulse in five commands, or zero if you start with the hosted playground.

## Try it first (no install)

Point any MCP client at the [playground](https://pulse-playground.miragon.ai/mcp)
(`https://pulse-playground.miragon.ai/mcp`): a seeded engine, live traffic, and the full
analytics stack, read-only. See [Connect your Claude in 30 seconds](getting-started.md#connect-your-claude-in-30-seconds). Everything below is for running your own stack.

## Prerequisites

- Node.js 22.22.2 or later (`engines` in the root `package.json`)
- pnpm 10.32.1 (pinned via `packageManager`; `corepack enable` picks it up automatically)
- Java 21 + [jenv](https://www.jenv.be/) (only needed to build the Kotlin engine plugins)
- Docker (for Camunda, the OTEL Collector, and Prometheus)

## Clone and install

```bash
git clone git@github.com:Miragon/pulse.git
cd pulse
pnpm install
```

## Start the infrastructure

The default Compose stack brings up CIB seven, the OTEL Collector, Prometheus, and Grafana, but **not** the Node MCP server, so port `8400` stays free for `pnpm dev`. Every port binds to `127.0.0.1`.

```bash
docker compose -f playground/docker/docker-compose.yml up -d
```

## Run the server

```bash
cp .env.example .env   # dev defaults: engine on :8410, Prometheus on :8460
pnpm dev
```

This starts the MCP server on `:8400`. Connect any MCP host to `http://localhost:8400/mcp` and
call a tool. It boots read-only (no `MCP_OAUTH`, no toolset suffix, as the boot log says); to test
write paths, uncomment `MCP_ACTIVE_MODULES=camunda7:admin,analytics:standard` in `.env`.
`pnpm dev` binds 127.0.0.1; `pnpm start` and Docker listen on all interfaces.

## Common tasks

| Command                       | What it does                    |
| ----------------------------- | ------------------------------- |
| `pnpm build`                  | Turbo build across the monorepo |
| `pnpm typecheck`              | TypeScript across all packages  |
| `pnpm test`                   | Vitest across all packages      |
| `pnpm lint` / `pnpm lint:fix` | ESLint                          |
| `pnpm format`                 | Prettier                        |

Mutation testing: `pnpm --fail-if-no-match --filter <package> exec stryker run` (`--mutate <file>`
narrows it) for `@miragon/pulse-widget-shell`, `-camunda7-client`, `-camunda7-connector`,
`-analytics-client`, `-analytics-connector`, `-cli` or `pulse-cockpit`. A pull request runs none:
`.github/workflows/mutation-nightly.yml` mutates every package each night (incremental).

## Build your own server

The modules ship on public npm: `@miragon/pulse-camunda7-connector`,
`@miragon/pulse-analytics-connector`, `@miragon/pulse-widget-shell` plus the two client packages,
released in lockstep (pin one version across all of them).
[`templates/composed-server/`](https://github.com/Miragon/pulse/tree/main/templates/composed-server)
is a ready-to-copy pnpm workspace that composes them with an example custom module (tools,
widget, guard tests included); its `CLAUDE.md` and `.claude/skills/` document the module
contract and the invariants, its `README.md` is the quick tour. CI runs the template against the
workspace's packed packages on every change (`scripts/test-template.sh`). Each release also
syncs it (tested against the published packages, with a committed lockfile) to the read-only
mirror [`Miragon/pulse-starter`](https://github.com/Miragon/pulse-starter)
("Use this template" ready; contribute in Miragon/pulse, not there).

## Documentation

- These pages are Markdown in `docs/`, next to the code they describe, and build into this VitePress site (`pnpm docs:dev`, `pnpm docs:build`), published to [miragon.github.io/pulse](https://miragon.github.io/pulse/) on every push to `main`. A change to env vars, tools, ports or the getting-started steps updates them in the same PR. `apps/mcp-server-camunda7/test/docs-refs.test.ts` checks every tool name and repo path they cite, and each page's line budget.
- The product page [miragon.ai/tools/pulse](https://miragon.ai/tools/pulse/) is built from [Miragon/miragon-ai-docs](https://github.com/Miragon/miragon-ai-docs).
- [Reference](reference.md) lists every tool, toolset and the common env vars; [`engine-plugins/README.md`](https://github.com/Miragon/pulse/blob/main/engine-plugins/README.md) covers the Kotlin plugin build.
