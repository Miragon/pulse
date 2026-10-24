# Pulse starter

Build your own MCP server on the published `@miragon/pulse-*` modules of
[Pulse](https://github.com/Miragon/pulse) (Camunda 7 / CIB seven BPM operations
and Prometheus-backed process analytics, both with interactive widgets) and add
modules for your own systems.
`modules/mcp-notes` is a small example module that shows the whole pattern;
copying it is how you start yours.

Everything installs from the public npm registry, no credentials needed.

## Quickstart

Two ways to run it: from source while you develop, or as a container once you
deploy.

### 1. From source

Prerequisites: Node 22.22.2 or newer (`corepack enable` provides the pinned pnpm).

```bash
pnpm install
cp .env.example .env  # engine + Prometheus URLs; `pnpm dev` loads it
pnpm dev              # MCP endpoint on :8400/mcp, inspector on :8400/mcp/inspector
```

### 2. As a container

The image takes its config from the environment; it never reads `.env`.

```bash
pnpm install          # once, then commit pnpm-lock.yaml (the build uses --frozen-lockfile)
docker build -t my-mcp-server .
docker run -p 127.0.0.1:8400:8400 \
  -e CAMUNDA_BASE_URL=http://host.docker.internal:8410/engine-rest \
  -e CAMUNDA_ENGINE_FLAVOR=cibseven \
  -e PROMETHEUS_URL=http://host.docker.internal:8460 \
  my-mcp-server
```

