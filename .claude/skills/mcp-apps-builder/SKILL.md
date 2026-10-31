---
name: mcp-apps-builder
description: Where to look before changing MCP server code in this repo (tools, resources, prompts, widgets, auth). Points to the house skills, the CLAUDE.md invariants and the toolkit's mcp-use 2 guide; it teaches no framework API itself.
---

# MCP server work in this repo

This repo runs `mcp-use@2.7.3` with `@miragon/mcp-toolkit-*@2.8.1`. The generic
mcp-use skill this file used to vendor taught 1.x APIs (`server.uiResource()`, the
`text()`/`widget()` response helpers, `server.proxy()`, `useWidget`, hand-stamped
`_meta.ui`), so it is gone. Read these instead, in this order:

1. **The root `CLAUDE.md`**: the architecture invariants. Tools go through the
   registrar, engine access through `withEngine`, widgets through the three-link
   chain, feeds through `buildDataFeedResult`, and there is no federation in this
   server.
2. **The house skill for the change:**
   - `add-bpm-feature`: a camunda7 tool, a `show_*` widget tool, a `*_data` feed or
     a widget.
   - `add-analytics-feature`: a PromQL query, an analytics tool or a dashboard
     widget.
   - `add-settings-section`: a module's user settings slice and its section.
3. **The toolkit's guides**, for the framework underneath:
   [migrating to mcp-use 2](https://github.com/Miragon/mcp-toolkit/blob/main/docs/guides/migrating-to-mcp-use-2.md)
   and the other pages in that folder.
4. **mcp-use itself** ([github.com/mcp-use/mcp-use](https://github.com/mcp-use/mcp-use)):
   read the 2.x typings in `node_modules/mcp-use` before you trust an example
   from the web.

Where an mcp-use example and the house skills disagree, the house skills win.

A user-visible change (env vars, tools, ports, getting-started steps) updates the Pulse docs
in `docs/` in the same PR; they build into the site https://miragon.github.io/pulse/
(`pnpm docs:build` fails on a dead link). The product page https://miragon.ai/tools/pulse/ is
built from Miragon/miragon-ai-docs; a change it shows needs a PR there too.
