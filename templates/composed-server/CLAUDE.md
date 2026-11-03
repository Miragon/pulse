# CLAUDE.md

Guidance for AI agents working in this repository: a composed MCP server built
from the published `@miragon/pulse-*` modules (engine BPM operations, Prometheus
process analytics) plus your own custom modules. `README.md` is the quick tour
for humans; this file plus the skills carry the architecture rules.

The skills in `.claude/skills/` are step-by-step walkthroughs for the three main
task paths. Read the matching one BEFORE starting:

| Skill           | Use when…                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------ |
| `setup-server`  | configuring, running, branding, or deploying this server (env, modules, toolsets, Docker)  |
| `create-module` | building your own connector module: tools for your own API or system                       |
| `add-widget`    | adding or changing an interactive widget (`show_*` tool + `*_data` feed + React component) |

## Commands

```bash
pnpm install          # public npm registry only, no credentials needed
cp .env.example .env  # local config; `pnpm dev` loads it (only `pnpm dev` does)

pnpm build            # modules → widget bundle → server
pnpm typecheck        # tsc everywhere, INCLUDING widget .tsx code: the only check that covers it
pnpm test             # vitest: guard tests + in-process e2e wire-contract tests
pnpm dev              # MCP endpoint on :8400/mcp, inspector on :8400/mcp/inspector

docker build -t my-mcp-server .   # needs a committed pnpm-lock.yaml
```

Use the inspector (`http://localhost:8400/mcp/inspector`, `pnpm dev` only) to call
tools and render widgets manually; `notes_show_notes` works without any
external infrastructure.

## Architecture invariants (short form, details in the skills)

1. **Modules are self-contained peers; the server is a thin composition root.**
   A module is a package exporting a `ModuleDefinition` (the port type in
   `server/src/setup.ts`; conformance is structural, modules never import
   the server or each other). Its `createPlugin` returns a `ModulePlugin`:
   the module's `name` and one `register(server)` that registers all its
   tools; the boot refuses a tool name two plugins register and names both.
   Wiring a module touches the server in two places (`MODULES` in `setup.ts`,
   the spread in `ui/view-registry.ts`) plus the `workspace:*` dependency;
   the `create-module` skill walks through all of them. Tailwind scans
   workspace modules via the `modules/*/src` glob in `ui/globals.css`; only
   npm-installed module packages need their own `@source` line.
2. **Plain tools go through `createToolRegistrar`, never raw `server.tool()`**:
   the raw path is reserved for widget tools (`widget-tools.ts`). Three render
   paths: registrar tools (JSON for the model), `*_show_*` widget tools
   (widget for the user + summary for the model), app-only `*_data` feeds
   (JSON the widget re-reads or fetches in place). The `_show_`/`_data` **naming is
   load-bearing**: `server/test/widget-contract.e2e.test.ts` asserts the widget
   `_meta` contract by name across ALL composed modules, including yours.
   All three take **strict input** (the registrar always, raw
   `server.tool()` with `strictToolInput(shape)`, both from
   `@miragon/pulse-widget-shell/server`), so an unknown key is a tool error naming
   the valid keys, never a silently dropped filter
   (`server/test/strict-input.e2e.test.ts` probes every tool of every module
   on every toolset it declares).
3. **A view hangs off three links**: the show tool returns its view's data
   (`buildViewResult(data, summary)`), the module's view map
   (`src/widgets/index.ts`) renders it under the show tool's NAME, and the
   server's `ui/view-registry.ts` spreads the map; `tool-names.ts` keeps the
   tool names rename-safe. A missed link is a SILENTLY absent view.
   `server/test/view-registry.test.ts` boots the real composition and fails
   on a view-bound tool without a view, and on a view no tool opens.
4. **`resolve.dedupe` in `server/vite.config.ts` is load-bearing: never trim
   it.** It spreads widget-shell's `VIEW_BUNDLE_DEDUPE`
   (`@miragon/pulse-widget-shell/server`), the packages the view bundle must
   resolve once; a package of your own that carries a React context goes after
   it. Without it every in-widget query hangs on "Loading…" (duplicate React
   contexts).
   **Widgets compose their UI from the design kit `@miragon/pulse-ui`**
   (primitives, `WidgetHeader`, `KpiGrid`, the pills, the `TONE_*` maps, `cn`,
   `Th`/`Td`, `TableEmptyState`, the formatters) and **reach the host only
   through widget-shell's view runtime**:
   `useViewHost()` (`callTool`, `sendFollowUp`, `openExternal`),
   `HostModelContext` and the query hooks (`useViewData`, `useToolQuery`,
   `useToolMutation`, `useQueryClient`), all from
   `@miragon/pulse-widget-shell/widgets`. Never import `mcp-use/react` in a
   widget: its hooks throw outside the bundle root (`mountViews`), so the
   widget would only render inside a host. That seam is what makes a widget
   testable without one: render it under `TestViewHost` (fake tools, a log of
   host actions and model contexts), as
   `modules/mcp-notes/src/widgets/notes-list.test.tsx` does.