Either way the MCP endpoint is `http://localhost:8400/mcp`. With `pnpm dev`,
open the inspector at `http://localhost:8400/mcp/inspector` and call
`notes_show_notes`: the example widget renders with no external systems (the
production entrypoint the image runs mounts no inspector).
The camunda7/analytics tools need a running engine and Prometheus; the
[Pulse playground](https://github.com/Miragon/pulse/tree/main/playground)
ships a ready-made Docker Compose stack whose URLs match `.env.example`.

## Connect an assistant

The server speaks streamable HTTP on `/mcp`. Tools work in every MCP host;
widgets render in hosts that support MCP Apps (the inspector is the local
render check).

**Claude Desktop:** its `claude_desktop_config.json` validates **stdio servers
only**, so a bare `"url"` entry is silently dropped. Bridge the HTTP endpoint
with [`mcp-remote`](https://www.npmjs.com/package/mcp-remote). Open Settings →
Developer → Edit Config
(macOS `~/Library/Application Support/Claude/claude_desktop_config.json`,
Windows `%APPDATA%\Claude\claude_desktop_config.json`), then restart the app:

```json
{
  "mcpServers": {
    "my-mcp-server": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://127.0.0.1:8400/mcp", "--transport", "http-only"]
    }
  }
}
```

Use `127.0.0.1` rather than `localhost`: Node may resolve the latter to IPv6
while the server listens on IPv4.

**Claude Code:** HTTP natively, no bridge:

```bash
claude mcp add --transport http my-mcp-server http://localhost:8400/mcp
```

**claude.ai (custom connector):** needs a deployed server reachable over the
public internet (Settings → Connectors → Add custom connector with your
`https://…/mcp` URL); localhost is not reachable from Anthropic's
infrastructure. To try a local build against a hosted assistant, tunnel it as
the `setup-server` skill shows.

## Built for AI-assisted development

Open this repo in Claude Code (or any agent that reads `CLAUDE.md`) and
describe what you want: the skills in `.claude/skills/` walk the agent
through the four common tasks step by step:

| Skill                  | For…                                                   |
| ---------------------- | ------------------------------------------------------ |
| `setup-server`         | configuring, running, branding, and deploying          |
| `create-module`        | building a connector module for your own API or system |
| `add-widget`           | adding an interactive widget to a module               |
| `add-settings-section` | per-user settings for your module                      |

Everything works the same when done by hand: `CLAUDE.md` is the compact
architecture reference, and the guard tests in `server/test/` catch the
classic wiring mistakes, the ones whose failure mode would otherwise be
silent (a widget rendering empty, unstyled, or not at all).

## Make it yours

1. Rename the `@acme` scope in `server/package.json`,
   `modules/mcp-notes/package.json`, and the imports (the Dockerfile selects
   packages by path, no edit there); then re-run `pnpm install` to refresh
   `pnpm-lock.yaml`.
2. Set your brand in `server/src/ui/brand.css`: it starts from the Miragon
   theme the toolkit ships, and you override role variables only (`--primary`,
   `--link`, `--focus`, `--accent`, the status tones, radii, fonts) for light
   and dark. The neutral surfaces, their text and `--border` are the host's:
   a host that sends its palette overrides them, so set them only for hosts
   that send none. `server/test/brand.test.ts` checks that the result stays
   readable.

## Layout

| Path                 | Contents                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------- |
| `server/`            | The composition root: module list (`src/setup.ts`), widget bundle (`src/ui/`), boot code |
| `server/test/`       | Guard tests: keep them, they cover your modules too                                      |
| `modules/mcp-notes/` | Example module: tools, an interactive widget, and its guard test                         |

## Adding your own module

```bash
cp -R modules/mcp-notes modules/mcp-<name>
```

Rename `notes` to your module name, put your API/SDK access behind the store
interface, and wire the module into the server: the `workspace:*` dependency
in `server/package.json`, the module list, the widget registry, and its
`definition` in the guard test. The `create-module` skill walks through every
step, and the guard tests fail loudly if a wiring step is missed.

## Configuration

[`.env.example`](.env.example) documents every variable this server reads;
copy it to `.env` (loaded by `pnpm dev` only; `pnpm start` and Docker take
their config from the environment). A variable under a watched prefix (`MCP_`,
`CAMUNDA_`, `PROMETHEUS_`, plus each module's own) that the server does not
read prints a warning at boot, so typos surface immediately.

Toolsets fail closed: without `MCP_OAUTH` camunda7 and analytics run
**read-only** without a `module:toolset` suffix (queries, widgets, analytics,
no writes; a module without toolsets, like notes, registers all its tools);
with it they run their standard toolset (camunda7 `operations`, analytics
`standard`). The boot log names the effective toolsets. `admin` is never
implied, and `camunda7_create_deployment` additionally needs
`CAMUNDA_ALLOW_DEPLOYMENTS=true` (deploying a BPMN runs code in the engine
JVM). See the `setup-server` skill before widening a server others can reach.

`MCP_OAUTH` (Keycloak or Auth0) is also the only caller identity: user settings
and saved dashboards belong to the signed-in user. Without it the settings
show their defaults and cannot be saved.

| Variable                                     | Effect                                                                                                                         |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `PORT`                                       | HTTP port (default 8400)                                                                                                       |
| `MCP_URL`                                    | Public base URL (behind a proxy/gateway), also the `Host`/`Origin` the server accepts and the origin the views load Geist from |
| `MCP_ALLOWED_HOSTS` / `MCP_ALLOWED_ORIGINS`  | Further hostnames / origins the server accepts (default: localhost-class and `MCP_URL`'s only)                                 |
| `MCP_MAX_BODY_BYTES`                         | Request-body cap (default 4 MiB; larger bodies get 413 before they are read)                                                   |
| `MCP_METRICS_TOKEN`                          | Bearer token `/metrics` requires (default: open)                                                                               |
| `MCP_OAUTH`                                  | OAuth resource server (`keycloak` / `auth0` JSON, needs `MCP_URL`), the only caller identity                                   |
| `MCP_ACTIVE_MODULES`                         | Modules (default: all), e.g. `camunda7:operations,notes`; no suffix: read-only, `MCP_OAUTH` → standard                         |
| `MCP_PROFILE_DIR`                            | Filesystem persistence for user profiles (default: in-memory)                                                                  |
| `MCP_DASHBOARD_DIR`                          | Filesystem persistence for saved dashboards, only used under `MCP_OAUTH` (see below)                                           |
| `CAMUNDA_*`, `PROMETHEUS_URL`, `NOTES_TITLE` | Module config, see `.env.example` for the full list                                                                            |

## Deploying

The image built in the [Quickstart](#2-as-a-container) is the deployment
artifact. Two things to add beyond the local run:

```bash
docker run -p 8400:8400 \
  -e MCP_URL=https://mcp.example.com \
  -e MCP_PROFILE_DIR=/data/profiles \
  -v mcp-data:/data \
  my-mcp-server
```

- `MCP_URL` is the public base URL when the server sits behind a proxy or MCP
  gateway; `PORT` changes the HTTP port. The server answers 403 to any `Host`
  (or browser `Origin`) that is not localhost-class, `MCP_URL`'s or listed in
  `MCP_ALLOWED_HOSTS`/`MCP_ALLOWED_ORIGINS` (DNS-rebinding protection), so a
  deployment reached under any other name must set them.
- Without `MCP_OAUTH` the server boots read-only and unauthenticated. Set
  `MCP_OAUTH` (plus `MCP_URL`, the token audience) to require sign-in, save
  per-user settings and raise the default toolsets. An authenticating gateway
  in front is invisible to the server: it still sees no identity, so settings
  stay unsaved and any widened toolset is open to whoever passes the gateway.
- The profile store is in-memory by default: without the volume, user
  settings are lost on every restart (a `NODE_ENV=production` boot warns about
  it in its log). Saved dashboards need more: the visual
  builder and its dashboard tools are registered only under `MCP_OAUTH` with no
  module on read-only (`frameworkWritesAllowed`).
- `/health/live`, `/health/ready` and `/metrics` (Prometheus) are served next
  to `/mcp`, outside any OAuth gate and the `Host` check (`MCP_METRICS_TOKEN`
  protects the scrape); the image's `HEALTHCHECK` polls `/health/ready`;
  point Kubernetes probes and a ServiceMonitor at them. On SIGTERM the server
  stops accepting and lets in-flight requests finish (readiness answers those
  503 `draining`); on Kubernetes add a `preStop` sleep so the endpoint is
  removed before new connections are refused.
- The views render in Geist and Geist Mono, served by the server itself
  under `/fonts/geist-<version>/` (woff2, cached immutable, no CDN) and
  admitted by every view's CSP (`resourceDomains`: `MCP_URL`'s origin, else
  the origin the host read the view from). The host's browser fetches them
  from that origin, so behind a gateway route `/fonts/` to the server too. A
  host that blocks the origin, or a browser that cannot reach it, shows the
  host's font instead; nothing waits for the files.

## Going further

The stock server (`apps/mcp-server-camunda7` in the
[Pulse repo](https://github.com/Miragon/pulse)) additionally ships,
and is the reference for: Postgres profile and dashboard stores for
multi-instance deployments, and a Playwright host simulation of the widget
bundle.
