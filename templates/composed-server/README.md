# Pulse starter

> [!IMPORTANT]
> Pulse is below 1.0.0, so the API of the `@miragon/pulse-*` packages is not
> stable and can change in any release. The
> [changelog](https://github.com/Miragon/pulse/blob/main/CHANGELOG.md) lists
> every breaking change. The `dependencies` and `devDependencies` of this starter
> pin all of them to one exact version (a module's peer ranges resolve to the
> server's copy): keep it that way and update them together.

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

Prerequisites:

- Node.js 22 from 22.23.4, 24 from 24.22.1, or 26.12.1 and later (`engines` in `package.json`, the
  range the MCP Inspector `pnpm dev` starts asks for)
- pnpm 10.32.1 (`packageManager`): `corepack enable`; Node.js 25+ has none: `npm i -g pnpm@10.32.1`
- Docker, for the engine in `compose.yaml` (optional)

```bash
pnpm install
cp .env.example .env  # the settings of the engine in compose.yaml; `pnpm dev` loads it
pnpm dev              # MCP endpoint on :8400/mcp, plus the MCP Inspector (it prints its URL)
```

No engine yet? `docker compose up -d`, then `pnpm dev`. The
[`compose.yaml`](compose.yaml) starts a CIB seven engine on `localhost:8410`
with its invoice example (login `demo`/`demo`), the engine the copied `.env`
points at. It serves the engine tools only, so the copied `.env` leaves
analytics off (`MCP_ACTIVE_MODULES=engine,notes`): that engine has no Prometheus
to read. Analytics needs a Prometheus that holds your engines' metrics (the
engine plugin `io.miragon.mcp:cibseven-history-metrics`); the
[Pulse playground](https://github.com/Miragon/pulse/tree/main/playground) runs
none either.

For your own engine set `ENGINE_BASE_URL`, `ENGINE_FLAVOR`,
`ENGINE_AUTH_TYPE` with its credentials, and `ENGINE_ID` to an id of yours
(with metrics, the `engine_id` they carry); with a Prometheus also
`PROMETHEUS_URL` and `analytics` in `MCP_ACTIVE_MODULES`. `.env.example`
explains each.

The server's own log lines start with `[acme-mcp]`, and a warning among them
names what to fix. `pnpm dev` runs three processes next to each other: Vite
rebuilding the widget bundle (`vite build --watch`), the server (`tsx watch`,
which restarts it when its code or the bundle changes) and the official
[MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector) on
`127.0.0.1`, already pointed at the server. The inspector opens no browser:
open the URL it prints, with its per-launch token. Their output interleaves;
the Vite build lines are expected.

### 2. As a container

The image takes its config from the environment; it never reads `.env`
itself. `--env-file` hands it over as plain `KEY=VALUE` lines (docker keeps
quotes and trailing comments in the value), and the `-e` flags after it win:

```bash
pnpm install          # commit pnpm-lock.yaml if it changed (the build uses --frozen-lockfile)
[ -f .env ] || cp .env.example .env   # step 1's .env, or the settings of compose.yaml's engine
docker build -t my-mcp-server .
docker compose up -d --wait           # compose.yaml's engine, on the network pulse-starter_default
docker run --rm --env-file .env -p 127.0.0.1:8400:8400 \
  --network pulse-starter_default \
  -e ENGINE_BASE_URL=http://engine:8080/engine-rest \
  -e ENGINE_COCKPIT_URL=http://localhost:8410/webapp \
  my-mcp-server
```

The Pulse playground's engine instead (`pnpm stack:up` there), seeded with
demo data:

```bash
docker run --rm --env-file .env -p 127.0.0.1:8400:8400 \
  --network pulse_default \
  -e ENGINE_BASE_URL=http://cibseven:8410/engine-rest -e ENGINE_ID=prod-a \
  -e ENGINE_COCKPIT_URL=http://localhost:8410/webapp \
  my-mcp-server
```

Ctrl-C stops the server and `--rm` removes its container; `docker compose down`
removes compose.yaml's engine, `pnpm stack:down` in your Pulse clone the
playground.

Inside the container `localhost` is the container itself, so the server joins
the engine's Docker network and reaches it by its service name and port:
`pulse-starter_default` is the network of compose.yaml (its `name:` fixes
it), `pulse_default` the playground's. That works alike on Linux, macOS and
Windows; `host.docker.internal` does not, since on Linux it misses a port
published on `127.0.0.1`, where both engines publish theirs. The "open in
cockpit" links open in your browser and stay on `localhost`, and
`-p 127.0.0.1:8400:8400` keeps the server on your machine. For an engine of
your own that the container reaches by its address, drop `--network` and set
`ENGINE_BASE_URL` to that address.

Either way the MCP endpoint is `http://localhost:8400/mcp`. With `pnpm dev`,
open the inspector's URL and render `notes_show_notes` in its Apps tab: the
example widget renders with no external systems. The image runs no inspector;
for a container, start one yourself
(`npx @modelcontextprotocol/inspector --server-url http://127.0.0.1:8400/mcp --transport http`).
The engine tools need a running engine (`docker compose up -d`, above), the
analytics tools a Prometheus with your engines' metrics and `analytics` in
`MCP_ACTIVE_MODULES`.

## Develop

```bash
pnpm build && pnpm typecheck && pnpm test   # the bar for every change
pnpm format:check                           # Prettier, the style in .prettierrc.json (pnpm format applies it)
```

- The root `pnpm dev` builds the modules once, when it starts. A widget edit
  rebuilds the bundle and restarts the server by itself; after editing a
  module's tools, stop `pnpm dev` and start it again. Reopen a view in the
  inspector to see the new bundle.
- `pnpm typecheck` is the only check that type-checks widget `.tsx` code.
- If port 8400 is taken, the server does not start and says so
  (`listen EADDRINUSE`): stop what holds it (the stock Pulse image, say) or
  set `PORT` in `.env`. An assistant pointed at 8400 talks to whatever holds
  that port and shows its tools without yours.

## Connect an assistant

The server speaks streamable HTTP on `/mcp`. Tools work in every MCP host;
widgets render in hosts that support MCP Apps (the inspector is the local
render check; it has no chat, so a hand-off to the chat does nothing there).

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
infrastructure. To try a local build against a hosted assistant, tunnel it
(`cloudflared tunnel --url http://localhost:8400`) and set `MCP_URL` to the
`https://` origin the tunnel prints, as the `setup-server` skill shows.

## Built for AI-assisted development

Open this repo in Claude Code (or any agent that reads `CLAUDE.md`) and
describe what you want: the skills in `.claude/skills/` walk the agent
through the three common tasks step by step:

| Skill           | For…                                                   |
| --------------- | ------------------------------------------------------ |
| `setup-server`  | configuring, running, branding, and deploying          |
| `create-module` | building a connector module for your own API or system |
| `add-widget`    | adding an interactive widget to a module               |

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
   theme `@miragon/pulse-ui` ships, and you override role variables only (`--primary`,
   `--link`, `--focus`, `--accent`, the status tones, radii, fonts) for light
   and dark. The neutral surfaces, their text and `--border` are the host's:
   a host that sends its palette overrides them, so set them only for hosts
   that send none. `server/test/brand.test.ts` checks that the result stays
   readable.
3. Name the server: `SERVER_INFO` in `server/src/app.ts` holds the `name`
   and `title` it reports to every MCP client. Clients such as the inspector
   show the title, and the server's own log lines start with `[<name>]`.

## Layout

| Path                 | Contents                                                                                        |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| `server/`            | The composition root: module list (`src/setup.ts`), widget bundle (`src/ui/`), boot code        |
| `server/test/`       | Guard tests: keep them, they follow your modules; `example-notes.test.ts` goes with the example |
| `modules/mcp-notes/` | Example module: tools, an interactive widget, its module test and its widget test               |

## Adding your own module

```bash
cp -R modules/mcp-notes modules/mcp-<name>
```

Rename `notes` to your module name, put your API/SDK access behind the store
interface, and wire the module into the server: the `workspace:*` dependency
in `server/package.json`, the module list, the view registry and
`MCP_ACTIVE_MODULES` in `.env.example` and your `.env`. A module that variable
does not name stays off and its tools are absent, whatever the module list
holds (the boot log's `Toolsets:` line shows what runs), and a name it still
holds after you remove a module fails the boot. The
`create-module` skill walks through every step, and the guard tests fail
loudly if a wiring step is missed (except in your `.env`, which nothing checks:
the boot log's `Toolsets:` line shows what runs). They derive what they check
from the module list, so a module you add, replace or drop needs no edit to the
guard tests; only `example-notes.test.ts` goes with the example. Once your own
module stands, remove the example: the skill's "Remove the example module"
lists each place.

A widget takes its UI from the design kit `@miragon/pulse-ui` (primitives,
`WidgetHeader`, `KpiGrid`, the table cells, the formatters, the theme) and
reaches the host through the view runtime `@miragon/pulse-widget-shell/widgets`
(`useViewData`, `ListTable`, `QueryFallback`, `TestViewHost` for tests).
`modules/mcp-notes/src/widgets/notes-list.tsx` shows both imports.

## Configuration

[`.env.example`](.env.example) documents every variable this server reads;
copy it to `.env` (loaded by `pnpm dev` only; `pnpm start` and Docker take
their config from the environment). A variable under a watched prefix (`MCP_`,
`ENGINE_`, `ENGINES_`, `PROMETHEUS_`, plus each module's own) that the server does not
read prints a warning at boot, so typos surface immediately.

Toolsets fail closed: without OAuth and without a `module:toolset` suffix the
engine module runs **read-only** (queries and widgets, no writes); with OAuth
it runs its standard toolset, `operations`. The boot
log names the effective toolsets. `admin` is never
implied, and `engine_create_deployment` additionally needs
`ENGINE_ALLOW_DEPLOYMENTS=true` (deploying a BPMN runs code in the engine
JVM). See the `setup-server` skill before widening a server others can reach.

A module without toolsets, like notes or analytics, registers all its tools
whenever it runs. Give your module toolsets as soon as it registers a tool without
`readOnlyHint: true` and the server may run without OAuth (the
`create-module` skill, Step 5). Until then a boot without OAuth
warns once per such tool, naming it and its module: anyone who reaches the
port can call it.

OAuth comes from one provider's `MCP_OAUTH_*` variables (the providers and
what fails the boot: `.env.example`): the server verifies bearer tokens as an
OAuth resource server and never issues them. It is also the only caller
identity: passthrough engine auth and the per-caller caches key on it.

| Variable                                    | Effect                                                                                                                                                                                           |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PORT` / `HOST`                             | HTTP port (default 8400) and bind address (default `0.0.0.0`, every interface; `pnpm dev` binds `127.0.0.1`)                                                                                     |
| `MCP_URL`                                   | Public base URL (behind a proxy/gateway), also the `Host`/`Origin` the server accepts and the origin the views load Geist from                                                                   |
| `MCP_ALLOWED_HOSTS` / `MCP_ALLOWED_ORIGINS` | Further hostnames / origins the server accepts (default: localhost-class and `MCP_URL`'s only)                                                                                                   |
| `MCP_MAX_BODY_BYTES`                        | Request-body cap (default 4 MiB; larger bodies get 413 before they are read)                                                                                                                     |
| `MCP_METRICS_TOKEN`                         | Bearer token `/metrics` requires (default: open)                                                                                                                                                 |
| `MCP_OAUTH_*`                               | One OAuth provider's variables (see `.env.example`), needs `MCP_URL`, the only caller identity                                                                                                   |
| `MCP_ACTIVE_MODULES`                        | Modules (default: all; the copied `.env`: `engine,notes`; one it does not name stays off), e.g. `engine:operations,notes`; no suffix: read-only floor, OAuth → standard; no toolsets: every tool |
| `ENGINE_*`, `PROMETHEUS_URL`, `NOTES_TITLE` | Module config, see `.env.example` for the full list                                                                                                                                              |

## Deploying

The image built in the [Quickstart](#2-as-a-container) is the deployment
artifact. One thing to add beyond the local run:

```bash
docker run --rm -p 8400:8400 \
  -e MCP_URL=https://mcp.example.com \
  my-mcp-server
```

- No `.env` reaches this image, so `MCP_ACTIVE_MODULES` is unset and every
  module runs, analytics included: name the modules you want.
- `MCP_URL` is the public base URL when the server sits behind a proxy or MCP
  gateway; `PORT` changes the HTTP port. The server answers 403 to any `Host`
  (or browser `Origin`) that is not localhost-class, `MCP_URL`'s or listed in
  `MCP_ALLOWED_HOSTS`/`MCP_ALLOWED_ORIGINS` (DNS-rebinding protection), so a
  deployment reached under any other name must set them.
- Without OAuth the server boots unauthenticated: a module with toolsets runs
  its read-only floor, a module without toolsets every tool it has. Set one
  provider's `MCP_OAUTH_*` variables (plus `MCP_URL`) to require sign-in
  and raise the default toolsets. An authenticating gateway
  in front is invisible to the server: it still sees no identity, so any
  widened toolset is open to whoever passes the gateway.
- With OAuth, tokens must carry `<MCP_URL>/mcp` in `aud`
  (`https://mcp.example.com/mcp` here; `MCP_URL` is then an origin without a
  path) and a `sub` claim, else every call gets 401; the boot logs the
  audience it expects. The
  [identity provider checklist](https://miragon.github.io/pulse/mcp/operations#identity-provider-checklist)
  covers the audience, `sub`, client registration with the claude.ai callback
  and how to read a 401.
- `/health/live`, `/health/ready` and `/metrics` (Prometheus) are served next
  to `/mcp`, outside any OAuth gate and the `Host` check (`MCP_METRICS_TOKEN`
  protects the scrape); the image's `HEALTHCHECK` polls `/health/ready`;
  point Kubernetes probes and a ServiceMonitor at them. On SIGTERM the server
  stops accepting and lets in-flight requests finish (readiness answers those
  503 `draining`); on Kubernetes add a `preStop` sleep so the endpoint is
  removed before new connections are refused.
- The views render in Geist and Geist Mono, served by the server itself
  under `/fonts/geist-<version>/` (woff2, cached immutable, no CDN) and
  admitted by every bundle view's CSP (`resourceDomains`: `MCP_URL`'s origin, else
  the origin the host read the view from). The host's browser fetches them
  from that origin, so behind a gateway route `/fonts/` to the server too. A
  host that blocks the origin, or a browser that cannot reach it, shows the
  host's font instead; nothing waits for the files.

## Going further

The stock server (`apps/mcp-server` in the
[Pulse repo](https://github.com/Miragon/pulse)) additionally ships a
Playwright host simulation of the widget bundle.
