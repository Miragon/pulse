# Pulse operations

Run Pulse in production: the Docker image, its security model, environment variables, toolsets, health routes and CI.

## Deployment artifact

The server ships as a single multi-arch Docker image on the GitHub Container Registry, `ghcr.io/miragon/pulse-server` (`:<version>` or `:latest`):

```bash
docker run --rm -p 127.0.0.1:8400:8400 \
  -e CAMUNDA_BASE_URL=... \
  -e PROMETHEUS_URL=... \
  ghcr.io/miragon/pulse-server:latest
```

release-please tags `v<version>`; after manual approval `publish-to-docker.yml` builds the root
`Dockerfile` and pushes both tags. The `HEALTHCHECK` polls `/health/ready`. SIGTERM stops
accepting, lets in-flight requests finish (≤ 4 s; readiness answers them 503 `draining`, so add a
Kubernetes `preStop` sleep), then closes the database pool. `playground/docker/docker-compose.yml`
binds every port to `127.0.0.1` (`--profile full` adds the server); Fly.io: `playground/README.md`.

## Security

Without `MCP_OAUTH` the endpoint is unauthenticated and every module without a toolset suffix
runs **read-only**; with it the server is an OAuth resource server (Keycloak or Auth0: bearer
tokens validated on `/mcp`, 401 otherwise, `.well-known` metadata served) and the default rises
to `operations` / `standard` (see [Module activation](#module-activation)). Tokens must carry the
canonical MCP URL (`MCP_URL`, then required) in `aud` (RFC 8707); any other provider or config key
fails the boot. Every request's `Host` (and a POST's `Origin`) must be localhost-class,
`MCP_URL`'s or allow-listed below, else 403 (DNS rebinding).

A gateway or reverse proxy that terminates auth **in front of** the server is invisible to it:
such a deployment runs read-only until `MCP_ACTIVE_MODULES` names its toolsets, and saves no
settings. Identity reaches the server only as a bearer token it validates itself (`MCP_OAUTH`),
never from a header. `admin` is only reached by naming it, never on a server anyone can reach
unauthenticated. Deploying a BPMN/DMN is **code execution inside the engine JVM** (JUEL
expressions, scripts), so `camunda7_create_deployment` also needs `CAMUNDA_ALLOW_DEPLOYMENTS=true`.

`CAMUNDA_AUTH_TYPE=passthrough` forwards each caller's token to the engine (never to Prometheus),
which enforces the caller's permissions if its REST auth is on; only for a trusted single-audience
setup, since the engine could replay that token here. With auth, profiles and saved dashboards
scope to the user (`sub`); without it there is no caller identity: settings saves refuse, and the
dashboard builder and the language save are absent (they also need every module above read-only).
`docker compose --profile auth up -d` adds a local Keycloak on `:8480` (realm `miragon`,
`demo`/`demo`; see `.env.example`). The public Fly playground is unauthenticated and pinned to
`camunda7:read-only,analytics:read-only`.

## Environment variables

| Variable                                                  | Default                             | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PORT`                                                    | `8400`                              | HTTP port the MCP server listens on                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `MCP_URL`                                                 | unset                               | Public base URL: advertised URLs, the OAuth token audience, the `Host`/`Origin` the server accepts, and the origin the views load Geist from: the server serves it at `/fonts/geist-<version>/` (woff2, cached immutable, no CDN) and declares the origin in every view's CSP `resourceDomains`; unset, a view uses the origin its host read it from. A host that blocks the origin, or a gateway that does not route `/fonts/`, shows the host's font |
| `MCP_ALLOWED_HOSTS` / `MCP_ALLOWED_ORIGINS`               | localhost-class                     | Further hostnames / origins (comma lists) admitted next to `MCP_URL`'s; an origin without a scheme matches any scheme and port, `*` turns the check off (only behind an edge that validates `Host` itself)                                                                                                                                                                                                                                             |
| `MCP_MAX_BODY_BYTES`                                      | `4194304`                           | Request-body cap (4 MiB): larger bodies get 413 before they are buffered, ahead of the OAuth gate. At most 4× the cap is held across in-flight requests (503 beyond) and a request must arrive within 30 s. An unauthenticated client can still spend that budget, so rate-limit a public server at its proxy (`pnpm dev` is uncapped)                                                                                                                 |
| `MCP_OAUTH`                                               | unset                               | JSON OAuth resource-server config, the only caller identity; providers `keycloak`, `auth0` (anything else fails the boot). Full field lists: [`.env.example`](https://github.com/Miragon/pulse/blob/main/.env.example)                                                                                                                                                                                                                                 |
| `MCP_ACTIVE_MODULES`                                      | all, read-only                      | Comma-separated `module` or `module:toolset` entries, e.g. `camunda7:operations,analytics:standard`; no suffix = read-only, under OAuth the standard toolset (see [Module activation](#module-activation))                                                                                                                                                                                                                                             |
| `DATABASE_URL`                                            | unset                               | Postgres for saved dashboards + user profiles (both stores; migrations run at boot). Beats `MCP_*_DIR`; the Compose stack ships an instance on host port `8440`                                                                                                                                                                                                                                                                                        |
| `MCP_DASHBOARD_DIR` / `MCP_PROFILE_DIR`                   | in-memory                           | Directories persisting saved dashboards / user profiles across restarts (the file-based alternative when no `DATABASE_URL` is set); one server process per directory. A `NODE_ENV=production` boot (the Docker image) that keeps a store in memory logs a loud warning, but still starts                                                                                                                                                               |
| `CAMUNDA_ENGINES_FILE` / `CAMUNDA_ENGINES_JSON`           | unset                               | Engine list as a file path / inline JSON (the file wins; highest precedence): `[{id, baseUrl, cockpitUrl?, environment?, flavor?, auth?}, ...]` or the environment map `{"<environment>": [engines…]}`. `environment` groups engines in pickers and view heads; `flavor` (`cibseven` \| `operaton` \| `camunda7`, default `camunda7`) selects the vendor's cockpit-link routes and product name; mixed fleets are fine.                                |
| `CAMUNDA_BASE_URL`                                        | `http://localhost:8410/engine-rest` | Single-engine REST endpoint (registered as id `CAMUNDA_ENGINE_ID`); ignored when `CAMUNDA_ENGINES_*` is set. The server warns at boot when no engine source is set at all: the silent fallback works against the Compose engine but breaks the `engine_id` join                                                                                                                                                                                        |
| `CAMUNDA_ENGINE_ID` / `CAMUNDA_ENGINE_FLAVOR`             | `default` / `camunda7`              | Id and vendor (`cibseven` \| `operaton` \| `camunda7`) of the `CAMUNDA_BASE_URL` shorthand. The id must match the engine container's `ENGINE_ID` (= the `engine_id` metric label): analytics reads only the configured engine ids, so a mismatch empties ALL analytics for that engine and its health reads `unknown`. A CIB seven engine sets `cibseven`, or its links open the Camunda 7 cockpit                                                     |
| `CAMUNDA_COCKPIT_URL`                                     | derived                             | Used for jump-out links to Cockpit; multi-engine setups use per-engine `cockpitUrl` instead. Unset, links derive from the REST base URL and carry its host. Set a public URL when that host is internal                                                                                                                                                                                                                                                |
| `CAMUNDA_AUTH_TYPE`                                       | `none`                              | `basic`, `bearer`, `passthrough`, or `none` (fallback for engines without a per-engine `auth`)                                                                                                                                                                                                                                                                                                                                                         |
| `CAMUNDA_USERNAME` / `CAMUNDA_PASSWORD` / `CAMUNDA_TOKEN` | unset                               | Required for `basic` (username + password) / `bearer` (token), enforced at boot                                                                                                                                                                                                                                                                                                                                                                        |
| `CAMUNDA_ALLOW_DEPLOYMENTS`                               | `false`                             | `true` registers `camunda7_create_deployment` (also needs `camunda7:admin`). Deploying runs code inside the engine JVM. Only `true`/`false` (empty = unset); any other value fails the boot                                                                                                                                                                                                                                                            |
| `CAMUNDA_INCIDENT_ISSUE_REPO`                             | unset                               | The one `owner/repo` incident-ticket drafts target with a prefilled GitHub URL (no tool argument redirects it); unset → no URL                                                                                                                                                                                                                                                                                                                         |
| `CAMUNDA_HEALTH_CRITICAL_*`                               | `50` / `25`                         | `…_INCIDENTS` / `…_CLUSTER_SIZE`: thresholds for the engine-health `critical` verdict                                                                                                                                                                                                                                                                                                                                                                  |
| `CAMUNDA_REQUEST_TIMEOUT_MS` / `PROMETHEUS_TIMEOUT_MS`    | `30000`                             | Per-request deadline (ms) for engine / Prometheus calls: a hung upstream fails the tool call with a timeout error naming it. Whole milliseconds only; anything else fails the boot                                                                                                                                                                                                                                                                     |
| `PROMETHEUS_URL`                                          | `http://localhost:9090`             | Prometheus HTTP API, the analytics data source (the repo's Compose stack publishes `:8460`; the server warns at boot when unset). Auth: `PROMETHEUS_BEARER_TOKEN`, or `PROMETHEUS_USERNAME` + `PROMETHEUS_PASSWORD` (URL userinfo moves there); `PROMETHEUS_HEADERS` adds a JSON object of headers (tenant ids). Ambiguous auth fails the boot                                                                                                         |
| `ANALYTICS_ENGINE_IDS`                                    | unset                               | Comma-separated `engine_id`s analytics may read, only for a boot without camunda7; with camunda7 active its configured engine ids scope analytics and this is ignored. With neither, every analytics tool refuses (fail-closed), so a shared Prometheus never exposes other teams' engines                                                                                                                                                             |

Unknown `CAMUNDA_*`/`MCP_*` variables warn at boot; mcp-use telemetry is off
(`MCP_USE_ANONYMIZED_TELEMETRY=true` opts in). The engine container takes `METRICS_ENABLED`,
`ENGINE_ID` (must match the server's engine id, or that engine's analytics come back empty),
`OTEL_EXPORTER_OTLP_ENDPOINT`/`OTEL_SERVICE_NAME` and, per node of a clustered engine, `OTEL_RESOURCE_ATTRIBUTES=service.instance.id=<node>`.

## Module activation

`MCP_ACTIVE_MODULES` lists the modules (unset/`all` = every module), e.g. `camunda7` alone where
no Prometheus exists (the cockpit drops its cross-engine view). Each module runs one toolset per boot:

| Toolset               | Surface                                                                                                                        | No-suffix default |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------- |
| `camunda7:read-only`  | `readOnlyHint` tools only: queries incl. `camunda7_list_engines`                                                               | without OAuth     |
| `camunda7:operations` | + start, claim/assign/complete tasks, variables, job + external-task retries, resolve incidents, messages, default engine      | with OAuth        |
| `camunda7:admin`      | + delete/modify/suspension, migrations, batch retries, signals, the external-task worker protocol, deployments (with the flag) | never             |
| `analytics:read-only` | every analytics tool, no settings save                                                                                         | without OAuth     |
| `analytics:standard`  | + `analytics_save_settings`                                                                                                    | with OAuth        |

An empty (`camunda7:`) or unknown suffix warns and falls back to read-only, even under OAuth.
Widgets hide action buttons whose tool the toolset drops. The full surface of earlier releases is
`camunda7:admin,analytics:standard` plus `CAMUNDA_ALLOW_DEPLOYMENTS=true`, with `MCP_OAUTH` for
the dashboard builder.

## Observability

Three routes sit next to `/mcp`, outside the OAuth gate and the `Host` check:

| Route           | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/health/live`  | Liveness: 200 as soon as the process serves HTTP                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `/health/ready` | Readiness: 200 once the server's own dependencies respond (the Postgres store under `DATABASE_URL`), else 503 naming the failing check. Never probes engines or Prometheus: their outages surface as tool errors, not as an unroutable server. `/health` aliases it (Docker `HEALTHCHECK`, Compose, Fly)                                                                                                                                                                                                                                                       |
| `/metrics`      | Prometheus text: `mcp_tool_calls_total{tool,outcome}`, `mcp_tool_call_duration_seconds{tool}`, `mcp_http_requests_total{method,route,status}`, `mcp_http_request_duration_seconds{method,route}` plus the standard `process_*`/`nodejs_*` collectors. Labels are bounded by construction (tool catalogue, known routes), never users, sessions or arguments. The tool counters see calls that reached a handler; an unknown tool or invalid arguments show only in the request log. With `MCP_METRICS_TOKEN` set it requires that bearer token (401 otherwise) |

mcp-use logs one line per request to stdout (`MCP_USE_LOG_LEVEL=debug`/`trace` adds payloads; the
boot warns). The server expects Camunda 7 / CIB seven and Prometheus; Grafana is optional (`:8470`).
Engine metrics come from the Kotlin plugin via any Micrometer export (see
[Architecture](architecture.md)); alert rules ship in `playground/docker/prometheus/alerts.yml`,
and `analytics_engine_health` surfaces the same gauges and firing alerts in one call.

<a id="ci-cd"></a>

## CI/CD

`.github/workflows/ci.yml` runs parallel jobs on every push, on public npm dependencies only:
TypeScript (build, test, lint, format), Kotlin engine plugins, the CIB seven example, the brand
checks, and the CLI against Operaton, CIB seven and Camunda 7 plus its binaries, image and plugin.
`.github/workflows/docs.yml` checks the vendored docs kit and builds this site from `docs/` on
every pull request that touches it (a dead link fails it), and publishes it from `main`.
