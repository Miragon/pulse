# Pulse architecture

Pulse is a single Node.js MCP server that exposes Camunda 7 / CIB seven operations and Camunda 8
boards to any MCP host (Claude, ChatGPT, …) and to a browser, read from each engine's own API.

## At a glance

```mermaid
flowchart LR
  Host[MCP Host<br/>Claude · ChatGPT] -->|MCP / HTTP| Server[MCP Server<br/>:8400]

  subgraph Modules
    EngineModule[engine<br/>tools + widgets]
  end

  Server --> EngineModule

  EngineModule -->|REST| Engine[(Camunda 7 / CIB seven<br/>Camunda 8 on boards)]

  Server -. serves .-> Widgets[Widget bundle<br/>React + Tailwind]
```

## Modules

| Module                                                      | Role                                                                                                                                                                                                                                       |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **MCP Server** (`apps/mcp-server/`)                         | Hosts the HTTP transport on port `8400` on the official MCP TypeScript SDK, loads modules from `MCP_ACTIVE_MODULES`, and serves the Vite-built React widget bundle (see **widgets**).                                                      |
| **CLI** (`apps/cli/`)                                       | Every engine REST operation as a command, generated from the OpenAPI spec, plus the workflow commands; on npm, Homebrew, GHCR and the GitHub release. See the [CLI docs](../cli/index.md); rules in `apps/cli/CLAUDE.md`.                  |
| **Pulse for VS Code** (`apps/vscode/`)                      | Shows what an engine runs next to the BPMN models in VS Code: the runtime view (`packages/core/runtime-view`, a React webview on pulse-ui over the engine contract) and the C7 and C8 adapters. A .vsix; rules in `apps/vscode/CLAUDE.md`. |
| **Pulse for Orca** (`apps/orca/`)                           | The same runtime view and C7 and C8 adapters in Orca's editor tabs and a Pulse panel; an Orca plugin, rules in `apps/orca/CLAUDE.md`.                                                                                                      |
| **Web app** (`apps/web/`)                                   | The server's views as pages under `/app` for a browser signed in through the server's OAuth provider, read-only; how it signs in and calls `/mcp`: [How the web app works](../web/architecture.md).                                        |
| **engine** (`packages/connectors/engine/engine-connector/`) | Wraps the Camunda 7 REST API via an OpenAPI-generated client. Exposes process, task, incident, deployment, and history tools plus widgets, and the [boards](boards.md) of `ENGINE_BOARDS_DIR`, over [Camunda 8](camunda8.md) too.          |
| **widgets** (`apps/mcp-server/dist/mcp-app.js` + `.css`)    | One Vite-built ES module + stylesheet containing React, Tailwind, and every widget. The server serves it behind one `ui://views/<tool>.html` resource per widget tool, which declares that view on itself (`showToolBinding`).             |

## Composition rules

- Three axes keep a second engine dialect and a second interface cheap. Engine _vendors_ (CIB seven,
  Operaton, Camunda 7) are per-engine runtime configuration (`flavor` on the engine entry, resolved
  to an `EngineProvider` carrying only the real differences: its dialect, cockpit routes, branding,
  client hook), never packages or apps. A _dialect_ (an engine API family: Camunda 7, and Camunda 8
  on the server's boards and in the editors) is one package family under
  `packages/connectors/<dialect>/` (`c7`, `c8`). A family is one source the server reads, a dialect
  or another source (a metrics store, say): its client, its core when its interfaces share a pure
  domain and, for a source that is no dialect, its connector (the MCP module). A package two
  interfaces share is extracted on its second consumer into the family's core, like
  `@miragon/pulse-c7-core`, the core of the Camunda 7 REST dialect family that the CLI bundles, the
  C7 adapter and the engine connector run (one port per API family; it names no command, flag or
  tool). `packages/core/` holds what every family builds on, never one family's code. The family
  `engine` is the neutral layer: one MCP server app, the thin composition root `apps/mcp-server`,
  and one module (`packages/connectors/engine/engine-connector`) serve every dialect, and its core
  (`packages/connectors/engine/engine-core`) is the contract each dialect implements. An _interface_
  is an app: the MCP server, the web app it serves, the CLI, Pulse for VS Code and Pulse for Orca.
- Modules are peers: connector packages (`*-connector`) never import each other, and what one module
  needs of another the app injects through `shared`, the port for what a composition's modules share
  (`SharedResources` in `apps/mcp-server/src/setup.ts`; empty today).
- Modules are self-contained. Each exports a module definition: config schema, env mapping,
  known env vars, toolset vocabulary, boot warnings, plugin factory
  (`packages/connectors/<family>/<family>-connector/src/module.ts`). A plugin is a name plus a
  `register(server)` that puts the module's tools, prompts and resources on the one server the
  shared boot builds; the boot refuses a name or resource URI two modules register. The app only
  lists its modules and wires what they share (`apps/mcp-server/src/setup.ts`); the shared boot
  selects the modules (`MCP_ACTIVE_MODULES`), installs OAuth from the env and resolves one
  fail-closed toolset per module per boot (a module with toolsets: read-only unless widened) and
  logs it. The module packages are published to npm, so external composition roots can mount them
  next to their own modules. The reference is `templates/composed-server/`.
- A view comes from the bundle or from its module. The engine module's views are bundle views
  (an ESLint gate blocks a resource in `packages/connectors/`). A module of yours, on npm say, may
  bring a finished HTML document as its own resource instead: nothing of it enters the bundle, so
  it shares no code with it, gets none of widget-shell's host contexts and states its own CSP. The
  boot keeps `ui://views/` for the bundle and fails on a tool that binds a resource nobody serves.
- The MCP server app owns no domain UI. Widgets live in packages: `pulse-ui` carries the design kit,
  `widget-shell` the view runtime; each module carries its own and renders no other module's widget.
  A view that composes modules goes in a dedicated package, created with the first real one.
- One profile format. `@miragon/pulse-profile` (`packages/core/profile`) is the one format of the
  engine profiles of the CLI, Pulse for VS Code, Pulse for Orca and the server: it takes a file's
  text, returns a verdict per profile as data, reads no file or environment, imports nothing, and
  lets an interface state what it serves (`refusalsOn`), so a key is applied or refuses a profile.
- One transport. `@miragon/pulse-http` (`packages/core/http`) is the one HTTP client of the engine
  connector, the CLI and the editors' C7 and C8 adapters (each Camunda 8 wire with its OAuth
  client): a deadline to the last byte, no redirect, a 64 MiB cap (none in the CLI), one retry after
  a 401, failure reasons as data, masked secrets; every wiring passes `TRANSPORT_CASES`.
