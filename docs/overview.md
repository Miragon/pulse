# Overview

Pulse lets you see and operate what your
Camunda 7, CIB seven and Operaton engines are running. It reaches the same engines three ways:

| Client                       | For                                       | Start                                       |
| ---------------------------- | ----------------------------------------- | ------------------------------------------- |
| [MCP server](./mcp/index.md) | Claude, ChatGPT and other AI chats        | [Getting started](./mcp/getting-started.md) |
| [CLI](./cli/index.md)        | your shell, scripts, CI and coding agents | [Getting started](./cli/getting-started.md) |
| [VS Code](./vscode/index.md) | developers next to their models and code  | [Installation](./vscode/installation.md)    |

The VS Code extension is an early version, published on the
[Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=miragon-gmbh.pulse-cockpit) and [Open VSX](https://open-vsx.org/extension/miragon-gmbh/pulse-cockpit).

## What they share

- **The engines.** Operaton, CIB seven and Camunda 7 over their REST API (`/engine-rest`).
  The CLI and the extension read the same project file, `.pulse.json`.
- **Read first.** The server boots read-only, the CLI previews and asks before a write, the
  extension writes only on local engines unless you allow more.
- **One look.** The MCP widgets and the VS Code panels use the same words for a count, the same
  tone for a situation and the same formatters for a date, a duration, a count and an id, each
  with screens of its own: [Parity with the MCP cockpit](./vscode/parity.md) says what differs
  and why.
- **One release.** All three ship with every Pulse release, the same version number:
  the image `ghcr.io/miragon/pulse-server`, the npm package `@miragon/pulse-cli` and the
  extension `pulse`.
