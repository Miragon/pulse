# Playground

> [!TIP]
> Just want to try Pulse? The hosted playground needs no clone:
> `claude mcp add --transport http pulse https://pulse-playground.miragon.ai/mcp`
> ([Get started](https://miragon.github.io/pulse/mcp/getting-started)). This page is for running
> and deploying the playground yourself.

A self-contained demo environment for Pulse: a seeded
CIB seven engine with live traffic and the MCP server on top. Run it locally
with Docker Compose, or deploy the whole stack to Fly.io with one workflow.

| Path                | Contents                                                                      |
| ------------------- | ----------------------------------------------------------------------------- |
| `cibseven-example/` | Spring Boot CIB seven engine: seeded Miravelo Leasing processes, live traffic |
| `docker/`           | Compose stack: engine(s), optional Keycloak and server                        |
| `fly/`              | Fly.io deployment: one `*.fly.toml` per app + `deploy.sh`                     |

## Run locally

From a fresh clone with Node.js, pnpm and Docker (no JDK, no `.env`):

```sh
pnpm stack:up       # the engine; waits until it answers
pnpm play           # stack:up if needed, then the MCP server on :8400 against it
pnpm play:cli -- ping   # pnpm -s play:cli -- ... leaves stdout to the CLI, for a pipe
pulse status        # an installed pulse: .pulse.json makes the stack's engine its default
pnpm stack:status   # what runs, healthy or not
pnpm stack:down     # stop (volumes kept; --wipe drops them)
```

- MCP endpoint: `http://localhost:8400/mcp`; `pnpm play` also starts the official MCP Inspector on
  `127.0.0.1` and prints its URL
- `.pulse.json`, the project file of the CLI and Pulse for VS Code, holds the default profile
  `local` for the stack's engine (CIB seven, no login: its REST API is anonymous). Inside the repo
  a bare `pulse` (`npm install -g @miragon/pulse-cli`, or the build
  `node apps/cli/dist/pulse-cli.js`) reaches it; your own profiles stay available with `--profile`.
- Engine: `http://localhost:8410` (login `demo` / `demo`).
- The engine image copies a jar (`cibseven-example/build/libs/`): `stack:up` builds it when it is
  missing or older than its sources, on a local JDK 21 or else in an `eclipse-temurin:21-jdk`
  container (Gradle cache in the Docker volume `pulse-gradle-cache`; `--jdk-container` forces it).
- `stack:up` reuses a stack that already answers as it is, and stops with a message when another
  container or process holds one of its ports. After a change to the example,
  `pnpm stack:down && pnpm stack:up` deploys it (`stack:up` says when the jar is stale).
  Every checkout and worktree shares the one stack (Compose project `pulse`): `stack:down` stops
  it for all of them, and a checkout without a jar of its own reuses the engine another one built.
- With your own settings instead: `cp .env.example .env`, then `pnpm dev`.
- Every published port binds to `127.0.0.1` on purpose: the engine REST API
  is anonymous, the rest uses demo credentials. From another machine, tunnel instead of rebinding
  (`ssh -L 8400:127.0.0.1:8400 <host>`).
- The server boots **read-only** (no OAuth provider, no toolset suffix; the boot
  log names the effective toolsets). To exercise write paths, run
  `pnpm play --admin` (deployments: `--deploy`), or set
  `MCP_ACTIVE_MODULES=engine:admin` in `.env` for `pnpm dev`;
  deployments additionally need `ENGINE_ALLOW_DEPLOYMENTS=true`.
- Compose profiles: `--profile multi-engine` (second engine on :8411;
  `pnpm stack:up --multi-engine`, `pnpm play --multi-engine`),
  `--profile full` (containerized server on :8400), `--profile auth` (Keycloak on :8480 for
  trying OAuth locally: `pnpm play --auth` puts the server behind it, `pnpm stack:up --auth`
  starts it alone; see the commented block in `.env.example`). For MCP clients without
  Dynamic Client Registration its realm pre-registers the client `pulse-server` with the
  secret `pulse-secret`.
- `--profile dev` runs CIB seven Run, the vendor's image at a pinned tag, on :8410 in place of
  the default engine: no seed and no invoice example, so it starts empty, and its REST API
  is anonymous like the default engine's. It serves `pnpm dev` (with a `.env`) and a bare
  `pulse`. Start it from the repo root with the stack down:
  `docker compose -f playground/docker/docker-compose.yml --profile dev up -d cibseven-dev`.
  `pnpm play`, `pnpm play:cli` and `pnpm stack:up` start the default engine, which needs the
  same port, so run `pnpm stack:down` first; it stops the dev engine too.

## Deploy to Fly.io

The stack maps to two Fly apps in one org, wired over Fly's private 6PN
network. Only the server is public: the engine has no public IP, but
6PN is shared by every app in the org: the anonymous engine REST API is
reachable from all of them, so keep untrusted apps out of the org.

| Fly app                        | Service    | Exposure                                          |
| ------------------------------ | ---------- | ------------------------------------------------- |
| `miragon-ai-playground`        | MCP server | public: `https://pulse-playground.miragon.ai/mcp` |
| `miragon-ai-playground-engine` | CIB seven  | private (`….internal:8410`)                       |

### Via GitHub Actions (recommended)

Run the **Deploy Playground** workflow (`workflow_dispatch`); it builds the
engine jar, then deploys all apps (or a single one via the `target` input).
One-time setup:

- Repo secret `FLY_API_TOKEN`: an org-scoped deploy token
  (`fly tokens create org -o miragon`), stored including the leading `FlyV1 `
  prefix. It must be org-scoped because `deploy.sh` creates missing apps on
  first run; the nightly **Reset Playground** workflow restarts the engine
  with it. An app-scoped `fly tokens create deploy` token is rejected as
  `unauthorized`.
- Optional repo variable `FLY_ORG` if the apps should not live in `miragon`.

### Via CLI

```sh
fly auth login
(cd playground/cibseven-example && ./gradlew bootJar)   # engine image copies the jar
./playground/fly/deploy.sh all                          # or: engine|server
```

First deploy creates the apps.
Afterwards, point an MCP client (e.g. claude.ai custom connector) at
`https://pulse-playground.miragon.ai/mcp`.

### Notes

- The MCP endpoint is **unauthenticated** and pinned **read-only**
  (`MCP_ACTIVE_MODULES=engine:read-only` in
  `fly/server.fly.toml`): anyone can query the demo engine, nobody
  can change it through the server (no engine writes). Never
  widen it there and never set `ENGINE_ALLOW_DEPLOYMENTS` on this app
  (deploying a BPMN runs code in the engine JVM).
- The public host `pulse-playground.miragon.ai` is a custom domain on the
  server app: a Cloudflare record `CNAME pulse-playground →
miragon-ai-playground.fly.dev` (DNS only, not proxied) and
  `fly certs add pulse-playground.miragon.ai -a miragon-ai-playground`.
  `MCP_URL` names it; `MCP_ALLOWED_HOSTS` and `MCP_ALLOWED_ORIGINS` also
  admit the Fly name `miragon-ai-playground.fly.dev`.
- A Fly **secret** overrides an `[env]` entry of the same name. If
  `fly secrets list -a miragon-ai-playground` shows `MCP_ACTIVE_MODULES`,
  keep it in sync with the toml (or `fly secrets unset` it). An OAuth provider's
  variables as secrets add login (`fly secrets set
MCP_OAUTH_KEYCLOAK_SERVER_URL=… MCP_OAUTH_KEYCLOAK_REALM=… -a
miragon-ai-playground`, see `.env.example`); the pin still keeps it
  read-only.
- The engine keeps its H2 database in memory: every engine restart reseeds
  (~600 instances) and live traffic keeps the cockpit moving.
- Everything runs single-machine (`--ha=false`), sized for demos; the
  server scales to zero when idle. Tear down with `fly apps destroy <app>`
  per app.
