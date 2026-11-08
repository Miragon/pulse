# Get started with Pulse

Pulse answers questions about your Camunda 7, CIB seven and Operaton
engines in Claude, ChatGPT or any other MCP client. Try it on the hosted playground first, then run
it on your own engine. Commands and configs call the server `pulse`.

## Connect your Claude in 30 seconds

The hosted [playground](https://pulse-playground.miragon.ai/mcp) runs a seeded CIB seven engine
with live demo traffic. It is read-only and needs no login. Every night at 22:00 UTC the engine
reseeds.

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

Without an assistant of your own, open the playground in the official [MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector)
(Node.js 22.19 or later): `npx @modelcontextprotocol/inspector --server-url https://pulse-playground.miragon.ai/mcp --transport http`.
Its Tools tab calls every tool, its Apps tab renders the widgets; it has no chat, so a hand-off to the chat does nothing.

## Run it on your own engine

You need Docker and the REST API of a Camunda 7, CIB seven or Operaton engine. The server boots
read-only:

```sh
docker run --rm -p 127.0.0.1:8400:8400 \
  -e ENGINE_BASE_URL=http://host.docker.internal:8080/engine-rest \
  ghcr.io/miragon/pulse-server:latest
claude mcp add --transport http pulse http://localhost:8400/mcp
```

Pulse is below 1.0 and any release can change a tool or a setting, so pin a version tag from the
[releases](https://github.com/Miragon/pulse/releases) for anything beyond a first try; the
[changelog](https://github.com/Miragon/pulse/blob/main/CHANGELOG.md) lists every breaking change.
If the REST API needs a login, add `ENGINE_AUTH_TYPE=basic` with `ENGINE_USERNAME` and
`ENGINE_PASSWORD`. Pulse assumes a Camunda 7 engine: for CIB seven or Operaton add
`ENGINE_FLAVOR=cibseven` (or `operaton`), so its links open the right web app.
On Linux add `--add-host=host.docker.internal:host-gateway`; that name misses a port bound to
`127.0.0.1`: join such an engine's network (`--network`) and use its service and container port.
[Operations](operations.md) covers several engines, OAuth and the toolsets that
allow writes. Pulse reads everything from the engine's REST API: the engine needs no plugin.

For a server of your own, with modules for your own systems next to Pulse's, start from
Miragon/pulse-starter: [Build your own server](build-your-own.md).
