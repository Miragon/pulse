---
name: mcp-apps-builder
description: Where to look before changing MCP server code in this repo (tools, resources, prompts, widgets, auth). Points to the house skills, the CLAUDE.md invariants, widget-shell's view runtime and the mcp-use typings; it teaches no framework API itself.
---

# MCP server work in this repo

This repo runs `mcp-use@2.12.2`; what Pulse adds on the server (registrar, tool errors, view
meta, server i18n, caller identity) lives in `@miragon/pulse-widget-shell/server`, the UI in
`@miragon/pulse-ui`. Generic mcp-use examples often use APIs this repo does not
(`server.uiResource()`, the `text()`/`widget()` response helpers, `server.proxy()`, the 1.x
widget hook, hand-stamped `_meta.ui`). Read these instead, in this order:

1. **The root `CLAUDE.md`**: the architecture invariants. Tools go through the
   registrar, engine access through `withEngine`, a view through the module's
   view map under its view tool's name (invariant 3), feeds through
   `buildDataFeedResult`, and there is no federation in this server.
2. **The house skill for the change:**
   - `add-bpm-feature`: an engine tool, a cockpit route, a `*_data` feed or a
     widget.
   - `add-analytics-feature`: a PromQL query, an analytics tool or a dashboard
     widget.
3. **widget-shell's view runtime** (`packages/core/widget-shell/README.md`) for
   everything a widget does: the bundle root, the view host seam, the query
   hooks and `TestViewHost`; its UI comes from the design kit
   (`packages/core/ui/README.md`). Widgets never import `mcp-use/react`. The
   server half (the registrar, `showToolBinding`,
   the server i18n) is in the same README, under `./server`.
4. **mcp-use itself** ([github.com/mcp-use/mcp-use](https://github.com/mcp-use/mcp-use)):
   read the 2.x typings in `node_modules/mcp-use` before you trust an example
   from the web.

Where an mcp-use example and the house skills disagree, the house skills win.

A user-visible change (env vars, tools, ports, getting-started steps) updates the Pulse docs
in `docs/` in the same PR; they build into the site https://miragon.github.io/pulse/
(`pnpm docs:build` fails on a dead link). The product page https://miragon.ai/tools/pulse/ is
built from Miragon/miragon-ai-docs; a change it shows needs a PR there too.
