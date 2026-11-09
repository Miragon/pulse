# Pulse developer guide

From a fresh clone to a running server in one command, or zero if you start with the hosted playground.

## Try it first (no install)

Point any MCP client at the [playground](https://pulse-playground.miragon.ai/mcp)
(`https://pulse-playground.miragon.ai/mcp`): a seeded engine with live traffic,
read-only. See [Connect your Claude in 30 seconds](getting-started.md#connect-your-claude-in-30-seconds). Everything below is for running your own stack.

## Prerequisites

- Node.js 22.22.2 or later (`engines` in the root `package.json`)
- pnpm 10.32.1 (`packageManager`): `corepack enable`; Node.js 25+ has none: `npm i -g pnpm@10.32.1`
- Docker: the playground, and Gradle in a container when no JDK 21 is installed
- Optional: a JDK 21; Gradle then runs on it, and `./gradlew` by hand in `playground/cibseven-example/` needs one

## Clone and run

```bash
git clone git@github.com:Miragon/pulse.git
cd pulse
pnpm play
```

`pnpm play` installs the dependencies, starts the playground in Docker (CIB seven with demo data
and live traffic; the first start builds the engine jar, a few minutes), builds the server and runs
it on `:8400` against the playground, the engine module alone, next to the official
[MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector) on `127.0.0.1`: open the URL it prints (no browser
opens by itself) to call tools and render the widgets, or connect any MCP host to `http://localhost:8400/mcp`.
It boots read-only; `--admin` adds the write tools, `--deploy` deployments, `--multi-engine` a
second engine. A variable set in your shell wins over the playground's settings. Ctrl-C stops the
server, the playground keeps running. Every port binds to `127.0.0.1`. Worktrees share the playground
(`pnpm stack:down` stops it for all); `.mcp.json` reaches `${PORT:-8400}`, so run a second worktree's server as
`PORT=<port> CLIENT_PORT=<port> MCP_SANDBOX_PORT=<port> MCP_APP_ORIGIN_PORT=<port> pnpm play` (the inspector's
three ports, 6274, 6275 and 6278 by default) and its Claude Code session as `PORT=<port> claude`. The inspector
prints its sign-in token, one from `MCP_INSPECTOR_API_TOKEN` too: keep the output of `pnpm play` and `pnpm dev` out of shared logs.

## Common tasks

| Command                                         | What it does                                                                                          |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `pnpm play:cli -- <args>`                       | The CLI against the playground engine                                                                 |
| `pnpm stack:up` / `stack:down` / `stack:status` | Start (`--multi-engine`, `--auth`), stop (`--wipe` drops the volumes) or show the playground          |
| `pnpm dev`                                      | The server and the inspector with your own settings (`cp .env.example .env` first)                    |
| `pnpm test:one <file...>`                       | Test files in their packages, the packages under them built first, coverage off (`--watch`)           |
| `pnpm check`                                    | The bar for every change: install, build, typecheck, test, lint, format; a log per step in `reports/` |
| `pnpm check:all`                                | `check` plus the host simulation, the template, the Gradle build, the docs build, the engine suites   |
| `pnpm lint:fix` / `pnpm format`                 | ESLint and Prettier fixes                                                                             |

The gates one by one: `pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm format:check`.
While you iterate: `pnpm test:one <file...>`, then the package and what depends on it with
`pnpm exec turbo run typecheck test lint --filter=...<pkg>`, then `pnpm check`. A change to a tool,
an engine read's result or its error text refreshes the goldens with `pnpm --fail-if-no-match --filter @miragon/pulse-mcp-server golden:update`.
`pnpm dev` and `pnpm play` bind 127.0.0.1; `pnpm start` and Docker listen on all interfaces.
The inspector has no chat, so a hand-off shows only in a real host: tunnel the server
(`cloudflared tunnel --url http://localhost:8400`), set `MCP_URL` to the `https://` origin it prints
and restart (Cloudflare's quick tunnels carry no Server-Sent Events, which the server answers in: should
calls hang, use a named tunnel). Anyone with that URL reaches the server, so keep the read-only default.
To debug, press F5 in VS Code (`.vscode/launch.json`) or run any command in a JavaScript Debug Terminal.

Mutation testing covers `@miragon/pulse-c7-core` and `@miragon/pulse-http` (`MUTATED_PACKAGES`), nightly, never on a pull request: `pnpm --fail-if-no-match --filter @miragon/pulse-c7-core exec stryker run`, the same with `@miragon/pulse-http`.

Editors read only `tsconfig.json`: each widget, host-bundle and test tree has a nested one extending the `tsconfig.<x>.json` that checks it (`pnpm lint:package-scripts`); `.vscode/` pins TypeScript.

## Build your own server

[Build your own server](build-your-own.md) starts one from
[Miragon/pulse-starter](https://github.com/Miragon/pulse-starter), the read-only mirror of
`templates/composed-server/`: change the starter in this repository. CI tests the template against
the workspace's packed packages, also with a prebuilt module that brings its own HTML view
(`scripts/test-template.sh`), and each release syncs it to the mirror as a
[release](https://github.com/Miragon/pulse-starter/releases) of the same version
(`.github/workflows/sync-template-mirror.yml`).

## Documentation

- These pages are Markdown in `docs/`, next to the code they describe, and build into this VitePress site (`pnpm docs:dev`, `pnpm docs:build`), published to [miragon.github.io/pulse](https://miragon.github.io/pulse/) with each release, so the site shows what a release shipped (a pull request only builds them). A change to env vars, tools, ports or the getting-started steps updates them in the same PR. `scripts/docs-refs.test.mjs` checks every tool name and repo path they cite, and each page's line budget.
- The product page [miragon.ai/tools/pulse](https://miragon.ai/tools/pulse/) is built from [Miragon/miragon-ai-docs](https://github.com/Miragon/miragon-ai-docs).
- [Reference](reference.md) lists every tool, toolset and the common env vars.
