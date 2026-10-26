# Get started with Pulse

Pulse answers questions about your Camunda 7, CIB seven and Operaton
engines in Claude, ChatGPT or any other MCP client. Try it on the hosted playground first, then run
it on your own engine. Commands and configs call the server `pulse`.

## Connect your Claude in 30 seconds

The hosted [playground](https://pulse-playground.miragon.ai/mcp) runs a seeded CIB seven engine
with live demo traffic and the full analytics stack. It is read-only and needs no login. Every
night at 22:00 UTC the engine reseeds and the metrics are wiped.

::: code-group

```sh [Claude Code]
claude mcp add --transport http pulse https://pulse-playground.miragon.ai/mcp
```

```txt [claude.ai]
Settings → Connectors → Add custom connector
URL: https://pulse-playground.miragon.ai/mcp
```

:::

Then ask _"Which processes have open incidents right now?"_ and drill into the widgets. Claude
Desktop needs a bridge, described in [Usage](usage.md#connect-your-assistant).

Without an assistant of your own, [open the playground in a browser chat](https://inspector.manufact.com/inspector?server=https%3A%2F%2Fpulse-playground.miragon.ai%2Fmcp&tab=chat),
a third-party MCP inspector connected to the same engine, with nothing to install.

## Run it on your own engine

You need Docker and the REST API of a Camunda 7, CIB seven or Operaton engine. The server boots
read-only, and `MCP_ACTIVE_MODULES=camunda7` leaves out analytics until you run Prometheus:

```sh
docker run --rm -p 127.0.0.1:8400:8400 \
  -e CAMUNDA_BASE_URL=http://host.docker.internal:8080/engine-rest \
  -e MCP_ACTIVE_MODULES=camunda7 \
  ghcr.io/miragon/pulse-server:latest
claude mcp add --transport http pulse http://localhost:8400/mcp
```

Pulse is pre-1.0 and minor releases can rename tools, so pin a version tag from the
[releases](https://github.com/Miragon/pulse/releases) for anything beyond a first try. If the
REST API needs a login, add `CAMUNDA_AUTH_TYPE=basic` with `CAMUNDA_USERNAME` and
`CAMUNDA_PASSWORD`. Pulse assumes a Camunda 7 engine: for CIB seven or Operaton add
`CAMUNDA_ENGINE_FLAVOR=cibseven` (or `operaton`), so its links open the right web app.
[Operations](operations.md) covers several engines, OAuth and the toolsets that
allow writes. For analytics, your engine project adds the plugin
`io.miragon.mcp:cibseven-history-metrics` and exports its metrics to Prometheus, as
[Architecture](architecture.md) shows.
