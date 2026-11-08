---
name: mcp-apps-builder
description: Where to look before changing MCP server code in this repo (tools, resources, prompts, widgets, auth). Points to the house skills, the CLAUDE.md invariants, widget-shell's view runtime and the official MCP SDK's typings and docs; it teaches no framework API itself.
---

# MCP server work in this repo

This repo builds on the official MCP TypeScript SDK: `@modelcontextprotocol/server` (the server,
`McpServer`, `createMcpHandler`), `@modelcontextprotocol/node` (the Node listener) and the MCP Apps
extension `@modelcontextprotocol/ext-apps` (`registerAppTool` on the server, the `App` in a view).
A module registers on a `ModuleServer`, which is the SDK's own
`registerTool`/`registerPrompt`/`registerResource`, so the SDK's examples apply as they are. What Pulse adds on top (the module contract, the registrar,
toolsets, tool errors, the view and feed bindings, server i18n, caller identity) lives in
`@miragon/pulse-widget-shell/server`, the view runtime in `@miragon/pulse-widget-shell/widgets`,
the UI in `@miragon/pulse-ui`. Read these, in this order:

1. **The root `CLAUDE.md`**: the architecture invariants. Tools go through the
   registrar, engine access through `withEngine`, a view through the module's
   view map under its view tool's name (invariant 3), feeds through
   `buildDataFeedResult`, and there is no federation in this server.
2. **The house skill for the change:**
   - `add-bpm-feature`: an engine tool, a cockpit route, a `*_data` feed or a
     widget.
   - `add-analytics-feature`: a PromQL query, an analytics tool or a dashboard
     widget.
3. **widget-shell's README** (`packages/core/widget-shell/README.md`) for
   everything a widget does: the bundle root, the view host seam, the query
   hooks and `TestViewHost`; its UI comes from the design kit
   (`packages/core/ui/README.md`). Widgets never import `@modelcontextprotocol/ext-apps`:
   only widget-shell's host adapter does. The server half (the module port with
   `ModuleServer`, the registrar, `showToolBinding`, `appOnly`, the server i18n) and the
   module test server (`recordingModuleServer`) are in the same README, under `./server` and
   `./testing`.
4. **The official SDK**: its docs for tools, prompts and the server
   ([ts.sdk.modelcontextprotocol.io/v2](https://ts.sdk.modelcontextprotocol.io/v2/)) and for MCP
   Apps ([apps.extensions.modelcontextprotocol.io/api](https://apps.extensions.modelcontextprotocol.io/api/)).
   Read the typings this repo installs
   (`packages/core/widget-shell/node_modules/@modelcontextprotocol/`) before you trust an
   example from the web: they name the version that runs here.

Where an SDK example and the house skills disagree, the house skills win: a tool's view binding
comes from `showToolBinding`, never a hand-written `_meta.ui`, and the boot serves the view
resources, so a connector registers none (an ESLint gate holds that; a customer's module may bring
a finished HTML view, see widget-shell's README).

A user-visible change (env vars, tools, ports, getting-started steps) updates the Pulse docs
in `docs/` in the same PR; they build into the site https://miragon.github.io/pulse/
(`pnpm docs:build` fails on a dead link). The product page https://miragon.ai/tools/pulse/ is
built from Miragon/miragon-ai-docs; a change it shows needs a PR there too.
