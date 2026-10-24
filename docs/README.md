# Pulse docs

Pulse is the MCP server from this repo, part of the [Miragon AI](https://miragon.ai/) family. It
lets Claude, ChatGPT or any other MCP client read and operate your Camunda 7, CIB seven and Operaton
engines, with answers as widgets in the chat. Commands and configs call the server `pulse`.

| Page                                  | What it covers                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------ |
| [Getting started](getting-started.md) | Connect your Claude to the public playground, then run the server on your own engine |
| [Usage](usage.md)                     | Connect an assistant, what to ask, your own settings                                 |
| [Architecture](architecture.md)       | The server, its two modules and the systems they talk to                             |
| [Developer guide](developer.md)       | Run the stack from source and build your own server on the published modules         |
| [Operations](operations.md)           | The Docker image, security, environment variables, toolsets, health routes and CI    |
| [CLI](cli/index.md)                   | The command line interface: install, commands, configuration, AI agents              |

The pages build into a VitePress site, published at
[miragon.github.io/pulse](https://miragon.github.io/pulse/) from `main`. Run
`pnpm docs:dev` for a local preview. This file is the index for reading them on GitHub and is not
part of the site. The root [`README.md`](../README.md) is the full reference for every tool,
toolset and environment variable. The product page is
[miragon.ai/tools/pulse](https://miragon.ai/tools/pulse/).