5. **Exact version pins** (`save-exact` in `.npmrc`) for `dependencies`/
   `devDependencies`: upgrade all `@miragon/pulse-*` packages together to one
   version. The consumer-shared libraries are ranged `peerDependencies` of a
   module instead (`react`/`react-dom` `^19.2.0`, `zod` `^4.4.0`,
   `@miragon/pulse-ui` and `@miragon/pulse-widget-shell` `^<version>`), so
   they resolve to the server's one copy; keep an exact copy of each in
   `devDependencies` for local builds. Keep `react`, `react-dom`, `zod`,
   `lucide-react` and `@tanstack/react-query` at the versions the Pulse
   packages are built with (Pulse checks its own copy of this template against
   them).
   **`mcp-use` stays exactly pinned** even as a peer (`2.12.2`): a duplicate
   `mcp-use` instance breaks the React context and hangs every in-widget query
   on "Loading…" (invariant #4). `@mcp-use/client` (a dev dependency of `server/`) is
   pre-pinned to the newest version mcp-use's optional peer range accepts, so
   the mcp-use CLI's on-demand install can never mutate `package.json`
   mid-task or introduce a second, differently-resolved mcp-use instance. On
   an mcp-use bump, re-pin it to the newest version the new peer range
   accepts.
6. **Never hand-write `_meta.ui.*` keys**: spread `showToolBinding(...)` for
   widget tools and `appOnly` for data feeds (both from
   `@miragon/pulse-widget-shell/server`); mcp-use owns and overwrites the `ui`
   namespace.
7. **`.env.example` documents every env var the server reads**: both drift
   directions are guarded by `server/test/env-example.test.ts`; add your
   module's vars there.
8. **Toolsets fail closed.** A module opts into the `module:toolset` suffix by
   declaring `toolsets: createToolsetVocabulary(...)` on its definition (a
   module without one has no toolsets); the boot resolves ONE
   concrete toolset per module per boot and logs it. Without OAuth (the boot
   reads `MCP_USE_OAUTH_*`) a module without a suffix runs its
   read-only floor, an empty/unknown suffix falls back to it, and an
   admin-like toolset is only reachable by naming it. Gate a write by the
   module's toolset rule at registration (the engine module's
   `withToolsetFilter`/`isToolInToolset` in
   `node_modules/@miragon/pulse-engine-connector/src/lib/mcp/toolsets.ts`), never
   on a name compare or on `toolset === undefined`, both of which fail open.
   Details: `create-module` Step 5.

## Verification

The minimum bar for every change:

```bash
pnpm build && pnpm typecheck && pnpm test
```

`pnpm typecheck` is the **only** automated check that type-checks widget `.tsx`
code; never skip it. Widget changes additionally need a render check
(`pnpm dev`, then call the `show_*` tool). The widget bundle is read once at
boot, and the root `pnpm dev` rebuilds the modules and the bundle on every
start, so the whole edit-run loop for module or widget code is: restart
`pnpm dev` at the repo root (the server-local `dev` script rebuilds only the
bundle and loads no `.env`).

The render check runs headless with the stock mcp-use CLI (needs a local
Chrome; the inspector at `http://localhost:8400/mcp/inspector` is the
human/no-Chrome path). With `pnpm dev` running, from `server/`:

```bash
pnpm exec mcp-use client connect local http://localhost:8400/mcp  # once
pnpm exec mcp-use client local tools call notes_show_notes        # wire check: _meta.ui.resourceUri + structuredContent
pnpm exec mcp-use screenshot --mcp http://localhost:8400/mcp \
  --tool notes_show_notes --output /tmp/notes.png --json          # renders the REAL bundle at OpenAI's 768px container width
```

Then read the PNG: a styled widget proves the bundle, the registry links, and
the Tailwind scan in one shot.

## Reference code

- `modules/mcp-notes/`: the example custom module showing the full house
  pattern (module definition, registrar tool, widget tool + data feed, widget,
  module test, widget test under `TestViewHost`). Copy it; don't invent a new shape.
- The published Pulse modules ship their **sources**: read
  `node_modules/@miragon/pulse-engine-connector/src/` and
  `node_modules/@miragon/pulse-analytics-connector/src/` for the reference
  implementations of anything the notes module doesn't cover (toolsets, paged
  lists, BPMN widgets).
