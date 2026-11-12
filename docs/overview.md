# Overview

Pulse lets you see and operate what your
Camunda 7, CIB seven and Operaton engines are running. It reaches the same engines four ways:

| Client                       | For                                       | Start                                       |
| ---------------------------- | ----------------------------------------- | ------------------------------------------- |
| [MCP server](./mcp/index.md) | Claude, ChatGPT and other AI chats        | [Getting started](./mcp/getting-started.md) |
| [CLI](./cli/index.md)        | your shell, scripts, CI and coding agents | [Getting started](./cli/getting-started.md) |
| [VS Code](./vscode/index.md) | developers next to their models and code  | [Installation](./vscode/installation.md)    |
| [Orca](./orca/index.md)      | developers in Orca, next to their models  | [Installation](./orca/installation.md)      |

The VS Code extension and the Orca plugin are early versions, built from one runtime view. The
extension is published on the
[Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=miragon-gmbh.pulse-cockpit) and [Open VSX](https://open-vsx.org/extension/miragon-gmbh/pulse-cockpit),
the Orca plugin is not in [Miragon's Orca catalog](https://github.com/Miragon/orca-plugins)
yet: until then you [load it from the source](./orca/installation.md#from-the-source).

## What they share

- **The engines.** Operaton, CIB seven and Camunda 7 over their REST API (`/engine-rest`).
  The CLI, the extension and the Orca plugin read the same project file, `.pulse-cli.json`.
- **Read first.** The server boots read-only, the CLI previews and asks before a write, the
  extension and the Orca plugin write only on local engines unless you allow more.
- **One release.** All four carry the same version number, and every Pulse release ships the
  image `ghcr.io/miragon/pulse-server`, the npm package `@miragon/pulse-cli` and the extension
  `pulse`; the Orca plugin `miragon.pulse-cockpit` follows once Miragon's catalog lists it.
