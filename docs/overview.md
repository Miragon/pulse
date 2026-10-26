# Overview

Pulse, part of the [Miragon AI](https://miragon.ai/) family, lets you see and operate what your
Camunda 7, CIB seven and Operaton engines are running. It reaches the same engines three ways:

| Client                       | For                                       | Start                                       |
| ---------------------------- | ----------------------------------------- | ------------------------------------------- |
| [MCP server](./mcp/index.md) | Claude, ChatGPT and other AI chats        | [Getting started](./mcp/getting-started.md) |
| [CLI](./cli/index.md)        | your shell, scripts, CI and coding agents | [Getting started](./cli/getting-started.md) |
| [VS Code](./vscode/index.md) | developers next to their models and code  | [Installation](./vscode/installation.md)    |

The VS Code extension is an early version and not on the Marketplace yet.

## What they share

- **The engines.** Operaton, CIB seven and Camunda 7 over their REST API (`/engine-rest`).
  The CLI and the extension read the same project file, `.pulse-cli.json`.
- **Read first.** The server boots read-only, the CLI previews and asks before a write, the
  extension writes only on local engines unless you allow more.
- **One release.** All three ship with every Pulse release, the same version number:
  the image `ghcr.io/miragon/pulse-server`, the npm package `@miragon/pulse-cli` and the
  extension `pulse-vscode`.
