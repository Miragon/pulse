---
name: setup-server
description: Set up, configure, run, brand, and deploy this composed MCP server. Use whenever connecting a Camunda 7 / CIB seven engine, selecting modules or toolsets (`MCP_ACTIVE_MODULES`), renaming the `@acme` scope, building the Docker image, running behind an MCP gateway, or troubleshooting boot warnings or inspector issues.
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
  (`MCP_`, `ENGINE_`, `ENGINES_`, plus each custom module's prefix); a
  boot warning means a typo or a var this build doesn't read, never noise.

## Step 1: install and first run

```bash
corepack enable # pnpm 10.32.1 (`packageManager`); Node.js 25+ has none: npm i -g pnpm@10.32.1
pnpm install    # needs Node ^22.23.4, ^24.22.1 or >= 26.12.1 (enforced at install time)
cp .env.example .env
pnpm dev        # MCP endpoint on :8400/mcp, plus the MCP Inspector (it prints its URL)
```

`pnpm dev` runs Vite rebuilding the widget bundle, the server (`tsx watch`) and
the official MCP Inspector on `127.0.0.1`, pointed at the server; it opens no
browser. Verify before configuring anything: open the URL the inspector
prints (it carries a per-launch token) and render `notes_show_notes` in its
Apps tab: the example module needs no external infrastructure, so a rendered
notes widget proves server, widget bundle, and inspector work.
If the server logs `listen EADDRINUSE`, another server holds 8400 (see
Troubleshooting): free it, or set `PORT` in `.env` and restart.
Then read the boot log. The Vite build output and the inspector's lines are
expected. The server's own
lines start with `[acme-mcp]` (the `name` in
`server/src/app.ts`): every warning among them is actionable (unknown env var, no engine
configured, engine auth problems), and one info line
(`[acme-mcp] Toolsets: engine:read-only (default without OAuth), …`) states
what each module may do: one with toolsets is read-only until you widen it
or set up OAuth (Step 3), one shown as `(no toolsets)` registers every tool.
A module the line names after `left off by MCP_ACTIVE_MODULES` is off: the
copied `.env` runs `engine,notes` (Step 3).

## Step 2: connect the engine

No engine at hand? Start the one in `compose.yaml`; the copied `.env` already
points at it (`http://localhost:8410/engine-rest`, `cibseven`, basic auth
`demo`/`demo`):

```bash
docker compose up -d --wait   # CIB seven with its invoice example, healthy once its REST API answers
pnpm dev
```

Then `engine_list_process_definitions` lists `invoice` and `ReviewInvoice`.

Every engine call answers 401 although `.env` says `demo`/`demo`? Wrong
passwords lock `demo` out of that engine, for good after ten, and `demo` is
its only admin: `docker compose down && docker compose up -d` resets it.

For your own engine, edit `.env` (every field is documented inline in `.env.example`):

- `ENGINE_BASE_URL`: the engine REST endpoint.
- `ENGINE_ID`: the engine's id (default `default`): the `engine` value of every
  tool call, the name the cockpit shows and the id the hand-offs name.
- `ENGINE_FLAVOR`: the engine's vendor, `camunda7` (default), `cibseven` or `operaton`. It
  picks the cockpit-link routes and the product name the views show, so a CIB seven engine (the
  one in `compose.yaml`, the playground's) sets `cibseven`.
- `ENGINE_AUTH_TYPE`: `none | basic | bearer | passthrough`; `basic` needs
  `ENGINE_USERNAME`/`ENGINE_PASSWORD`, `bearer` needs `ENGINE_TOKEN` (both
  enforced at boot); `passthrough` forwards each MCP caller's own bearer token.
- `ENGINE_COCKPIT_URL`: set explicitly whenever the engine URL is not
  reachable from the user's browser (container hostname), otherwise "open in
  cockpit" links point nowhere.
- Multiple engines: `ENGINES_JSON` (or `ENGINES_FILE`) with
  per-engine `id`, `baseUrl`, optional `environment`, `flavor` (`cibseven |
operaton | camunda7`, default `camunda7`) and `auth`; overrides the single-engine shorthand
  above. To group engines by environment, either set `environment` per entry
  or write the JSON as a map keyed by environment id
  (`{"<environment>": [engines…]}`); pickers and `engine_list_engines`
  then group the engines by environment. Engine ids stay
  globally unique across environments. A call without `engine` routes to
  `ENGINE_DEFAULT` (it must name a configured engine, else the boot
  fails); without one it fails with `ENGINE_NOT_SELECTED` listing the engines.
- `ENGINE_REQUEST_TIMEOUT_MS`: the per-request deadline (default 30000 ms); a
  hung engine then fails the tool call with a timeout error instead of
  holding it.

## Step 3: select modules and toolsets

`MCP_ACTIVE_MODULES` is a comma list; unset or `all` activates every module, and
a module the list does not name stays off. The copied `.env` sets `engine,notes`,
so a module you add goes into the list, in `.env.example` and in your `.env`.
A module with toolsets runs ONE of them per boot, named by a `module:toolset` suffix:

```bash
MCP_ACTIVE_MODULES=engine:operations,notes
```

- The engine module supports `read-only | operations | admin`; notes declares
  none, so a suffix on it is ignored with a warning.
- **Fail-closed default.** Without OAuth a module without a suffix runs
  `read-only`; with it, its standard toolset (engine `operations`). An empty (`engine:`) or unknown suffix warns and falls back to
  `read-only`; `admin` (delete/modify, migrations, signals, the external-task
  worker protocol) is only ever reached by naming it. Check the boot log's
  `Toolsets:` line after every change.
- `engine_create_deployment` additionally needs `ENGINE_ALLOW_DEPLOYMENTS=true`
  next to `engine:admin`: deploying a BPMN/DMN runs code inside the engine
  JVM (JUEL expressions, scripts). Strict `true`/`false` (empty = unset); junk fails the boot.
- Widening is a security decision: without OAuth the server listens on
  all interfaces with no auth, so write toolsets are open to anyone who
  reaches the port. Behind an authenticating gateway the server still sees no
  identity, which is exactly why the suffix must stay explicit there: identity
  reaches the server only through its own OAuth.
- An unknown module name fails the boot, listing the modules; a suffix on a module without
  toolsets (e.g. `notes:read-only`) warns and is ignored; that module
  registers all its tools.
- All widgets stay in the one Vite bundle regardless; inactive modules just
  register no tools. Module selection is runtime-only; there is no per-module
  bundle.

### OAuth: sign-in and caller identity

The boot reads one provider's `MCP_OAUTH_*` variables; set those of ONE provider. The OAuth block
of `.env.example` lists the providers, their variables and what fails the boot. Keycloak, say:

```bash
MCP_URL=https://mcp.example.com     # the public origin, no path; required with OAuth
MCP_OAUTH_KEYCLOAK_SERVER_URL=https://kc.example.com
MCP_OAUTH_KEYCLOAK_REALM=platform
```

`/mcp` then answers 401 without a valid bearer token (the server is an OAuth
resource server: it verifies tokens against the provider, never issues them)
and the default engine toolset rises to `operations`. Without a provider there is no caller identity. A
provider config the boot cannot honor fails the boot, naming the variables.

The token audience is NOT `MCP_URL` itself: the server accepts a token whose
`aud` (a string, or an array of strings only) holds `<MCP_URL>/mcp` (`https://mcp.example.com/mcp` above, the
`resource` that `/.well-known/oauth-protected-resource/mcp` advertises) and
that carries `sub`; the boot logs the value
(`[acme-mcp] OAuth: tokens must carry aud https://mcp.example.com/mcp …`). The
IdP side (audience mapper, `sub`, client registration with the claude.ai
callback `https://claude.ai/api/mcp/auth_callback`, reading a 401) is the
[identity provider checklist](https://miragon.github.io/pulse/mcp/operations#identity-provider-checklist).
A 401's `WWW-Authenticate` header names an audience mismatch;
`MCP_OAUTH_DEBUG=1` logs why the signature, issuer, `sub` or `exp` check
failed, never the token.

## Step 4: make it yours

Renaming the placeholder scope touches a fixed set of places. Do all of them,
then reinstall so the lockfile matches:

1. `@acme/composed-mcp-server` in `server/package.json` (the `Dockerfile`
   selects packages by path, no edit there)
2. `@acme/mcp-notes` in `modules/mcp-notes/package.json`, in
   `server/package.json`'s dependencies, and in every import
   (`server/src/setup.ts`, `server/src/ui/view-registry.ts`)
3. the server's `name` and `title` in `SERVER_INFO` (`server/src/app.ts`):
   clients such as the inspector show the title, the server's own log lines
   start with `[<name>]`, and the tests read both from there
4. `pnpm install` to refresh `pnpm-lock.yaml` (the Docker build uses
   `--frozen-lockfile`)

Branding: `server/src/ui/brand.css` imports pulse-ui's Miragon theme (the
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

## Step 5: Docker and production

```bash
pnpm install                    # commit pnpm-lock.yaml if it changed
docker build -t my-mcp-server .
docker compose up -d --wait     # compose.yaml's engine, on the network pulse-starter_default
docker run --rm --env-file .env -p 127.0.0.1:8400:8400 \
  --network pulse-starter_default \
  -e ENGINE_BASE_URL=http://engine:8080/engine-rest \
  -e ENGINE_COCKPIT_URL=http://localhost:8410/webapp \
  my-mcp-server
```

- Config comes from the environment; the image does not read `.env` itself.
  `--env-file` hands it over (so `MCP_ACTIVE_MODULES`, `ENGINE_ID`, `ENGINE_FLAVOR`
  and the engine auth match the local run), and the `-e` flags after it win. Unlike dotenv it
  reads plain `KEY=VALUE` lines: quotes and a trailing `# comment` stay in the
  value. A dev-only `PORT` or `MCP_URL` in `.env` comes along too (a `PORT`
  other than 8400 misses `-p …:8400:8400`): drop it or override it with `-e`.
- Inside the container `localhost` is the container, so the server joins the
  engine's Docker network and reaches it by its service name and port:
  `engine:8080` on `pulse-starter_default`, the network the `name:` in
  `compose.yaml` fixes. For the Pulse playground's engine, join
  `pulse_default` instead with `-e ENGINE_BASE_URL=http://cibseven:8410/engine-rest`
  and `-e ENGINE_ID=prod-a`. That works alike on Linux and
  under Docker Desktop; `host.docker.internal` does not: on Linux it is the
  Docker bridge's gateway, which misses a port published on `127.0.0.1`, where
  both engines publish theirs. An engine the container reaches by its address
  needs no `--network`, only its URL in `ENGINE_BASE_URL`.
- `ENGINE_COCKPIT_URL` stays on `localhost`: the user's browser opens those
  links. Without it the cockpit links derive from the engine URL and point at
  `engine:8080`, which a browser on the host does not resolve.
  `-p 127.0.0.1:8400:8400` publishes the server on the host's loopback only.
- `PORT` sets the HTTP port (default 8400); `MCP_URL` is the public base URL
  when running behind a proxy or MCP gateway and, with
  `MCP_ALLOWED_HOSTS`/`MCP_ALLOWED_ORIGINS`, the only non-localhost
  `Host`/`Origin` the server accepts: anything else gets 403 (DNS-rebinding
  protection), with the message naming the variable to set. It is also the
  origin the views load Geist from (the server's own `/fonts/geist-<version>/`
  route, declared in every bundle view's CSP `resourceDomains`): behind a gateway,
  route `/fonts/` to the server too, or the views show the host's font.
- Federation/aggregation across MCP servers belongs in an external gateway
  (e.g. agentgateway) IN FRONT of this server; this repo builds one
  self-contained server; don't add upstream/proxy mechanics to it.

## Step 6: connect an assistant

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
a throwaway test of a local build, and for what the inspector cannot show (a
hand-off to the chat, the context a view hands the model, the host's locale),
tunnel the running `pnpm dev` with Cloudflare's
[`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/):

```bash
cloudflared tunnel --url http://localhost:8400   # prints https://<random>.trycloudflare.com
```

Then set `MCP_URL` in `.env` to that `https://` origin and restart `pnpm dev`:
the server answers 403 to any other `Host` (DNS-rebinding protection), and
`MCP_URL` is also the origin the views load their font from. Add
`<MCP_URL>/mcp` as the connector's URL. The tunnel is public: anyone with the
URL reaches the server, so keep the read-only default and stop the tunnel
when you are done. Cloudflare lists Server-Sent Events as unsupported on quick
tunnels, and the server answers most requests as a short event stream: should
a host's calls hang, run a named Cloudflare Tunnel (a Cloudflare account) instead.
A built server (`pnpm start`, the image) behind a tunnel or proxy needs the
same `MCP_URL`.

## Step 7: verify

```bash
pnpm build && pnpm typecheck && pnpm test
```

Then a functional pass in the inspector: `engine_list_engines` (engines
configured), one cheap read such as `engine_list_process_definitions` (engine
reachable, auth works) and the cockpit (`engine_open_cockpit`). A clean boot log (no
unknown-var or no-engine warnings) is part of done.

## Troubleshooting

| Symptom                                   | Cause                                                                                                                                                                                                                                                                       |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every in-widget query hangs on "Loading…" | `resolve.dedupe` in `server/vite.config.ts` no longer spreads `VIEW_BUNDLE_DEDUPE`, or a second copy of React, the kit, widget-shell or lucide-react got installed                                                                                                          |
| Widgets render unstyled                   | widget sources outside the Tailwind scan set (workspace modules are globbed; npm-installed ones need an `@source` in `server/src/ui/globals.css`)                                                                                                                           |
| Cockpit links open the wrong web app      | the engine's vendor: without `ENGINE_FLAVOR` (or a `flavor` per engine entry) it counts as Camunda 7                                                                                                                                                                        |
| "Unknown environment variable" at boot    | typo, or a var this build doesn't read; `.env.example` is the authoritative list                                                                                                                                                                                            |
| Widget or module changes don't show up    | a widget edit rebuilds the bundle and restarts the server by itself, so reopen the view; a module's tools are built once, when `pnpm dev` starts: restart it at the repo root                                                                                               |
| A tool is missing                         | module not in `MCP_ACTIVE_MODULES` (the copied `.env` names `engine,notes`, not a module you added), or its toolset filtered it; with no suffix and no OAuth it is `read-only` (see the boot log's `Toolsets:` line); deployments also need `ENGINE_ALLOW_DEPLOYMENTS=true` |
| The boot refuses an unknown module        | `MCP_ACTIVE_MODULES` in `.env` still names a module you removed from `MODULES`, or a typo: take it out of the list                                                                                                                                                          |
| Engine tools show, your module's don't    | another server holds 8400 (the stock Pulse image, say): your server logged `listen EADDRINUSE` and did not start; free 8400 or set `PORT`                                                                                                                                   |
| Claude Desktop shows no tools at all      | a `"url"` entry in `claude_desktop_config.json` (stdio only, use the `mcp-remote` bridge from Step 6), or the app wasn't restarted                                                                                                                                          |
