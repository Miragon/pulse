---
name: setup-server
description: Set up, configure, run, brand, and deploy this composed MCP server. Use whenever connecting a Camunda 7 / CIB Seven engine or Prometheus, selecting modules or toolsets (`MCP_ACTIVE_MODULES`), configuring persistence, renaming the `@acme` scope, building the Docker image, running behind an MCP gateway, or troubleshooting boot warnings, empty analytics, or inspector issues.
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# setup-server: from clone to running (and deployed) server

Configuration ground rules first:

- **`.env` is a `pnpm dev` convenience only** (loaded via dotenv-cli).
  `pnpm start` and the Docker image take their config from the environment.
- **`.env.example` documents every variable this server reads**, with defaults:
  it is the configuration reference, kept honest by
  `server/test/env-example.test.ts`.
- The server **warns at boot about unknown env vars** under any watched prefix
  (`MCP_`, `CAMUNDA_`, `PROMETHEUS_`, plus each custom module's prefix); a
  boot warning means a typo or a var this build doesn't read, never noise.

## Step 1: install and first run

```bash
pnpm install    # needs Node >= 22.22.2 (enforced at install time)
cp .env.example .env
pnpm dev        # MCP endpoint on :8400/mcp, inspector on :8400/mcp/inspector
```

Verify before configuring anything: open `http://localhost:8400/mcp/inspector` and
call `notes_show_notes`: the example module needs no external infrastructure,
so a rendered notes widget proves server, widget bundle, and inspector work.
Then read the boot log: every warning there is actionable (unknown env var,
missing Prometheus URL, engine auth problems), and one info line
(`[acme-mcp] Toolsets — camunda7:read-only (default without OAuth), …`) states
what each module may do, read-only until you widen it or set `MCP_OAUTH`
(Step 3).

## Step 2: connect the engine and Prometheus

Edit `.env` (every field is documented inline in `.env.example`):

- `CAMUNDA_BASE_URL`: the engine REST endpoint.
- `CAMUNDA_ENGINE_ID`: **must match the `ENGINE_ID` the engine stamps onto its
  metrics.** Analytics reads only the configured engine ids, so the mismatch
  is silent: every analytics tool returns nothing for that engine and its
  health reads `unknown`.
- `CAMUNDA_ENGINE_FLAVOR`: the engine's vendor, `camunda7` (default), `cibseven` or `operaton`. It
  picks the cockpit-link routes and the product name the views show, so a CIB seven engine (the
  playground's) sets `cibseven`.
- `CAMUNDA_AUTH_TYPE`: `none | basic | bearer | passthrough`; `basic` needs
  `CAMUNDA_USERNAME`/`CAMUNDA_PASSWORD`, `bearer` needs `CAMUNDA_TOKEN` (both
  enforced at boot); `passthrough` forwards each MCP caller's own bearer token.
- `CAMUNDA_COCKPIT_URL`: set explicitly whenever the engine URL is not
  reachable from the user's browser (container hostname), otherwise "open in
  cockpit" links point nowhere.
- Multiple engines: `CAMUNDA_ENGINES_JSON` (or `CAMUNDA_ENGINES_FILE`) with
  per-engine `id`, `baseUrl`, optional `environment`, `flavor` (`cibseven |
operaton | camunda7`, default `camunda7`) and `auth`; overrides the single-engine shorthand
  above. To group engines by environment, either set `environment` per entry
  or write the JSON as a map keyed by environment id
  (`{"<environment>": [engines…]}`); pickers and `camunda7_list_engines`
  then group the engines by environment. Engine ids stay
  globally unique across environments.
- `PROMETHEUS_URL`: unset defaults to `http://localhost:9090`, which does
  **not** match the playground stack (host port 8460); every analytics query
  then fails. The server warns at boot when unset. A protected Prometheus takes
  `PROMETHEUS_BEARER_TOKEN` or `PROMETHEUS_USERNAME`/`PROMETHEUS_PASSWORD`
  (plus `PROMETHEUS_HEADERS`, a JSON object, e.g. for a tenant id).
- Analytics reads only the server's configured engines, camunda7's engine ids
  (a shared Prometheus never exposes other teams' engines). Without camunda7,
  name them in `ANALYTICS_ENGINE_IDS` (comma-separated `engine_id`s); with
  neither, every analytics tool refuses.
- `CAMUNDA_REQUEST_TIMEOUT_MS` / `PROMETHEUS_TIMEOUT_MS`: per-request
  deadlines (default 30000 ms); a hung upstream then fails the tool call with
  a timeout error instead of holding it.

No engine at hand? The
[Pulse playground](https://github.com/Miragon/pulse/tree/main/playground)
is a ready-made Docker Compose stack (engine + Prometheus + Grafana) whose
defaults match this template's `.env.example`.

## Step 3: select modules and toolsets

`MCP_ACTIVE_MODULES` is a comma list; unset or `all` activates every module.
Each module runs ONE toolset per boot, named by a `module:toolset` suffix:

```bash
MCP_ACTIVE_MODULES=camunda7:operations,analytics:standard,notes
```

- camunda7 supports `read-only | operations | admin`; analytics
  `read-only | standard` (`standard` adds the settings save).
- **Fail-closed default.** Without `MCP_OAUTH` a module without a suffix runs
  `read-only`; with it, its standard toolset (camunda7 `operations`, analytics
  `standard`). An empty (`camunda7:`) or unknown suffix warns and falls back to
  `read-only`; `admin` (delete/modify, migrations, signals, the external-task
  worker protocol) is only ever reached by naming it. Check the boot log's
  `Toolsets —` line after every change.
- `camunda7_create_deployment` additionally needs `CAMUNDA_ALLOW_DEPLOYMENTS=true`
  next to `camunda7:admin`: deploying a BPMN/DMN runs code inside the engine
  JVM (JUEL expressions, scripts). Strict `true`/`false` (empty = unset); junk fails the boot.
- Widening is a security decision: without `MCP_OAUTH` the server listens on
  all interfaces with no auth, so write toolsets are open to anyone who
  reaches the port. Behind an authenticating gateway the server still sees no
  identity, which is exactly why the suffix must stay explicit there, and why
  settings cannot be saved there: identity reaches the server only through
  `MCP_OAUTH`.
- Unknown module names warn and are skipped; a suffix on a module without
  toolsets (e.g. `notes:read-only`) warns and is ignored; that module
  registers all its tools.
- All widgets stay in the one Vite bundle regardless; inactive modules just
  register no tools. Module selection is runtime-only; there is no per-module
  bundle.

### OAuth: sign-in and per-user settings

```bash
MCP_URL=https://mcp.example.com     # the token audience (RFC 8707) — required with OAuth
MCP_OAUTH={"provider":"keycloak","serverUrl":"https://kc.example.com","realm":"platform"}
# or: MCP_OAUTH={"provider":"auth0","domain":"tenant.eu.auth0.com"}
```

`server/src/app.ts` wires it through `oauthFromEnv`
(`@miragon/pulse-widget-shell/server`), the same helper the stock server uses.
`/mcp` then answers 401 without a valid bearer token, the default toolsets rise
to `operations`/`standard`, and every settings save (`shell_save_settings` for
the language, `camunda7_save_settings`, `analytics_save_settings`,
`camunda7_select_engine`, your own module's save tool) persists under the
signed-in user. Without `MCP_OAUTH` there is no caller
identity: settings render their defaults and every save refuses. A bad
`MCP_OAUTH` (invalid JSON, unknown provider or key, stray `MCP_USE_OAUTH_*`
vars) fails the boot.

## Step 4: persistence

Both stores default to **in-memory**: everything is lost on restart. For real
deployments point them at directories (mounted volumes in Docker):

```bash
MCP_PROFILE_DIR=./.data/profiles       # per-user settings (language, module slices) — filled under MCP_OAUTH
MCP_DASHBOARD_DIR=./.data/dashboards   # saved builder dashboards — only under MCP_OAUTH (builder is off without it)
```

Postgres stores are deliberately trimmed from this template; the stock server
(`apps/mcp-server-camunda7` in the
[Pulse repo](https://github.com/Miragon/pulse)) is the reference
(README, "Going further").

## Step 5: make it yours

Renaming the placeholder scope touches a fixed set of places. Do all of them,
then reinstall so the lockfile matches:

1. `@acme/composed-mcp-server` in `server/package.json` (the `Dockerfile`
   selects packages by path, no edit there)
2. `@acme/mcp-notes` in `modules/mcp-notes/package.json`, in
   `server/package.json`'s dependencies, and in every import
   (`server/src/setup.ts`, `server/src/ui/widget-registry.ts`,
   `server/test/widget-registry.test.ts`)
3. the `acme-mcp` labels in `server/src/app.ts` and `setup.ts`
4. `pnpm install` to refresh `pnpm-lock.yaml` (the Docker build uses
   `--frozen-lockfile`)

Branding: `server/src/ui/brand.css` imports the toolkit's Miragon theme (the
default) and has one override block for light and one for dark. Set ROLE
variables there only (`--primary`, `--primary-hover`, `--link`, `--focus`,
`--ring`, `--accent`/`--accent-foreground`, `--input`, `--<tone>`/`-soft`/
`-ink`, radii, shadows, `--font-sans`) in BOTH blocks (the host's dark mode
matches `:root` too). Miragon blue also sits in `--info`, `--chart-1/-3` and
`--sidebar-*`; set those too for a single brand. The neutrals (surfaces, the
text on them, `--border`) are the host's: a host that sends SEP-1865 style
variables writes them inline on `<html>`, so a value set in brand.css shows
only where the host sends none. Check your colours against a light and a
dark host surface. Never set the `--cd-*` tokens, never colour a widget with
palette classes. `server/test/brand.test.ts` measures the role and tone
pairs (text and each `-foreground` on its fill 4.5:1, edges, dots, icons and
the focus ring 3:1) in light and dark over the Miragon neutrals; charts, the
sidebar, radii, shadows and fonts it does not measure. The widgets follow the
host's theme; there is no theme switch in the app.

## Step 6: Docker and production

```bash
pnpm install                    # once, then COMMIT pnpm-lock.yaml
docker build -t my-mcp-server .
docker run -p 127.0.0.1:8400:8400 \
  -e CAMUNDA_BASE_URL=http://host.docker.internal:8410/engine-rest \
  -e CAMUNDA_ENGINE_FLAVOR=cibseven \
  -e MCP_PROFILE_DIR=/data/profiles -v mcp-data:/data \
  my-mcp-server
```

- Config comes from the environment; the image does not read `.env`.
- `PORT` sets the HTTP port (default 8400); `MCP_URL` is the public base URL
  when running behind a proxy or MCP gateway and, with
  `MCP_ALLOWED_HOSTS`/`MCP_ALLOWED_ORIGINS`, the only non-localhost
  `Host`/`Origin` the server accepts: anything else gets 403 (DNS-rebinding
  protection), with the message naming the variable to set. It is also the
  origin the views load Geist from (the server's own `/fonts/geist-<version>/`
  route, declared in every view's CSP `resourceDomains`): behind a gateway,
  route `/fonts/` to the server too, or the views show the host's font.
- Federation/aggregation across MCP servers belongs in an external gateway
  (e.g. agentgateway) IN FRONT of this server; this repo builds one
  self-contained server; don't add upstream/proxy mechanics to it.

## Step 7: connect an assistant

The server speaks streamable HTTP on `/mcp`; how a host gets there differs per
host.

**Claude Desktop** takes stdio servers ONLY: its `claude_desktop_config.json`
validates the `command`/`args` shape, and a `"url"` entry is dropped silently
(older builds crashed at startup instead). Bridge the HTTP endpoint with
`mcp-remote`, via Settings → Developer → Edit Config
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

`127.0.0.1` over `localhost`: Node may resolve the name to IPv6 while the
server listens on IPv4. Connection problems show up in the host's MCP logs:
`~/Library/Logs/Claude/mcp*.log` (Windows: `%APPDATA%\Claude\logs`).

**Claude Code** speaks HTTP natively, no bridge:

```bash
claude mcp add --transport http my-mcp-server http://localhost:8400/mcp
```

**claude.ai / ChatGPT custom connectors** need a server reachable over the
public internet (an `https://…/mcp` URL), so a deployment, not localhost. For
a throwaway test of a local build, `--tunnel` exposes it publicly. Run it
through dotenv from the repo root: `mcp-use dev` only reads a `.env` next to
itself (`server/.env`), never this repo's root one, so a bare
`mcp-use dev --tunnel` in `server/` tunnels a server with no engine or
Prometheus configured:

```bash
pnpm exec dotenv -e .env -- pnpm --filter ./server exec mcp-use dev --tunnel --no-open
```

Under `mcp-use dev` the CLI checks `Host` itself and admits its tunnel host,
so the tunnel needs no `MCP_ALLOWED_HOSTS` (browser `Origin`s are still
checked). A built server (`pnpm start`, the image) behind a tunnel or proxy
needs `MCP_URL` set to the public URL, else every call gets 403.

## Step 8: verify

```bash
pnpm build && pnpm typecheck && pnpm test
```

Then a functional pass in the inspector: `camunda7_list_engines` (engines
configured), one cheap read such as `camunda7_list_process_definitions` (engine
reachable, auth works), one `camunda7_show_*` widget, one analytics tool (Prometheus
reachable, `engine_id` matches). A clean boot log (no unknown-var or
missing-URL warnings) is part of done.

## Troubleshooting

| Symptom                                   | Cause                                                                                                                                                                                                              |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Every in-widget query hangs on "Loading…" | `resolve.dedupe` in `server/vite.config.ts` was trimmed, or a second copy of React/toolkit/mcp-use got installed                                                                                                   |
| Widgets render unstyled                   | widget sources outside the Tailwind scan set (workspace modules are globbed; npm-installed ones need an `@source` in `server/src/ui/globals.css`)                                                                  |
| Analytics tools return empty results      | `CAMUNDA_ENGINE_ID` doesn't match the engine's metrics `ENGINE_ID`, or `PROMETHEUS_URL` points at the wrong port                                                                                                   |
| Cockpit links open the wrong web app      | the engine's vendor: without `CAMUNDA_ENGINE_FLAVOR` (or a `flavor` per engine entry) it counts as Camunda 7                                                                                                       |
| "Unknown environment variable" at boot    | typo, or a var this build doesn't read; `.env.example` is the authoritative list                                                                                                                                   |
| Widget UI changes don't show up           | the bundle is read once at boot; restart `pnpm dev` at the repo root (it rebuilds modules + bundle on start)                                                                                                       |
| A tool is missing                         | module not in `MCP_ACTIVE_MODULES`, or its toolset filtered it; with no suffix and no `MCP_OAUTH` it is `read-only` (see the boot log's `Toolsets —` line); deployments also need `CAMUNDA_ALLOW_DEPLOYMENTS=true` |
| Claude Desktop shows no tools at all      | a `"url"` entry in `claude_desktop_config.json` (stdio only, use the `mcp-remote` bridge from Step 7), or the app wasn't restarted                                                                                 |
