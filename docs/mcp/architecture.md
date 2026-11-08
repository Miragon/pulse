# Pulse architecture

Pulse is a single Node.js MCP server that exposes Camunda 7 / CIB seven
operations to any MCP host (Claude, ChatGPT, …). Everything it shows, the figures of its views
included, it reads from the engine's REST API.

## At a glance

```mermaid
flowchart LR
  Host[MCP Host<br/>Claude · ChatGPT] -->|MCP / HTTP| Server[MCP Server<br/>:8400]

  subgraph Modules
    EngineModule[engine<br/>tools + widgets]
  end

  Server --> EngineModule

  EngineModule -->|REST| Engine[(Camunda 7 / CIB seven)]

  Server -. serves .-> Widgets[Widget bundle<br/>React + Tailwind]
```

## Modules

| Module                                                      | Role                                                                                                                                                                                                                           |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **MCP Server** (`apps/mcp-server/`)                         | Hosts the HTTP transport on port `8400` on the official MCP TypeScript SDK, loads modules from `MCP_ACTIVE_MODULES`, and serves the Vite-built React widget bundle (see **widgets**).                                          |
| **CLI** (`apps/cli/`)                                       | Every engine REST operation as a command, generated from the OpenAPI spec, plus the workflow commands; on npm, Homebrew, GHCR and the GitHub release. See the [CLI docs](../cli/index.md); rules in `apps/cli/CLAUDE.md`.      |
| **VS Code extension** (`apps/vscode/`)                      | Shows what an engine runs next to the BPMN models in VS Code: a Preact webview over an engine-neutral contract and the C7 adapter. Ships as a .vsix on the Marketplace and Open VSX; rules in `apps/vscode/CLAUDE.md`.         |
| **engine** (`packages/connectors/engine/engine-connector/`) | Wraps the Camunda 7 / CIB seven REST API via an OpenAPI-generated client. Exposes process, task, incident, deployment, and history tools plus widgets.                                                                         |
| **widgets** (`apps/mcp-server/dist/mcp-app.js` + `.css`)    | One Vite-built ES module + stylesheet containing React, Tailwind, and every widget. The server serves it behind one `ui://views/<tool>.html` resource per widget tool, which declares that view on itself (`showToolBinding`). |

## Composition rules

A small set of layering rules keeps modules independently usable and a future
second engine dialect cheap:

- Three axes keep a second engine dialect and a second interface cheap. Engine
  _vendors_ (CIB seven, Operaton, Camunda 7) are per-engine runtime configuration
  (`flavor` on the engine entry, resolved to an `EngineProvider` carrying only the
  real differences: cockpit routes, branding, client hook), never packages or apps.
  A _dialect_ (an engine API family: Camunda 7 today, Flowable would be another) is
  one package family under `packages/connectors/<family>/`. A family is one source the
  server reads, a dialect or another source (a metrics store, say): its client,
  its connector (the MCP module) and, when its interfaces share a pure domain, its core.
  A package two interfaces share is extracted on its second consumer into the family's core,
  like `@miragon/pulse-engine-core`, the Camunda 7 family's workflow domain that the CLI and
  the VS Code extension's C7 adapter bundle and the engine connector runs over its client
  (one port per API family; it names
  no command, flag or tool). `packages/core/` holds what every family builds on, never one
  family's code. An
  _interface_ is an app:
  `apps/mcp-server` is the thin composition root of the Camunda-7-dialect
  MCP server (the engine module); a different dialect gets a family and an MCP server app
  named after it.
  The CLI (`apps/cli`) and the VS Code extension (`apps/vscode`) are interfaces of their own.
- Modules are peers. Connector packages (`*-connector`) never import each other. What one
  module needs of another the app injects through `shared` (`SharedResources` in
  `apps/mcp-server/src/setup.ts`), the port for what the modules of a composition share; today
  the app hands nothing through.
- Modules are self-contained. Each exports a module definition: config schema, env mapping,
  known env vars, toolset vocabulary, boot warnings, plugin factory
  (`packages/connectors/<family>/<family>-connector/src/module.ts`). A plugin is a name plus a
  `register(server)` that puts the module's tools, prompts and resources on the one server the
  shared boot builds; the boot refuses a name or resource URI two modules register. The app only lists its modules and wires
  what they share (`apps/mcp-server/src/setup.ts`); the shared boot selects the
  modules (`MCP_ACTIVE_MODULES`), installs OAuth from the env and resolves one fail-closed
  toolset per module per boot (a module with toolsets: read-only unless widened) and logs it.
  The module packages are published to npm, so external composition roots can mount them next
  to their own modules. The reference is `templates/composed-server/`.
