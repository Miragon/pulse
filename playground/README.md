# Playground

A self-contained demo environment for Pulse: a seeded
CIB seven engine with live traffic, the full metric-first analytics stack,
and the MCP server on top. Run it locally with Docker Compose, or deploy
the whole stack to Fly.io with one workflow.

| Path                | Contents                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------- |
| `cibseven-example/` | Spring Boot CIB seven engine: seeded Miravelo Leasing processes, live traffic, Micrometer metrics (OTLP push) |
| `docker/`           | Compose stack: engine(s), OTEL Collector, Prometheus, Grafana, optional server                                |
| `fly/`              | Fly.io deployment: one `*.fly.toml` per app + `deploy.sh`                                                     |

## Run locally

```sh
docker compose -f playground/docker/docker-compose.yml up -d   # infra: engine, OTEL, Prometheus, Grafana
cp .env.example .env                                           # dev defaults: Prometheus :8460
pnpm dev                                                       # MCP server on :8400
```

- MCP endpoint: `http://localhost:8400/mcp`, inspector: `http://localhost:8400/mcp/inspector`
- Grafana: `http://localhost:8470`, Prometheus: `http://localhost:8460`, engine: `http://localhost:8410`
- Every published port binds to `127.0.0.1` on purpose: the engine REST API
  is anonymous, Grafana runs as anonymous Admin, the rest uses demo
  credentials. From another machine, tunnel instead of rebinding
  (`ssh -L 8400:127.0.0.1:8400 <host>`).
- The server boots **read-only** (no OAuth provider, no toolset suffix; the boot
  log names the effective toolsets). To exercise write paths, set
  `MCP_ACTIVE_MODULES=camunda7:admin,analytics` in `.env` (see the
  commented line there); deployments additionally need
  `CAMUNDA_ALLOW_DEPLOYMENTS=true`.
- Compose profiles: `--profile multi-engine` (second engine on :8411),
  `--profile full` (containerized server on :8400), `--profile dev` (plain
  CIB seven image, no analytics), `--profile auth` (Keycloak on :8480 for
  trying OAuth locally, see the commented block in `.env.example`)
- The Compose project is `pulse`. A stack started before the rename still
  runs as `miragon-ai` and holds the ports: stop it once with
  `docker compose -p miragon-ai -f playground/docker/docker-compose.yml down`
  (`down -v` drops its volumes as well).

## Deploy to Fly.io

The stack maps to five Fly apps in one org, wired over Fly's private 6PN
network. Only the server is public: everything else has no public IP, but
6PN is shared by every app in the org: the anonymous engine REST API is
reachable from all of them, so keep untrusted apps out of the org.

| Fly app                            | Service        | Exposure                                          |
| ---------------------------------- | -------------- | ------------------------------------------------- |
| `miragon-ai-playground`            | MCP server     | public: `https://pulse-playground.miragon.ai/mcp` |
| `miragon-ai-playground-engine`     | CIB seven      | private (`….internal:8410`)                       |
| `miragon-ai-playground-otel`       | OTEL Collector | private (`….internal:4318` / `:9464`)             |
| `miragon-ai-playground-prometheus` | Prometheus     | private (`….internal:9090`), 3 GB volume          |
| `miragon-ai-playground-grafana`    | Grafana        | private: `flyctl proxy 8470:3000 -a <app>`        |

### Via GitHub Actions (recommended)

Run the **Deploy Playground** workflow (`workflow_dispatch`); it builds the
engine jar, then deploys all apps (or a single one via the `target` input).
One-time setup:

- Repo secret `FLY_API_TOKEN`: an org-scoped deploy token
  (`fly tokens create org -o miragon`), stored including the leading `FlyV1 `
  prefix. It must be org-scoped because `deploy.sh` creates missing apps on
  first run, and the nightly **Reset Playground** workflow reaches two apps
  (engine + Prometheus). An app-scoped `fly tokens create deploy` token is
  rejected as `unauthorized`.
- Optional repo variable `FLY_ORG` if the apps should not live in `miragon`.

### Via CLI

```sh
fly auth login
(cd playground/cibseven-example && ./gradlew bootJar)   # engine image copies the jar
./playground/fly/deploy.sh all                          # or: otel|engine|prometheus|grafana|server
```

First deploy creates the apps and the Prometheus volume.
Afterwards, point an MCP client (e.g. claude.ai custom connector) at
`https://pulse-playground.miragon.ai/mcp`.

### Notes

- The MCP endpoint is **unauthenticated** and pinned **read-only**
  (`MCP_ACTIVE_MODULES=camunda7:read-only,analytics` in
  `fly/server-camunda7.fly.toml`): anyone can query the demo engine, nobody
  can change it through the server (no engine writes). Never
  widen it there and never set `CAMUNDA_ALLOW_DEPLOYMENTS` on this app
  (deploying a BPMN runs code in the engine JVM).
- The public host `pulse-playground.miragon.ai` is a custom domain on the
  server app: a Cloudflare record `CNAME pulse-playground →
miragon-ai-playground.fly.dev` (DNS only, not proxied) and
  `fly certs add pulse-playground.miragon.ai -a miragon-ai-playground`.
  `MCP_URL` names it. The old `https://miragon-ai-playground.fly.dev/mcp`
  keeps working, since `MCP_ALLOWED_HOSTS` and `MCP_ALLOWED_ORIGINS` still
  admit it.
- A Fly **secret** overrides an `[env]` entry of the same name. If
  `fly secrets list -a miragon-ai-playground` shows `MCP_ACTIVE_MODULES`,
  keep it in sync with the toml (or `fly secrets unset` it). An OAuth provider's
  variables as secrets add login (`fly secrets set
MCP_USE_OAUTH_KEYCLOAK_SERVER_URL=… MCP_USE_OAUTH_KEYCLOAK_REALM=… -a
miragon-ai-playground`, see `.env.example`); the pin still keeps it
  read-only. A secret left from the retired OAuth JSON variable fails the boot:
  unset it in the same deploy (see the upgrade note under Security in
  `docs/mcp/operations.md`).
- The engine keeps its H2 database in memory: every engine restart reseeds
  (~600 instances) and live traffic keeps metrics moving. Prometheus history
  survives restarts on its volume.
- Everything runs single-machine (`--ha=false`), sized for demos, roughly
  $15–25/month; the server scales to zero when idle. Tear down with
  `fly apps destroy <app>` per app.
