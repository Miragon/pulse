# Developing @miragon/pulse-engine-connector

The **engine module** for [Pulse](../../../../README.md): Camunda 7 / CIB seven BPM operations as
`engine_*` MCP tools, plus the interactive cockpit widgets (MCP Apps). Built on
[`@miragon/pulse-engine-client`](../engine-client), `@miragon/pulse-ui`,
`@miragon/pulse-widget-shell` and [`@miragon/pulse-engine-core`](../engine-core), the
workflow domain pulse-cli runs too, which this module runs over its client. The server loads it as
`engine` via `engineModule` (`src/module.ts`), which conforms structurally to the app's
`ModuleDefinition` port. Setup and the repository's bar: [CONTRIBUTING.md](../../../../CONTRIBUTING.md).

## Where the parts live

- **Operations tools** (`src/tools/`): one file per domain (`process-instances`, `tasks`,
  `incidents`, `jobs`, `history`, …), registered through `createToolRegistrar`.
- **Read composites** (`src/lib/core-adapter/composites.ts`): `engine_inspect_process_instance` and
  `engine_status` run `@miragon/pulse-engine-core` over the client.
- **The view** (`src/widget-tools/cockpit.ts`): `engine_open_cockpit` and the app-only `*_data`
  feeds derive from the feeds (`src/data/feeds.ts`: name, description, input and read) and one
  route descriptor (`src/data/routes.ts`: the ids each route needs and takes, its start data and
  its facts).
- **Widgets** (`src/widgets/`): the cockpit app and its routes; `src/widgets/views.tsx` maps the
  tool to the cockpit.
- **Multi-engine routing** (`src/lib/engine/`): `withEngine` / `resolveEngine`.
- **Engine providers** (`src/engine-provider.ts`, `src/providers/`).
- **Toolsets** (`src/lib/mcp/toolsets.ts`): `read-only` / `operations` / `admin`, the module's
  `toolsets` vocabulary.

## Adding a tool or widget

This module has strict house patterns: read the
[`add-bpm-feature`](../../../../.claude/skills/add-bpm-feature) skill and the architecture invariants in
[`CLAUDE.md`](../../../../CLAUDE.md) before adding tools, schemas, or widgets. In short: input schemas live
in `src/schemas/` next to the tools, the pure engine rules in
[`@miragon/pulse-engine-core`](../engine-core), tools register via the registrar (never a raw
`server.registerTool()`), and a view is a cockpit route (its section, its builder and `*_data` feed, its
start view), never a second view tool: see the add-bpm-feature skill.

## Layout

| Path                     | Contents                                                                                                                                                   |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/tools/`             | Registrar operations tools, one file per domain (`index.ts` wires them)                                                                                    |
| `src/schemas/`           | The tools' Zod input schemas and the one paging definition                                                                                                 |
| `src/widget-tools.ts`    | `engine_open_cockpit` and the `*_data` feeds (`src/widget-tools/`)                                                                                         |
| `src/data/`              | One builder per cockpit route; `feeds.ts` (the `*_data` feeds), `routes.ts` (the routes)                                                                   |
| `src/widgets/`           | The cockpit app, its routes and widgets + `views.tsx`                                                                                                      |
| `src/tool-names.ts`      | Tool-name constants for rename-safe in-widget feed calls                                                                                                   |
| `src/lib/engine/`        | Engine routing (`with-engine.ts`, `resolve-engine.ts`), cockpit links, passthrough auth                                                                    |
| `src/lib/core-adapter/`  | engine-core's port over the client (and engine-core's 404 rule applied to the client's errors, `noneIfMissing`), the read composites, `workflow-errors.ts` |
| `src/lib/bpmn/`          | The definition XML read, BPMN and task-form reading, completing a user task by its form                                                                    |
| `src/lib/mcp/`           | The tool surface: `toolsets.ts`, the paging envelope, variable and failure-text bounds                                                                     |
| `src/lib/shared/`        | Pure code the widgets run too (engine environments, `TaskCompletion`); the one lib widgets use                                                             |
| `src/module.ts`          | `engineModule` (config schema, env mapping) + `createBpmnXmlFetcher` (the tools' engine precedence and clients)                                            |
| `src/engine-provider.ts` | The vendor provider port (`EngineProvider`, `CockpitRef`)                                                                                                  |
| `src/providers/`         | `cibseven` / `operaton` / `camunda7` providers (cockpit routes, branding)                                                                                  |

## Verify

`pnpm typecheck` is the **only** check that type-checks the widget `.tsx` (via
`tsconfig.widgets.json`). Widgets render only manually through the MCP Inspector `pnpm dev` starts; see the [developer guide](../../../../docs/mcp/developer.md).