- A view comes from the bundle or from its module. The engine module's views are bundle views
  (an ESLint gate blocks a resource in `packages/connectors/`). A module of yours, on npm say, may
  bring a finished HTML document as its own resource instead: nothing of it enters the bundle, so
  it shares no code with it, gets none of widget-shell's host contexts and states its own CSP. The
  boot keeps `ui://views/` for the bundle and fails on a tool that binds a resource nobody serves.
- The MCP server app owns no domain UI. Widgets live in packages: `pulse-ui`
  carries the design kit, `widget-shell` the view runtime;
  each module carries its own and renders no other module's widget. A view that composes
  modules goes in a dedicated package, created with the first real one.
- Extract on the second consumer, never speculatively. A composed-views
  package appears with the first cross-module view, a shared domain-widget
  package with a second dialect, a host-kit with a second MCP server app.

## Views and hosts

A widget never talks to its host. It reads host-agnostic contexts from widget-shell's view
runtime (`useViewHost` for tool calls and hand-offs, the theme, locale, display mode and height
budget), and one adapter fills them: today the MCP Apps adapter over the official `App` of
`@modelcontextprotocol/ext-apps`, the only code that imports its view runtime (an ESLint gate
keeps it so). `TestViewHost` fills the same contexts in tests.

The MCP Apps host is therefore one host among several possible ones. A web app that shows the
same React components brings an adapter of its own and leaves the widgets as they are. The engine
module's widgets still read the Camunda 7 REST family's data, though: components that serve
another engine such as Camunda 8 need an engine-neutral contract first, as the VS Code extension
keeps one for its webview (`apps/vscode`), and that is a design question of its own.

## Two UI families

Pulse's UIs come in two families. React on `@miragon/pulse-ui` and widget-shell: the MCP widgets,
a starter's widgets and the web apps of [#573](https://github.com/Miragon/pulse/issues/573).
Preact with components and stylesheets of its own: the VS Code extension's webview, which has no
host adapter and never renders a widget. The two share pulse-ui's foundation, never a component:
the framework-free `@miragon/pulse-ui/tones` (one tone per situation, `SITUATION_TONES`) and
`@miragon/pulse-ui/format` (dates, durations, counts, short ids), which the extension bundles, and
from `@miragon/pulse-ui/testing` the product glossary, the count words and the brand gates its
tests run. So the same count has the same word, the same situation the same tone and a duration
the same form in both, while each tool shows what its audience needs: six cockpit views have a
counterpart in VS Code, and [Parity with the MCP cockpit](../vscode/parity.md) lists every
difference between them as closed, wanted or open. The decision is
`apps/vscode/docs/adr/ui-foundation.md`; [#586](https://github.com/Miragon/pulse/issues/586)
holds when the two share building blocks again.

## External systems

| System                | Purpose                                                                  | Default endpoint                    |
| --------------------- | ------------------------------------------------------------------------ | ----------------------------------- |
| Camunda 7 / CIB seven | The BPM engine itself: process definitions, instances, tasks, incidents. | `http://localhost:8410/engine-rest` |

## Data flow

1. The MCP host calls a tool on the server (e.g. `engine_status`).
2. The server delegates to the matching module's plugin.
3. The plugin calls the engine's REST API and returns JSON for the model.
4. A view tool (the engine module's `open_cockpit`) returns the
   view's data as `structuredContent` and its model-facing result (the facts as
   compact JSON) as `content`; the host
   renders it in the tool's view, which the shared bundle picks by the tool's
   name (re-running the tool once where a host drops `structuredContent`).
   Inside the view, app-only `*_data` feeds refresh and page it without a model
   turn.

## Repository layout

| Path                   | Description                                                           |
| ---------------------- | --------------------------------------------------------------------- |
| `apps/mcp-server/`     | The MCP server entry point and the widget bundle.                     |
| `packages/core/`       | What every family builds on: widget-shell, pulse-ui.                  |
| `packages/connectors/` | One folder per family: client, connector (MCP plugin), optional core. |
| `playground/`          | Demo env: showcases, Compose stack, Fly.io deployment.                |

For deeper detail, [Reference](reference.md) lists every tool and toolset.
