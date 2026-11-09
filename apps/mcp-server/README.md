# Pulse MCP server

[![Server image](https://img.shields.io/badge/image-ghcr.io%2Fmiragon%2Fpulse--server-2496ED?logo=docker&logoColor=white)](https://github.com/Miragon/pulse/pkgs/container/pulse-server)
[![CI](https://github.com/Miragon/pulse/actions/workflows/ci.yml/badge.svg)](https://github.com/Miragon/pulse/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/Miragon/pulse)](../../LICENSE)

![Pulse MCP server by Miragon AI: ask your AI chat why a process is stuck, and get the answer as a view. The card shows the incident view the chat answers with: Charge payment failed because the card expired, with a Retry task button](../../docs/assets/listing/mcp-server/cover.png)

An MCP server, the standard way AI assistants call tools, that answers questions about your
Camunda 7, CIB seven and Operaton engines in Claude, ChatGPT or any other MCP client. Below 1.0:
pin a version tag for anything beyond a first try.

## Why

When an order is stuck, the answer is spread over a cockpit, REST calls and logs. With Pulse you
ask your assistant instead.

## What you get

- **Answers as views.** Incidents, instances, process diagrams and the engine's health render as
  interactive views in the chat, in your host's language and theme.
- **Read-only until you allow more.** Retries, task completion and other changes need a
  [toolset](https://miragon.github.io/pulse/mcp/reference#toolsets) you turn on, or an OAuth login.
- **Your whole fleet.** [Several engines](https://miragon.github.io/pulse/mcp/reference#multi-engine)
  behind one server, with a default engine and an override per question.
- **Process analytics.** KPIs, bottlenecks and engine comparisons from Prometheus, when you run the
  [metrics plugin](../../engine-plugins/README.md).

What you can ask, with example questions: [Usage](https://miragon.github.io/pulse/mcp/usage#what-you-can-ask).

## Get started

Try it on the hosted playground, a seeded CIB seven engine that is read-only and needs no login,
at `https://pulse-playground.miragon.ai/mcp`. In Claude Code:

```sh
claude mcp add --transport http pulse https://pulse-playground.miragon.ai/mcp
```

claude.ai, Claude Desktop, ChatGPT and other hosts add the same URL as [Usage](https://miragon.github.io/pulse/mcp/usage#connect-your-assistant)
shows. Then ask _"Which processes have open incidents right now?"_.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../../docs/assets/widget-incident-dark.png">
  <img alt="Asking why an order is stuck opens the incident view: the payment task failed because the card expired, with a retry button and the process diagram with the failing step marked" src="../../docs/assets/widget-incident.png">
</picture>

## Run it on your own engine

You need Docker and the REST API of your engine (usually `…/engine-rest`). Analytics needs
Prometheus; without it, `MCP_ACTIVE_MODULES=engine` leaves it out:

```sh
docker run --rm -p 127.0.0.1:8400:8400 \
  --add-host=host.docker.internal:host-gateway \
  -e ENGINE_BASE_URL=http://host.docker.internal:8080/engine-rest \
  -e MCP_ACTIVE_MODULES=engine \
  ghcr.io/miragon/pulse-server:latest
claude mcp add --transport http pulse http://localhost:8400/mcp
```

A REST API with a login takes `ENGINE_AUTH_TYPE=basic` with `ENGINE_USERNAME` and
`ENGINE_PASSWORD`. claude.ai and ChatGPT reach only a public HTTPS URL, not `localhost`. More on
links to CIB seven or Operaton and on Docker networks:
[Get started](https://miragon.github.io/pulse/mcp/getting-started#run-it-on-your-own-engine).
Several engines, OAuth and write toolsets: [Operations](https://miragon.github.io/pulse/mcp/operations).
A server of your own, with modules for your own systems: [Build your own server](https://miragon.github.io/pulse/mcp/build-your-own).

## Help and feedback

- **Documentation:** every tool, setting and deployment option is explained at [miragon.github.io/pulse/mcp](https://miragon.github.io/pulse/mcp/).
- **Bugs and ideas:** found a bug or missing something? [Open an issue](https://github.com/Miragon/pulse/issues).

## Contributing

How the server is built and how to run it from source is in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](../../LICENSE) © Miragon GmbH
