# Overview

Pulse lets you see and operate what your
Camunda 7, CIB seven and Operaton engines are running. It reaches the same engines five ways:

| Client                       | For                                       | Start                                       |
| ---------------------------- | ----------------------------------------- | ------------------------------------------- |
| [MCP server](./mcp/index.md) | Claude, ChatGPT and other AI chats        | [Getting started](./mcp/getting-started.md) |
| [Web app](./web/index.md)    | people without an AI chat, in a browser   | [Set up the sign-in](./web/sign-in.md)      |
| [CLI](./cli/index.md)        | your shell, scripts, CI and coding agents | [Getting started](./cli/getting-started.md) |
| [VS Code](./vscode/index.md) | developers next to their models and code  | [Installation](./vscode/installation.md)    |
| [Orca](./orca/index.md)      | developers in Orca, next to their models  | [Installation](./orca/installation.md)      |

The VS Code extension and the Orca plugin are early versions, built from one runtime view. The
extension is published on the
[Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=miragon-gmbh.pulse-cockpit) and [Open VSX](https://open-vsx.org/extension/miragon-gmbh/pulse-cockpit),
the Orca plugin is not in [Miragon's Orca catalog](https://github.com/Miragon/orca-plugins)
yet: until then you [load it from the source](./orca/installation.md#from-the-source).

## What they share

- **The engines.** Operaton, CIB seven and Camunda 7 over their REST API (`/engine-rest`); the
  extension and the Orca plugin also read [Camunda 8](./vscode/camunda8.md) from 8.9 on, without
  writing, the web app too, and the chat shows it [on boards](./mcp/camunda8.md). The CLI, the
  extension and the Orca plugin read the same project file, `.pulse.json`.
- **Read first.** The server boots read-only, the web app only reads, the CLI previews and asks
  before a write, the extension and the Orca plugin write only on local engines unless you allow
  more.
- **One look.** The MCP widgets and the panels of the extension and the Orca plugin use the same
  words for a count, the same tone for a situation and the same formatters for a date, a
  duration, a count and an id, each with screens of its own:
  [Parity with the MCP cockpit](./vscode/parity.md) says what differs and why.
- **Boards.** One board file shows the same tiles and numbers in the extension, the Orca plugin,
  the MCP server's cockpit and the web app ([in the editors](./vscode/boards.md),
  [in the chat and on the web](./mcp/boards.md)).
- **One release.** All five carry the same version number, and every Pulse release ships the
  image `ghcr.io/miragon/pulse-server` (the server with the web app), the npm package
  `@miragon/pulse-cli` and the extension `pulse`; the Orca plugin `miragon.pulse-cockpit` follows
  once Miragon's catalog lists it.
