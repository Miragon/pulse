# @miragon/pulse-camunda7-connector

[![npm](https://img.shields.io/npm/v/@miragon/pulse-camunda7-connector?style=flat-square)](https://www.npmjs.com/package/@miragon/pulse-camunda7-connector)
[![CI](https://img.shields.io/github/actions/workflow/status/Miragon/pulse/ci.yml?style=flat-square&label=ci)](https://github.com/Miragon/pulse/actions/workflows/ci.yml)
[![Docs](https://img.shields.io/badge/docs-miragon.github.io%2Fpulse-335DE5?style=flat-square)](https://miragon.github.io/pulse/)

Operate Camunda 7, CIB seven and Operaton engines from any MCP host: the `camunda7_*` tools and the
interactive views that show incidents, instances and diagrams right in the chat.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Miragon/pulse/main/docs/assets/widget-incident-dark.png">
  <img alt="The incident view of this module: a failed payment task with its error message, a retry button and the process diagram with the failing step marked" src="https://raw.githubusercontent.com/Miragon/pulse/main/docs/assets/widget-incident.png">
</picture>

## Install

```sh
npm install @miragon/pulse-camunda7-connector @miragon/pulse-widget-shell
npm install react react-dom zod lucide-react bpmn-js@18.31.0 @miragon/mcp-toolkit-core @miragon/mcp-toolkit-ui mcp-use@2.7.3
```

To build your own MCP server on it, start from [pulse-starter](https://github.com/Miragon/pulse-starter).

## Overview

The **camunda7 module** for [Pulse](../../../../README.md): Camunda 7 / CIB Seven BPM operations as
`camunda7_*` MCP tools, plus the interactive cockpit widgets (MCP Apps). Built on
[`@miragon/pulse-camunda7-client`](../camunda7-client) and the `@miragon/mcp-toolkit-*` packages.

The server loads this module as `camunda7` via `camunda7Module` (`src/module.ts`), which conforms
structurally to the app's `ModuleDefinition` port. The package is published to npm in lockstep with
the other `@miragon/pulse-*` packages (pin them all to one version); the
[pulse-starter](https://github.com/Miragon/pulse-starter) template shows how to compose it
into your own MCP server.

The consumer-shared libraries are ranged **peer dependencies** so they dedupe against your app's
copy: `react`/`react-dom` `^19.2.0`, `zod` `^4.4.0`, `@miragon/mcp-toolkit-*` `~2.8.1`,
`lucide-react` `^0.562.0 || ^1.0.0` (the widgets' icons; add it to your `dedupe` list like the
widget-shell kit asks, and pin 1.47.0 or newer: the toolkit's chrome (2.7 and later) imports `LucideProvider`,
which 0.x lacks, so a deduped 0.x copy fails the bundle build). **`mcp-use` is exactly pinned**:
pin it to `mcp-use@2.7.3` in your app. A duplicate `mcp-use` instance breaks the React context and
hangs every in-widget query on "Loading…".

## What it provides

- **Operations tools** (`src/tools/`): one file per domain (`process-instances`, `tasks`,
  `incidents`, `jobs`, `history`, …), registered through `createToolRegistrar`. Plain JSON for the
  model.
- **Widget tools** (`src/widget-tools.ts`): `show_*` tools that render a cockpit widget for the user
  and return a compact summary for the model, plus app-only `*_data` feeds for in-widget refresh and
  navigation.
- **Widgets** (`src/widgets/`): React components (cockpit dashboard, process & incident panels, BPMN
  viewer, history timeline, job panel) wired in `registry.ts` via `adaptDataWidget`.
- **Multi-engine routing:** every tool resolves its engine through `withEngine` / `resolveEngine`
  (`src/lib/`): per-call override → saved default engine (profile) → single configured default.
- **Engine providers** (`src/engine-provider.ts`, `src/providers/`): each engine entry carries a
  vendor `flavor` (`cibseven` | `operaton` | `camunda7`, default `camunda7`; the `CAMUNDA_BASE_URL`
  shorthand takes `CAMUNDA_ENGINE_FLAVOR`) resolved to an `EngineProvider` holding only the real
  vendor differences: cockpit routes, branding, client hook. Mixed-vendor fleets run in one server.
- **Toolsets, fail-closed:** `src/lib/toolsets.ts` declares `read-only` / `operations` / `admin` as
  the module's `toolsets` vocabulary. With no `camunda7:<toolset>` suffix the module runs
  `read-only` on an unauthenticated server and `operations` under OAuth; an empty or unknown suffix
  falls back to `read-only`. `admin` (delete/modify/suspension, migrations, batch retries,
  `throw_signal` (engine-wide), the external-task worker protocol (`fetch_and_lock`,
  `complete_external_task`, `handle_external_task_failure`) and deployments) is never implied;
  `camunda7_list_external_tasks` is the read-only view of external tasks. Widget action buttons
  render only for tools the toolset registers.
- **Deployments are opt-in:** `camunda7_create_deployment` is registered only with
  `CAMUNDA_ALLOW_DEPLOYMENTS=true` (strict `true`/`false` after trimming, empty = unset, anything else fails the boot) on top of
  `camunda7:admin`: deploying a BPMN/DMN is code execution inside the engine JVM (JUEL expressions,
  scripts). The full camunda7 surface of earlier releases is `camunda7:admin` plus that flag.

## Adding a tool or widget

This module has strict house patterns: read the
[`add-bpm-feature`](../../../../.claude/skills/add-bpm-feature) skill and the architecture invariants in
[`CLAUDE.md`](../../../../CLAUDE.md) before adding tools, schemas, or widgets. In short: input schemas live
in [`@miragon/pulse-camunda7-client`](../camunda7-client), tools register via the registrar (never raw
`server.tool()`), and a widget must be wired across all four registration links.

## Layout

| Path                     | Contents                                                                  |
| ------------------------ | ------------------------------------------------------------------------- |
| `src/tools/`             | Registrar operations tools, one file per domain (`index.ts` wires them)   |
| `src/widget-tools.ts`    | `show_*` widget tools and `*_data` feeds                                  |
| `src/widgets/`           | React widgets + `registry.ts` (component → dataType)                      |
| `src/definition.ts`      | Widget metadata (`id`, `requires`, `size`, `propsSchema`)                 |
| `src/tool-names.ts`      | Tool-name constants for rename-safe in-widget navigation                  |
| `src/lib/`               | `with-engine.ts` (engine routing), `cockpit-url.ts`, `toolsets.ts`        |
| `src/module.ts`          | `camunda7Module` (config schema, env mapping) + `createBpmnXmlFetcher`    |
| `src/engine-provider.ts` | The vendor provider port (`EngineProvider`, `CockpitRef`)                 |
| `src/providers/`         | `cibseven` / `operaton` / `camunda7` providers (cockpit routes, branding) |
| `src/steps/`             | Pipeline steps contributed to the server                                  |

## Verify

`pnpm typecheck` is the **only** check that type-checks the widget `.tsx` (via
`tsconfig.widgets.json`). Widgets render only manually through the inspector; see the root README.
