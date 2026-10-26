# Pulse docs

Pulse, part of the [Miragon AI](https://miragon.ai/) family, lets you operate and analyse your
Camunda 7, CIB seven and Operaton engines from your AI chat (the MCP server, with answers as widgets
in the chat), your terminal (the CLI) and VS Code. Commands and configs call the server `pulse`.

| Page                                  | What it covers                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------ |
| [Getting started](getting-started.md) | Connect your Claude to the public playground, then run the server on your own engine |
| [Usage](usage.md)                     | Connect an assistant, what to ask, your own settings                                 |
| [Architecture](architecture.md)       | The server, its two modules and the systems they talk to                             |
| [Developer guide](developer.md)       | Run the stack from source and build your own server on the published modules         |
| [Reference](reference.md)             | Every tool, the toolsets and the common settings                                     |
| [Operations](operations.md)           | The Docker image, security, environment variables, toolsets, health routes and CI    |
| [CLI](cli/index.md)                   | The command line interface: install, commands, configuration, AI agents              |

The pages build into a VitePress site, published at
[miragon.github.io/pulse](https://miragon.github.io/pulse/) from `main`. Run
`pnpm docs:dev` for a local preview. This file is the index for reading them on GitHub and is not
part of the site. The product page is
[miragon.ai/tools/pulse](https://miragon.ai/tools/pulse/).
