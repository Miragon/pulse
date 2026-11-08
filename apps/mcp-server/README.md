# @miragon/pulse-mcp-server

[![Image](https://img.shields.io/badge/image-ghcr.io%2Fmiragon%2Fpulse--server-2496ED?style=flat-square&logo=docker&logoColor=white)](https://github.com/Miragon/pulse/pkgs/container/pulse-server)
[![Docs](https://img.shields.io/badge/docs-miragon.github.io%2Fpulse-335DE5?style=flat-square)](https://miragon.github.io/pulse/)

Ask your AI assistant about your Camunda 7, CIB seven and Operaton engines, and get the answer as
an interactive view in the chat.

![A chat asks why order ORD-10130 is stuck; Pulse answers with the incident view: the payment task failed because the card expired, with a retry button and the process diagram](../../docs/assets/chat-incident.png)

## Connect

```bash
docker run --rm -p 127.0.0.1:8400:8400 \
  --add-host=host.docker.internal:host-gateway \
  -e ENGINE_BASE_URL=http://host.docker.internal:8080/engine-rest \
  ghcr.io/miragon/pulse-server:latest
claude mcp add --transport http pulse http://localhost:8400/mcp
```

On Linux `host.docker.internal` reaches an engine only on a port the host serves beyond
`127.0.0.1`; for an engine in Docker, join its network as [Run](#run) shows.

Claude Desktop, claude.ai, ChatGPT and other hosts: [Usage](../../docs/mcp/usage.md#connect-your-assistant).

Then ask _"Which incidents are open, and why?"_. Without OAuth the server runs read-only;
the boot log names the toolset of each module. Writes, OAuth and several engines:
[Operations](../../docs/mcp/operations.md).

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../../docs/assets/widget-incident-dark.png">
  <img alt="The incident view of the MCP server: a failed payment task with its error message, a retry button and the process diagram with the failing step marked" src="../../docs/assets/widget-incident.png">
</picture>

## Overview

The MCP host for [Pulse](../../README.md). It composes the `engine` module
into a single server on the official [MCP TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/v2/),
bundles every React widget into
one Vite bundle served as per-tool view resources, and serves the streamable-HTTP MCP transport on
port `8400`.

This is the deployable artifact: it ships as the Docker image
[`ghcr.io/miragon/pulse-server`](https://github.com/Miragon/pulse/pkgs/container/pulse-server).
The package itself is `private` and not published to npm.

## What it does

- **Composes modules:** loads the modules named in `MCP_ACTIVE_MODULES` (default: all) and
  registers their tools and widgets on one server; a tool name two modules share fails the boot.
  A module with toolsets runs one fail-closed toolset per boot: the suffix if given (`engine:operations`,
  …), otherwise read-only without OAuth and its standard toolset (engine `operations`)
  with it; `admin` is never implied, an empty or unknown suffix falls back to read-only, and the
  boot log states the result.
  Modules self-describe via their
  `src/module.ts` (`configFromEnv`, `knownEnvVars`, `bootWarnings`, `instructions`, plugin
  factory) against the app-owned port in [`src/setup.ts`](src/setup.ts); the app only lists its
  modules and wires what they share (today nothing), the shared boot selects them and installs
  OAuth.
- **Bundles the widget UI:** Vite builds the two-file bundle `dist/mcp-app.js` + `dist/mcp-app.css`,
  a self-contained bundle (React, Tailwind, all widgets). The boot serves it behind one
  `ui://views/<tool>.html` view resource per widget tool (the `_meta.ui.resourceUri` its
  `showToolBinding` sets),
  each with a prelude naming its view, so `mountViews` picks the tool's view from
  [`src/ui/view-registry.ts`](src/ui/view-registry.ts). The `dedupe` array in
  [`vite.config.ts`](vite.config.ts) is load-bearing: it spreads widget-shell's `VIEW_BUNDLE_DEDUPE`
  and so keeps a single React / TanStack Query / pulse-ui / widget-shell / lucide-react instance, so a
  widget finds the view host and the one `QueryClient`.
- **Serves HTTP:** streamable-HTTP MCP on `:8400/mcp` (POST only, stateless: GET, DELETE and HEAD
  get 405), `/health/*` and `/metrics`. No inspector ships with the server: `pnpm dev` starts the
  official MCP Inspector as a process of its own.

The server is self-contained (tools + widget UI in one endpoint). Aggregating it with other MCP
servers is the job of an external MCP gateway (e.g. agentgateway) in front; there is no built-in
upstream/proxy federation.

## Run

```bash
# Published image (production) on the playground's network (pnpm stack:up), read-only without
# OAuth or a toolset suffix
docker run --rm -p 127.0.0.1:8400:8400 --network pulse_default \
  -e ENGINE_BASE_URL=http://cibseven:8410/engine-rest -e ENGINE_ID=prod-a \
  -e ENGINE_FLAVOR=cibseven -e ENGINE_COCKPIT_URL=http://localhost:8410/webapp \
  ghcr.io/miragon/pulse-server:latest

# From source (local dev: needs the Docker infra; see the root README)
pnpm dev          # build once, then vite build --watch + tsx watch on :8400 and the MCP Inspector
pnpm build        # build:ui (Vite widget bundle) + build:server (tsc)
pnpm start        # run the compiled server from dist/
```

The container joins the playground's Docker network and reaches the engine by its service name,
on Linux and under Docker Desktop alike; `host.docker.internal` would miss its port on Linux,
which the playground publishes on `127.0.0.1` only. `ENGINE_COCKPIT_URL`
stays on `localhost`: your browser opens those links.

Pulse assumes a Camunda 7 engine. The recipe sets `ENGINE_FLAVOR=cibseven` for the playground's
CIB seven (`operaton` for Operaton, none for Camunda 7): it picks the engine's cockpit links and
the product name the views show.

Configuration is entirely environment-driven. See
[Configuration](../../docs/mcp/reference.md#configuration), [Toolsets](../../docs/mcp/reference.md#toolsets) and
[`docs/mcp/operations.md`](../../docs/mcp/operations.md). To exercise write paths locally, set
`MCP_ACTIVE_MODULES=engine:admin` in `.env` (plus
`ENGINE_ALLOW_DEPLOYMENTS=true` for deployments).

## Layout

| Path             | Contents                                                                                                                            |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`   | Server entry: `runComposedServer(createApp)` listens (body cap, drain), under `pnpm dev` too; a failed boot prints one line, exit 1 |
| `src/app.ts`     | `createApp(env, deps?)`: the shared boot over the module list; the e2e suites boot it too                                           |
| `src/setup.ts`   | The module list and what the modules share (`SharedResources`, today empty)                                                         |
| `src/ui/`        | Widget host bundle: `view-registry.ts` (the views) + `main.tsx` (`mountViews`)                                                      |
| `vite.config.ts` | Single-file widget bundle config (keep `dedupe` spreading `VIEW_BUNDLE_DEDUPE`)                                                     |
| `Dockerfile`     | Lives at the repo root; multi-stage build that produces the published image                                                         |
