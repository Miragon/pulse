# Developing the MCP server

The MCP host of [Pulse](../../README.md). It composes the `engine` and `analytics` modules into a
single server on the official [MCP TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/v2/),
bundles every React widget into one Vite bundle served as per-tool view resources, and serves the
streamable-HTTP MCP transport on port `8400`. The package is `private`: it ships as the image
[`ghcr.io/miragon/pulse-server`](https://github.com/Miragon/pulse/pkgs/container/pulse-server),
built by the root `Dockerfile`. Setup and the repository's bar: [CONTRIBUTING.md](../../CONTRIBUTING.md).

## What it does

- **Composes modules:** loads the modules named in `MCP_ACTIVE_MODULES` (default: all) and
  registers their tools and widgets on one server; a tool name two modules share fails the boot.
  A module with toolsets runs one fail-closed toolset per boot: the suffix if given (`engine:operations`,
  …), otherwise read-only without OAuth and its standard toolset (engine `operations`)
  with it; `admin` is never implied, an empty or unknown suffix falls back to read-only, and the
  boot log states the result. Analytics declares none (every analytics tool is a read), so a
  suffix on it is ignored with a warning.
  Modules self-describe via their
  `src/module.ts` (`configFromEnv`, `knownEnvVars`, `bootWarnings`, `instructions`, plugin
  factory) against the app-owned port in [`src/setup.ts`](src/setup.ts); the app only lists its
  modules and wires their shared resources, the shared boot selects them and installs OAuth.
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

## Run from source

```bash
pnpm dev          # build once, then vite build --watch + tsx watch on :8400 and the MCP Inspector
pnpm build        # build:ui (Vite widget bundle) + build:server (tsc)
pnpm start        # run the compiled server from dist/
```

The published image against the playground (`pnpm stack:up`) joins its Docker network and reaches
the engine and Prometheus by their service names, on Linux and under Docker Desktop alike
(`host.docker.internal` would miss their ports on Linux, which the playground publishes on
`127.0.0.1` only); `ENGINE_COCKPIT_URL` stays on `localhost`, since your browser opens those links:

```bash
docker run --rm -p 127.0.0.1:8400:8400 --network pulse_default \
  -e ENGINE_BASE_URL=http://cibseven:8410/engine-rest -e ENGINE_ID=prod-a \
  -e ENGINE_FLAVOR=cibseven -e ENGINE_COCKPIT_URL=http://localhost:8410/webapp \
  -e PROMETHEUS_URL=http://prometheus:9090 \
  ghcr.io/miragon/pulse-server:latest
```

To exercise write paths locally, set `MCP_ACTIVE_MODULES=engine:admin,analytics` in `.env` (plus
`ENGINE_ALLOW_DEPLOYMENTS=true` for deployments). The host simulation of the built widget bundle
is in [`test-host/`](test-host/README.md).

## Layout

| Path             | Contents                                                                                                                            |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`   | Server entry: `runComposedServer(createApp)` listens (body cap, drain), under `pnpm dev` too; a failed boot prints one line, exit 1 |
| `src/app.ts`     | `createApp(env, deps?)`: the shared boot over the module list; the e2e suites boot it too                                           |
| `src/setup.ts`   | The module list and the cross-module wiring (`SharedResources`)                                                                     |
| `src/ui/`        | Widget host bundle: `view-registry.ts` (views + host widgets) + `main.tsx` (`mountViews`)                                           |
| `vite.config.ts` | Single-file widget bundle config (keep `dedupe` spreading `VIEW_BUNDLE_DEDUPE`)                                                     |
| `Dockerfile`     | Lives at the repo root; multi-stage build that produces the published image                                                         |