- One engine contract: `@miragon/pulse-engine-core` holds the ports, read models, laws and shared
  rules (`RootCauses`) of every dialect; the runtime view and its two editor hosts, c7-core and
  c8-core, the C7 and C8 adapters, the board builder and the engine connector's server layers
  (`runtimeOf`, a runtime per dialect for the boards) use it, the CLI through c7-core.
- Extract on the second consumer, never speculatively: a second dialect joins the engine module
  (`ENGINE_DIALECTS`), never with a widget package or an MCP server app of its own.

## Views and hosts

A widget never talks to its host. It reads host-agnostic contexts from widget-shell's view
runtime (`useViewHost` for tool calls and hand-offs, the theme, locale, display mode and height
budget), and an adapter fills them: in a chat the MCP Apps adapter over the official `App` of
`@modelcontextprotocol/ext-apps`, by an ESLint gate the only code that imports its view runtime,
on a page the browser adapter of `mountPage`. `TestViewHost` fills them in tests and publishes the
formatters' locale as the view root does, so a widget test reads the same on every machine.

The MCP Apps host is one host among several: the web app shows the same components through
`mountPage` (a caller for the server's tools from the page; a hand-off hidden or offering its prompt
to copy, since a page posts into no chat; no write control and no call of the write gate, since a
page writes to no engine). The widgets read the Camunda 7 REST family's data, a board's tiles its
JSON form, which the board builder makes over engine-core from either dialect.

## What the UIs share

By the owner's decision of 2026-11-12, Pulse's UIs become one family, React on `@miragon/pulse-ui`
in one compact look: the MCP widgets, a starter's and the web app of
[#573](https://github.com/Miragon/pulse/issues/573) with widget-shell, and the runtime view's
webview (Pulse for VS Code and Pulse for Orca) without it, which has no host adapter, never renders
a widget and moved from Preact to React on pulse-ui in one switch. They share a core up to
building blocks: the formats (the board file first), pulse-ui's framework-free
`@miragon/pulse-ui/tones` (`SITUATION_TONES`) and `@miragon/pulse-ui/format`, from
`@miragon/pulse-ui/testing` the product glossary, the count words and the brand gates, the engine
rules of c7-core, the numbers of a feature several show (boards first: one builder over one read)
and building blocks on React with props and callbacks only (`@miragon/pulse-blocks`, a board's
tiles). Each keeps its own screens and host wiring: six cockpit views and a board have a
counterpart in the editors, and [Parity with the MCP cockpit](../vscode/parity.md) lists what still
differs. The decisions are in `apps/vscode/docs/adr/ui-foundation.md`.

## External systems

| System                | Purpose                                                                  | Default endpoint                     |
| --------------------- | ------------------------------------------------------------------------ | ------------------------------------ |
| Camunda 7 / CIB seven | The BPM engine itself: process definitions, instances, tasks, incidents. | `http://localhost:8410/engine-rest`  |
| Camunda 8             | A cluster's REST API and its token endpoint, read for boards.            | the profile's `url`, ending in `/v2` |

## Data flow

1. The MCP host calls a tool on the server (e.g. `engine_status`).
2. The server delegates to the matching module's plugin.
3. The plugin calls the engine's REST API and returns JSON for the model.
4. A view tool (the engine module's `open_cockpit`) returns the view's data as `structuredContent`
   and its model-facing result (the facts as compact JSON) as `content`; the host renders it in
   the tool's view, which the shared bundle picks by the tool's name (re-running the tool once
   where a host drops `structuredContent`). Inside the view, app-only `*_data` feeds refresh and
   page it without a model turn.
5. A board (`view` `board`): the app-only `engine_board_data` builds a file of `ENGINE_BOARDS_DIR`
   with `@miragon/pulse-board`'s builder over each engine it names (`runtimeOf`: `C7Runtime` or
   `C8Runtime`), kept 30 s per caller; the cockpit draws its JSON with `@miragon/pulse-blocks`.

## Repository layout

| Path                   | Description                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `apps/mcp-server/`     | The MCP server entry point and the widget bundle.                                                                   |
| `packages/core/`       | What every family builds on: widget-shell, pulse-ui, profile, board format and builder, building blocks, transport. |
| `packages/connectors/` | One folder per family: the neutral `engine` (module, core), one per dialect (`c7`, `c8`).                           |
| `playground/`          | Demo env: showcases, Compose stack, Fly.io deployment.                                                              |

For deeper detail, [Reference](reference.md) lists every tool and toolset.
