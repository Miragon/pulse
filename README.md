# Pulse

[![Image](https://img.shields.io/badge/image-ghcr.io%2Fmiragon%2Fpulse--server-2496ED?style=flat-square&logo=docker&logoColor=white)](https://github.com/Miragon/pulse/pkgs/container/pulse-server)
[![Release](https://img.shields.io/github/v/release/Miragon/pulse?style=flat-square&label=release)](https://github.com/Miragon/pulse/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/Miragon/pulse/ci.yml?style=flat-square&label=ci)](https://github.com/Miragon/pulse/actions/workflows/ci.yml)
[![MCP](https://img.shields.io/badge/Model%20Context%20Protocol-server-blue?style=flat-square)](https://modelcontextprotocol.io/)

Drive **Camunda 7 / CIB seven** from any AI assistant: process operations and analytics over the
[Model Context Protocol](https://modelcontextprotocol.io/). Pulse is part of
[Miragon AI](https://miragon.ai/), the family of Miragon's AI tools.

One MCP server, two modules (**operations** + **analytics**), and a fleet of interactive
[MCP App](https://modelcontextprotocol.io/) widgets that render dashboards, BPMN diagrams and incident
panels straight into the chat. Built on [mcp-use](https://github.com/mcp-use/mcp-use).

> Ask _"why is the loan-approval process stalling?"_ The assistant lists the running instances,
> opens the incident panel, reads the metrics and pinpoints the failing step. Once you grant the
> `operations` toolset, it also retries the failed jobs. No cockpit tab-hunting, no PromQL.

**[🐳 Pull the server image from the GitHub Container Registry →](https://github.com/Miragon/pulse/pkgs/container/pulse-server)**

## What you get

- **Conversational BPM operations:** list and inspect process definitions, instances, user tasks,
  external tasks, incidents, jobs, deployments and history; start, modify, suspend, migrate, and
  resolve, exposed as `camunda7_*` tools.
- **Process analytics:** Prometheus-backed KPIs for performance, bottlenecks, failed instances,
  cluster / version / engine comparison, and a live engine-health snapshot, as `analytics_*` tools.
- **Interactive widgets (MCP Apps):** cockpit dashboard, process & incident panels, BPMN viewer,
  heatmaps and history timeline rendered for the user while the model gets a compact summary.
- **Multi-engine routing:** talk to several engines at once (CIB seven, Operaton and Camunda 7
  mixed in one fleet) with a per-user default engine plus per-call overrides; analytics aggregate
  or compare across engines.
- **Fail-closed toolsets:** read-only unless you widen it: `operations` (the default under OAuth)
  or `admin` per deployment; deployments additionally need an explicit opt-in flag.
- **Self-hostable:** a single multi-arch (amd64/arm64) image on the GitHub Container Registry,
  plus a drop-in Micrometer metrics plugin for the engine.

## Quick start

Pull the published server image and point an MCP client at it. You need a reachable Camunda 7,
CIB seven or Operaton engine (REST API) and, for the analytics module, a Prometheus instance.

```bash
docker run --rm -p 127.0.0.1:8400:8400 \
  -e CAMUNDA_BASE_URL=http://host.docker.internal:8410/engine-rest \
  -e CAMUNDA_AUTH_TYPE=basic \
  -e CAMUNDA_USERNAME=demo \
  -e CAMUNDA_PASSWORD=demo \
  -e PROMETHEUS_URL=http://host.docker.internal:9090 \
  ghcr.io/miragon/pulse-server:latest
```

Pulse assumes a Camunda 7 engine. For CIB seven or Operaton add `-e CAMUNDA_ENGINE_FLAVOR=cibseven`
(or `operaton`): it picks the engine's cockpit links and the product name the views show.

Without `MCP_OAUTH` the endpoint is unauthenticated, so this boots **read-only**: queries, widgets
and analytics, no engine writes. The boot log names the effective [toolsets](#toolsets). To allow
writes, put OAuth in front (`-e MCP_OAUTH='{"provider":"keycloak",…}'` raises the default to
`operations`) or name the toolsets yourself (`-e MCP_ACTIVE_MODULES=camunda7:operations,analytics`),
on an unauthenticated server only while the port stays bound to `127.0.0.1` as above. Reached
under any other name (a public hostname, a gateway, a cluster service), the server answers 403
until `MCP_URL` or `MCP_ALLOWED_HOSTS` names it: `Host`/`Origin` validation is its DNS-rebinding
protection.

The server speaks the streamable-HTTP MCP transport on `http://localhost:8400/mcp`. Add it to your
MCP host as an HTTP/streamable server: `claude mcp add --transport http pulse
http://localhost:8400/mcp` for Claude Code, a custom connector on your public URL for claude.ai /
ChatGPT. Claude Desktop takes stdio servers only, so bridge it there:

```json
{
  "mcpServers": {
    "pulse": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://127.0.0.1:8400/mcp", "--transport", "http-only"]
    }
  }
}
```

See [How to use it](docs/usage.md) for the full connection matrix and what to ask once connected.

**Prefer to build the image yourself?** No credentials needed: build it and run `pulse-server`
in place of the published image above.

```bash
docker build -t pulse-server .
```

**Want the whole stack on your machine?** The repo ships a Compose file with CIB seven, the OTEL
Collector, Prometheus and Grafana wired together. See
[`playground/docker/`](playground/docker/) and [Local development](#local-development) below.

## How it works

```
┌─────────────────────────────────────────────────────┐
│            MCP Host (Claude, ChatGPT, ...)          │
│  ┌──────────────────────────────────────────────┐   │
│  │                 pulse-server                 │   │
│  │  ┌─────────────────┐  ┌──────────────────┐   │   │
│  │  │ camunda7 module │  │ analytics module │   │   │
│  │  │  BPM ops tools  │  │  analytics tools │   │   │
│  │  │  + widgets      │  │  + dashboards    │   │   │
│  │  └────────┬────────┘  └────────┬─────────┘   │   │
│  └───────────┼─────────────────────┼────────────┘   │
└──────────────┼─────────────────────┼────────────────┘
               ▼                     ▼
    ┌────────────────────┐ ┌─────────────────────┐
    │  OpenAPI Client    │ │  Prometheus Client  │
    │  (hey-api/openapi) │ │  (PromQL, HTTP API) │
    └──────────┬─────────┘ └──────────┬──────────┘
               ▼                      ▼
    ┌────────────────────┐ ┌─────────────────────┐
    │   CIB Seven /      │ │   Prometheus        │
    │   Camunda 7 REST   │ │  (process metrics)  │
    └────────────────────┘ └──────────┬──────────┘
                                      ▲
                          ┌───────────┴───────────┐
                          │  OTEL Collector       │
                          │  ◄── engine metrics   │
                          └───────────────────────┘
```

Operations tools call the engine's REST API directly. Analytics tools query Prometheus, which is fed
by the [engine metrics plugin](engine-plugins/) via the OpenTelemetry Collector. So analytics never
touch the engine database and stay model-bounded: definition keys, activity ids and engine ids
only, never instance ids or variable values.

## Modules & packages

A pnpm + Turbo monorepo. The server composes the two modules and serves them as one MCP endpoint.

| Path                                                                                                      | Package                                   | Role                                                                    |
| --------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------- |
| [`apps/mcp-server-camunda7/`](apps/mcp-server-camunda7)                                                   | `@miragon/pulse-mcp-server-camunda7`      | The MCP host: composes modules, bundles widgets, serves HTTP on `:8400` |
| [`apps/cli/`](apps/cli)                                                                                   | `@miragon/pulse-cli`                      | The CLI: every engine REST operation as a command, plus workflows       |
| [`packages/connectors/camunda/camunda7-connector/`](packages/connectors/camunda/camunda7-connector)       | `@miragon/pulse-camunda7-connector`       | Camunda 7 operations tools, widget tools, and React widgets             |
| [`packages/connectors/analytics/analytics-connector/`](packages/connectors/analytics/analytics-connector) | `@miragon/pulse-analytics-connector`      | Prometheus-backed analytics tools and dashboard widgets                 |
| [`packages/connectors/camunda/camunda7-client/`](packages/connectors/camunda/camunda7-client)             | `@miragon/pulse-camunda7-client`          | Generated CIB seven REST SDK + MCP-oriented Zod schemas                 |
| [`packages/connectors/analytics/analytics-client/`](packages/connectors/analytics/analytics-client)       | `@miragon/pulse-analytics-client`         | Prometheus client, PromQL query functions + metrics contract            |
| [`packages/core/widget-shell/`](packages/core/widget-shell)                                               | `@miragon/pulse-widget-shell`             | Shared widget plumbing (`adaptDataWidget`, view builders)               |
| [`engine-plugins/`](engine-plugins)                                                                       | `io.miragon.mcp:cibseven-history-metrics` | Kotlin Micrometer metrics plugin for CIB seven (Java 21)                |
| [`playground/`](playground)                                                                               | —                                         | Demo env: CIB seven showcase, Compose stack, Fly.io deploy              |
| [`docs/`](docs/README.md)                                                                                 | `@miragon/pulse-docs`                     | Pulse docs, a VitePress site on GitHub Pages                            |

## Tools

Tool inputs are strict: an unknown or misnamed parameter is refused with the list of valid
ones instead of being ignored (which used to widen a "filtered" answer to the whole engine).

### Camunda 7 module (`camunda7_*`)

BPM operations across these domains (`category`): `engines`, `process-definitions`,
`process-instances`, `tasks`, `external-tasks`, `messages-signals`, `deployments`, `incidents`,
`jobs`, `history`, `migrations`, `batches`. Highlights:

- **Process definitions:** `list_process_definitions`, `get_process_definition_xml`
- **Process instances:** `start`, `list`, `get`, `delete`, `modify`, `set_*_suspension`,
  `get_activity_instance_tree`, variables
- **User & external tasks:** `list/get/claim/unclaim/complete`, `list_external_tasks`,
  `set_external_task_retries`
- **Incidents & jobs:** `list_incidents`, `resolve_incident` (custom incidents; the engine's
  `failedJob`/`failedExternalTask` clear by a retry), `format_incident_issue`, `list_jobs`,
  `get_job_stacktrace`, `set_job_retries`
- **History, migrations & batches:** `query_historic_*` (ISO 8601 dates; incidents incl. resolved
  ones), migration tools; batch tools return a queued `batchId` that `get_batch` follows
- **Lists:** one page as `{ items, totalCount, hasMore, nextOffset? }`, `maxResults` ≤ 100;
  variable reads cut values over 2000 characters (`truncated: true`); `variableName` reads one whole
- **Widgets:** `open_cockpit` (the cockpit app), `show_process_list`/`detail`, `show_incidents_dashboard`,
  `show_bpmn_viewer`, `show_history_timeline`, `show_job_panel`, …

### Analytics module (`analytics_*`)

Prometheus-backed analysis over PromQL: `analyze_process_performance`, `compare_execution_periods`,
`element_bottleneck`, `find_failed_instances`, `cluster_compare`, `version_compare`,
`engine_landscape` (the cross-engine overview: what runs where, load and job backlog per engine),
`engine_compare` (one process definition on two engines), and `engine_health` (a live WIP /
incidents / backlog / alerts snapshot). Widgets: `show_dashboard`, `show_failure_dashboard`,
`show_cluster_compare`, `show_version_compare`, `show_engine_landscape`, `show_engine_compare`,
`show_bpmn_heatmap`.

Across engines the tools report counts, never per-engine rates: engines host different process
definitions, so an aggregated failure rate or duration describes that engine's process mix rather
than the engine. `engine_compare` therefore requires a `processDefinitionKey`; `engine_landscape`
lists the definitions deployed on more than one engine as its valid inputs.

### Toolsets

Each module runs exactly one toolset per boot, chosen by a suffix in `MCP_ACTIVE_MODULES`
(`camunda7:operations,analytics:standard`) and stated in the boot log. Without a suffix the default
fails closed: the read-only toolset on an unauthenticated server, the standard one under
`MCP_OAUTH`. `admin` is never implied (only naming it grants it), and an empty (`camunda7:`) or
unknown suffix warns and falls back to read-only, even under OAuth.

| Toolset               | Surface                                                                                                                                                                                                                                   | No-suffix default |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `camunda7:read-only`  | Queries only (`list_*`, `get_*`, `query_*`, incl. `camunda7_list_engines`): monitoring without writes                                                                                                                                     | without OAuth     |
| `camunda7:operations` | Read-only plus day-to-day writes: start instances, claim/assign/complete tasks, variables, job and external-task retries, resolve incidents, correlate messages, the saved default engine                                                 | with OAuth        |
| `camunda7:admin`      | Everything: adds delete/modify/suspend, migrations, batch retries, `throw_signal` (engine-wide broadcast), the external-task worker protocol (`fetch_and_lock`, `complete_external_task`, `handle_external_task_failure`) and deployments | never             |
| `analytics:read-only` | Every analytics tool and widget; no settings save                                                                                                                                                                                         | without OAuth     |
| `analytics:standard`  | Adds `analytics_save_settings`                                                                                                                                                                                                            | with OAuth        |

`camunda7_create_deployment` additionally needs `CAMUNDA_ALLOW_DEPLOYMENTS=true`: deploying a BPMN or
DMN runs code inside the engine JVM (JUEL expressions, scripts). The full surface of earlier
releases is `MCP_ACTIVE_MODULES=camunda7:admin,analytics:standard` plus that flag (the dashboard
builder also needs `MCP_OAUTH`), never on a server the network can reach without authentication.
A gateway or reverse proxy that terminates auth in front of the server is invisible to it, so such
a deployment runs read-only until it names its toolsets.

The widgets follow the toolset: an action button whose tool the toolset drops (retry, resolve
incident, complete task, edit variable, suspend, cancel) is hidden, not disabled: the default
anonymous deployment shows no write buttons. The dashboard builder (`get-builder-catalogue`,
`save/list/load/delete-dashboard`) and the language save (`shell_save_settings`) exist only under
`MCP_OAUTH` and while no active module runs read-only; `render-view`, `refresh-view`,
`get-framework-manifest` and the settings page (`shell_show_settings`) are always there.

## Configuration

The most common variables. See [`docs/operations.md`](docs/operations.md) for the full reference.

| Variable                                                  | Default                             | Description                                                                                                                                                               |
| --------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                                                    | `8400`                              | HTTP port the MCP server listens on                                                                                                                                       |
| `MCP_ACTIVE_MODULES`                                      | all, read-only                      | Comma-separated modules (`camunda7,analytics`), each with an optional [toolset](#toolsets) suffix; no suffix = read-only, under OAuth the standard toolset                |
| `MCP_URL`                                                 | —                                   | Public base URL: advertised URLs, OAuth audience, the `Host`/`Origin` accepted (else localhost only), and the origin the views load Geist from (`/fonts/…`)               |
| `MCP_OAUTH`                                               | —                                   | JSON OAuth resource-server config (Keycloak / Auth0) protecting `/mcp`, the only caller identity (per-user settings and dashboards)                                       |
| `CAMUNDA_ALLOW_DEPLOYMENTS`                               | `false`                             | `true` registers `camunda7_create_deployment` under `camunda7:admin`: code execution in the engine JVM; empty = unset, any value but `true`/`false` fails the boot        |
| `CAMUNDA_BASE_URL`                                        | `http://localhost:8410/engine-rest` | Single-engine REST base URL                                                                                                                                               |
| `CAMUNDA_ENGINE_ID`                                       | `default`                           | Id of that engine; must match the engine's `ENGINE_ID` or its analytics stay empty                                                                                        |
| `CAMUNDA_ENGINE_FLAVOR`                                   | `camunda7`                          | Vendor of that engine (`cibseven`, `operaton` or `camunda7`): picks its cockpit links and product name                                                                    |
| `CAMUNDA_ENGINES_JSON` / `CAMUNDA_ENGINES_FILE`           | —                                   | Register multiple engines (see [Multi-engine](#multi-engine))                                                                                                             |
| `CAMUNDA_COCKPIT_URL`                                     | derived                             | Cockpit web base for jump-out links                                                                                                                                       |
| `CAMUNDA_AUTH_TYPE`                                       | `none`                              | `basic`, `bearer`, `passthrough`, or `none`: fallback for engines without an `auth`                                                                                       |
| `CAMUNDA_USERNAME` / `CAMUNDA_PASSWORD` / `CAMUNDA_TOKEN` | —                                   | Credentials for `basic`/`bearer`; `passthrough` forwards each caller's bearer token (trusted single-audience setups only: the engine could replay it against this server) |
| `PROMETHEUS_URL`                                          | `http://localhost:9090`             | Prometheus HTTP API, the analytics data source                                                                                                                            |
| `PROMETHEUS_BEARER_TOKEN` / `…_USERNAME` / `…_PASSWORD`   | —                                   | Prometheus auth, bearer or basic (URL userinfo works too); `PROMETHEUS_HEADERS` adds JSON headers such as a tenant id                                                     |
| `ANALYTICS_ENGINE_IDS`                                    | —                                   | Engines analytics may read when camunda7 is inactive (comma-separated `engine_id`s); otherwise camunda7's configured engines scope analytics. Neither: analytics refuses  |
| `CAMUNDA_REQUEST_TIMEOUT_MS` / `PROMETHEUS_TIMEOUT_MS`    | `30000`                             | Per-request deadline in ms for engine / Prometheus calls; a hung upstream fails the tool call with a timeout error                                                        |

### Multi-engine

The server can route to several engines: CIB seven, Operaton and Camunda 7 mixed in one fleet.
Tag each engine in its metrics plugin
(`ENGINE_ID`), register them in the server (`CAMUNDA_ENGINES_JSON` / `CAMUNDA_ENGINES_FILE`;
`ENGINE_ID` must match the registered `id`, or that engine's analytics come back empty), and the
host discovers them via `camunda7_list_engines` (read-only); `camunda7_select_engine` saves an
engine as the caller's default (a per-user profile setting, so it needs `MCP_OAUTH` identity and a
toolset that allows writes). Every operations tool also accepts a per-call `engine` override
(advertised as an enum of the configured ids), which works without any identity. Analytics tools
take an optional `engine` filter to aggregate or compare. The server `instructions` state the
routing rule once for every tool. Each engine entry may carry its own `auth`
(`{type, username?, password?, token?}`); entries without one use the global `CAMUNDA_*` settings.
Entries may also declare their vendor via `flavor` (`cibseven` | `operaton` | `camunda7`, default
`camunda7`; the single-engine shorthand takes `CAMUNDA_ENGINE_FLAVOR`), which selects the engine's
cockpit-link routes and display name.

With several engines, the cockpit landing lists every engine with its live health in words (open
incidents, empty, unreachable, loading), read from the engine itself. The cross-engine view (process
landscape plus fleet-wide failure and performance analyses) needs the analytics module; without it
(e.g. `MCP_ACTIVE_MODULES=camunda7` where no Prometheus exists) the cockpit does not offer it.

Fleets that span several environments (each environment hosting some services with an engine)
group their engines per environment: the cockpit landing lists the engines under their
environment, the engine switcher, the settings page and `camunda7_list_engines` group them by
environment, and every engine view names the environment as a chip ("PROD") next to the engine,
write confirmations included. Either write the
engines JSON as a map keyed by environment id, or tag entries individually:

```json
{
  "prod-eu": [{ "id": "prod-a", "baseUrl": "http://engine-a:8410/engine-rest" }],
  "prod-us": [{ "id": "prod-b", "baseUrl": "http://engine-b:8410/engine-rest" }]
}
```

Engine ids stay globally unique across environments: the id remains the `ENGINE_ID` metrics
join key and the per-call `engine` selector; the environment is a grouping level only.
Full walkthrough in [`docs/operations.md`](docs/operations.md).

## Engine metrics plugin

The analytics module needs `camunda_*` series in Prometheus. The Kotlin plugin in
[`engine-plugins/`](engine-plugins) records them as Micrometer meters from inside the CIB seven
runtime, with no engine-side database; export via Micrometer's OTLP registry (the playground default),
an Actuator Prometheus scrape, or the OTEL Java agent's Micrometer bridge. It publishes to Maven Central as
`io.miragon.mcp:cibseven-history-metrics`. See [`engine-plugins/README.md`](engine-plugins/README.md)
and the runnable [`playground/cibseven-example/`](playground/cibseven-example).

## Local development

Run the full stack: infra in Docker, the server from source with hot reload.

```bash
pnpm install --frozen-lockfile

docker compose -f playground/docker/docker-compose.yml up -d   # CIB Seven, OTEL, Prometheus, Grafana
cp .env.example .env                                 # dev defaults: engine on :8410, Prometheus on :8460
pnpm dev                                             # MCP server on :8400
```

`pnpm dev` also serves the `mcp-use` inspector at `http://localhost:8400/mcp/inspector`: call tools and
render widgets by hand. It boots read-only; uncomment `MCP_ACTIVE_MODULES` in `.env` to exercise the
write paths. The minimum bar for any change:

```bash
pnpm build && pnpm typecheck && pnpm test && pnpm lint
cd engine-plugins && ./gradlew build      # Kotlin: compile + unit + Konsist architecture tests
```

See [`docs/developer.md`](docs/developer.md) and [`CLAUDE.md`](CLAUDE.md) for the architecture
invariants and house patterns.

## Documentation

The docs live in [`docs/`](docs/README.md) and are published as a VitePress site at
[miragon.github.io/pulse](https://miragon.github.io/pulse/):

- [Getting started](docs/getting-started.md): connect your Claude to the playground, then run it on your own engine
- [Usage](docs/usage.md): connect an assistant and operate your processes
- [Architecture](docs/architecture.md): one-page mental model of the server, modules and systems
- [For Developers](docs/developer.md): clone, install, and run the stack locally
- [Operations](docs/operations.md): deployment, environment, and observability

Build the site locally with `pnpm docs:dev`.

The website [miragon.ai](https://miragon.ai/tools/pulse/) is built from
[Miragon/miragon-ai-docs](https://github.com/Miragon/miragon-ai-docs). A user-visible change here
(env vars, tools, ports, getting-started steps) updates `docs/` in the same PR, and needs a PR
there when the product page shows it.

## Renamed from miragon-ai

Up to 0.20.0 this server shipped as "Miragon AI" from `Miragon/miragon-ai`. From 0.21.0 on,
everything it ships carries the Pulse name:

- npm: `@miragon-ai/<name>` becomes `@miragon/pulse-<name>` for `widget-shell`,
  `camunda7-client`, `camunda7-connector`, `analytics-client` and `analytics-connector`; subpaths
  (`/server`, `/widgets` …) stay. Rename the dependencies and the import specifiers, one version
  across all five. The old packages are deprecated with a pointer to the new name, and update bots
  do not follow a rename, so switch by hand.
- Docker image: `miragon/miragon-ai-server` on Docker Hub becomes `ghcr.io/miragon/pulse-server`
  on the GitHub Container Registry; the old image stays on Docker Hub, frozen at 0.20.0.
- Starter: `Miragon/miragon-ai-starter` becomes
  [`Miragon/pulse-starter`](https://github.com/Miragon/pulse-starter).
- Playground: `https://pulse-playground.miragon.ai/mcp`; the old `fly.dev` URL keeps answering.
- MCP client key: the examples register the server as `pulse` (was `miragon-ai`; this repo's
  `.mcp.json` used `automation-mcp`), and it introduces itself as `pulse`; its log lines start
  with `[pulse]`. In Claude Code the key is the tool prefix: allowlists and hooks on
  `mcp__miragon-ai__*` or `mcp__automation-mcp__*` need `mcp__pulse__*`.
- Engine access logs: the client's User-Agent is `@miragon/pulse-camunda7-client/<version>` (was
  `@miragon-ai/camunda7-client/0.1.0`).
- Local Keycloak (`--profile auth`): the pre-registered client is `pulse-server` with secret
  `pulse-secret`; recreate the container to re-import the realm.
- Repo: GitHub redirects the old URL; `git remote set-url origin git@github.com:Miragon/pulse.git`
  updates a clone. The local Compose stack runs as project `pulse` now, so stop an old one first
  ([`playground/`](playground/README.md#run-locally)).

## Releases

Releases are automated with [release-please](https://github.com/googleapis/release-please): semantic
commits on `main` open a Release PR; merging it tags the repo and, after approval, publishes the
[server image](https://github.com/Miragon/pulse/pkgs/container/pulse-server) to the GitHub
Container Registry, the packages and the CLI to npm, the CLI's binaries to the GitHub release, its
image `ghcr.io/miragon/pulse-cli` and its Homebrew formula `miragon/tap/pulse-cli`, and the engine
plugin to Maven Central.

## Contributing

Issues, pull requests and discussions are welcome on
[GitHub](https://github.com/Miragon/pulse). Use [semantic commit messages](https://www.conventionalcommits.org/)
(they drive the release), and make sure `pnpm build && pnpm typecheck && pnpm test && pnpm lint`
passes. The repo-specific skills under `.claude/skills/` document the two main feature paths.

## License

See [LICENSE](LICENSE).
