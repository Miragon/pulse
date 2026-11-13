# CLAUDE.md

Guidance for AI agents working in this repository: a composed MCP server built
from the published `@miragon/pulse-*` modules (engine BPM operations) plus your
own custom modules. `README.md` is the quick tour
for humans; this file plus the skills carry the architecture rules.

The skills in `.claude/skills/` are step-by-step walkthroughs for the three main
task paths. Read the matching one BEFORE starting:

| Skill           | Use when…                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------ |
| `setup-server`  | configuring, running, branding, or deploying this server (env, modules, toolsets, Docker)  |
| `create-module` | building your own connector module: tools for your own API or system                       |
| `add-widget`    | adding or changing an interactive widget (`show_*` tool + `*_data` feed + React component) |

**Engine operations are tools already.** The engine module ships the generic
Camunda 7 operations, among them `engine_start_process_instance`,
`engine_correlate_message`, `engine_complete_task`,
`engine_set_process_instance_variable` and `engine_set_job_retries`. "Start
our leasing process" or "retry the failed jobs of X" needs no new module or
tool: the model calls these. They are writes, so without OAuth they register
only under the `operations` toolset (`engine:operations` in
`MCP_ACTIVE_MODULES` next to your other modules, e.g.
`engine:operations,notes`; invariant 8). The default boot (no OAuth,
no suffix) runs the read-only floor and lists none of them. To list the
running toolset's tools, use the MCP Inspector `pnpm dev` starts, or its CLI
under Verification. A custom module is for your other systems. To teach the model your processes (their keys, the variables a
start takes), write them into your module's `instructions` without naming
`engine_*` tools, since the engine module may be off. Never build a second
engine client from `ENGINE_BASE_URL`: it loses what the engine module does on
every call (the engine pick by `engine` and `ENGINE_DEFAULT`, each engine's
auth including passthrough, its error rules). If the engine tools do not
cover a need, stop and ask: custom modules have no supported engine seam yet.

## Commands

```bash
corepack enable       # pnpm 10.32.1 (`packageManager`); Node.js 25+ has none: npm i -g pnpm@10.32.1
pnpm install          # public npm registry only, no credentials needed
cp .env.example .env  # local config, runs engine and notes against compose.yaml's engine; only `pnpm dev` loads it

pnpm build            # modules → widget bundle → server
pnpm typecheck        # tsc everywhere, INCLUDING widget .tsx code: the only check that covers it
pnpm test             # vitest: guard tests + in-process e2e wire-contract tests
pnpm format:check     # Prettier, the style in .prettierrc.json (`pnpm format` applies it)
pnpm dev              # MCP endpoint on :8400/mcp, plus the MCP Inspector (it prints its URL)

docker build -t my-mcp-server .   # needs a committed pnpm-lock.yaml
```

`pnpm dev` builds the modules and the widget bundle once, then runs three
processes: `vite build --watch` (the bundle), `tsx watch` (the server, restarted
when its code or the bundle changes) and the official MCP Inspector
(`@modelcontextprotocol/inspector`, `dev:inspector` in `server/package.json`) on
`127.0.0.1`, pointed at the server. It opens no browser: open the URL it prints
(with its per-launch token) to call tools (Tools tab) and render widgets (Apps
tab); `notes_show_notes` works without any external infrastructure. The
inspector has no chat, so a hand-off to the chat and a view's model context show
only in a real host, through a tunnel (the `setup-server` skill, Step 6).

## Architecture invariants (short form, details in the skills)

1. **Modules are self-contained peers; the server is a thin composition root.**
   A module is a package exporting a `ModuleDefinition` (the port type in
   `server/src/setup.ts`; conformance is structural, modules never import
   the server or each other). Its `createPlugin` returns a `ModulePlugin`:
   the module's `name` and one `register(server)` that registers all its
   tools; the boot refuses a tool name two plugins register and names both.
   Wiring a module touches the server in two places (`MODULES` in `setup.ts`,
   the spread in `ui/view-registry.ts`) plus the `workspace:*` dependency and
   `MCP_ACTIVE_MODULES` in `.env.example` and your `.env` (a module the list does
   not name stays off, a name `MODULES` no longer holds fails the boot);
   the `create-module` skill walks through all of them, and through removing
   the example module. The guard tests in `server/test/` follow `MODULES`, so
   adding a module and removing the example need no guard-test edit; only
   `example-notes.test.ts` names the example, and it goes with it. Tailwind scans
   workspace modules via the `modules/*/src` glob in `ui/globals.css`; only
   npm-installed module packages need their own `@source` line.
2. **Plain tools go through `createToolRegistrar`, never a raw `server.registerTool()`**:
   the raw path is reserved for widget tools (`widget-tools.ts`). `server` is the
   `ModuleServer` the boot hands `register(server)`: the official MCP SDK's own
   `registerTool`/`registerPrompt`/`registerResource`, so its docs
   (https://ts.sdk.modelcontextprotocol.io/v2/) and ext-apps' `registerAppTool` and
   `registerAppResource`
   (https://apps.extensions.modelcontextprotocol.io/api/) apply as they are; Pulse
   adds only config helpers on top, which a view tool spreads either way
   (`...showToolBinding(name, title)`, rule 6). Three render
   paths: registrar tools (JSON for the model), `*_show_*` widget tools
   (widget for the user + summary for the model), app-only `*_data` feeds
   (JSON the widget re-reads or fetches in place). The `_show_`/`_data` **naming is
   load-bearing**: `server/test/widget-contract.e2e.test.ts` asserts the widget
   `_meta` contract by name across ALL composed modules, including yours.
   All three take **strict input** (the registrar always, a raw
   `server.registerTool()` with `strictToolInput(shape)`, both from
   `@miragon/pulse-widget-shell/server`; the boot refuses any other schema that lets
   an unknown key through), so an unknown key is a tool error naming
   the valid keys, never a silently dropped filter
   (`server/test/strict-input.e2e.test.ts` probes every tool of every module
   on every toolset it declares).
3. **A view hangs off three links**: the show tool returns its view's data
   (`buildViewResult(data, summary)`), the module's view map
   (`src/widgets/index.ts`) renders it under the show tool's NAME, and the
   server's `ui/view-registry.ts` spreads the map; `tool-names.ts` keeps the
   tool names rename-safe. A missed link is a SILENTLY absent view.
   `server/test/view-registry.test.ts` boots the real composition and fails
   on a view-bound tool without a view, on a view no tool opens, and on a
   view-bound tool that is not a read (`readOnlyHint: true`, never destructive):
   a host that strips the tool's result re-runs it once, unasked. A finished HTML
   view a module brings itself hangs off none of these links: the `add-widget`
   skill, "A finished HTML view", says when that fits and what it costs.
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
   `@miragon/pulse-widget-shell/widgets`. Never import
   `@modelcontextprotocol/ext-apps` in a widget: only widget-shell's host adapter
   under the bundle root (`mountViews`) talks to the host, so a widget that
   reaches past it would only render inside one. That seam is what makes a widget
   testable without a host: render it under `TestViewHost` (fake tools, a log of
   host actions and model contexts), as
   `modules/mcp-notes/src/widgets/notes-list.test.tsx` does.
5. **Exact version pins** (`save-exact` in `.npmrc`) for `dependencies`/
   `devDependencies`: upgrade all `@miragon/pulse-*` packages together to one
   version, in every `package.json` (each module carries its own). The
   consumer-shared libraries are ranged `peerDependencies` of a
   module instead (`react`/`react-dom` `^19.2.0`, `zod` `^4.4.0`,
   `@miragon/pulse-ui` and `@miragon/pulse-widget-shell` `^<version>`), so
   they resolve to the server's one copy; keep an exact copy of each in
   `devDependencies` for local builds. Keep `react`, `react-dom`, `zod`,
   `lucide-react` and `@tanstack/react-query` at the versions the Pulse
   packages are built with. `server/test/pins.test.ts` holds every
   `package.json` to the installed `@miragon/pulse-widget-shell`, and
   `strictPeerDependencies` in `pnpm-workspace.yaml` fails an install on an
   unmet peer; never downgrade `lucide-react` to quiet one, and never turn
   strict peers off: a third-party peer you accept gets a
   `peerDependencyRules.allowedVersions` entry there.
   The official MCP SDK (`@modelcontextprotocol/server`, `/node`, `/ext-apps`)
   comes with `@miragon/pulse-widget-shell`. A module that imports a package of
   it itself (ext-apps' `registerAppTool`, say) declares it like `zod`: a ranged
   peer in the range widget-shell's README names (a caret range that admits the
   version widget-shell pins; `server/test/pins.test.ts` holds it), plus an exact
   devDependency. Install such a module from npm and `server/package.json` pins
   the package too, in `dependencies`, at widget-shell's version: pnpm otherwise
   installs what the module's range resolves to, and neither strict peers nor
   `pins.test.ts` see it.
6. **Never hand-write a tool's `_meta` keys**: spread `showToolBinding(...)` for
   widget tools and `appOnly` for data feeds (both from
   `@miragon/pulse-widget-shell/server`). They stamp both halves, MCP Apps' `ui`
   keys and the `openai/*` ones; for a view in the bundle the boot adds the CSP
   and serves its resource. A finished HTML view is the one resource a module
   registers: `showToolBinding(name, title, { resourceUri, csp })` on the tool,
   and on the resource the `_meta.ui` of ext-apps' API, which is the module's.
7. **`.env.example` documents every env var the server reads**: both drift
   directions are guarded by `server/test/env-example.test.ts`; add your
   module's vars there. The same test holds its live `MCP_ACTIVE_MODULES` to
   `MODULES`: every composed module, each once.
8. **Toolsets fail closed.** A module opts into the `module:toolset` suffix by
   declaring `toolsets: createToolsetVocabulary(...)` on its definition (a
   module without one has no toolsets and registers every tool whenever it runs,
   so it declares them as soon as it registers a tool without
   `readOnlyHint: true` and the server may run without OAuth; until then a
   boot without OAuth warns once per such tool); the boot resolves ONE
   concrete toolset per module per boot and logs it. Without OAuth (the boot
   reads `MCP_OAUTH_*`) a module without a suffix runs its
   read-only floor, an empty/unknown suffix falls back to it, and an
   admin-like toolset is only reachable by naming it. Gate a write by the
   module's toolset rule at registration (the engine module's
   `withToolsetFilter`/`isToolInToolset` in
   `server/node_modules/@miragon/pulse-engine-connector/src/lib/mcp/toolsets.ts`), never
   on a name compare or on `toolset === undefined`, both of which fail open.
   Details: `create-module` Step 5.

## Verification

The minimum bar for every change:

```bash
pnpm build && pnpm typecheck && pnpm test
```

`pnpm typecheck` is the **only** automated check that type-checks widget `.tsx`
code; never skip it. Widget changes additionally need a render check
(`pnpm dev`, then the `show_*` tool in the inspector's Apps tab). A widget edit
rebuilds the bundle and restarts the server by itself; reopen the view to see
it. A module's tools are built once, when the root `pnpm dev` starts, so after
changing them restart `pnpm dev` at the repo root (the server-local `dev`
script builds no module and loads no `.env`).

Headless, with `pnpm dev` running, the inspector's CLI checks the wire from
`server/`:

```bash
pnpm exec mcp-inspector --cli --server-url http://127.0.0.1:8400/mcp --transport http \
  --method tools/call --tool-name notes_show_notes --app-info      # the view: resourceUri, csp
pnpm exec mcp-inspector --cli --server-url http://127.0.0.1:8400/mcp --transport http \
  --method tools/call --tool-name notes_show_notes --format json   # its structuredContent
```

The CLI renders nothing: whether the widget is styled and shows its data, the
Apps tab tells, which proves the bundle, the registry links and the Tailwind
scan in one look.

## Reference code

- `modules/mcp-notes/`: the example custom module showing the full house
  pattern (module definition, registrar tool, widget tool + data feed, widget,
  module test, widget test under `TestViewHost`). Copy it; don't invent a new shape.
- The published Pulse module ships its **sources**: read
  `server/node_modules/@miragon/pulse-engine-connector/src/` for the
  reference implementations of anything the notes module doesn't cover
  (toolsets, paged lists, BPMN widgets).
- Where the APIs live: widget-shell's README
  (`server/node_modules/@miragon/pulse-widget-shell/README.md`) has its export
  table, one row per entry (`./server`, `./widgets`, `./testing`), typed in
  `server/node_modules/@miragon/pulse-widget-shell/dist/server.d.ts` and
  `server/node_modules/@miragon/pulse-widget-shell/dist/ui/index.d.ts`;
  pulse-ui's is `server/node_modules/@miragon/pulse-ui/README.md`, typed in
  `server/node_modules/@miragon/pulse-ui/dist/index.d.ts`.
- pnpm links these packages under `server/node_modules` (pulse-ui and
  widget-shell also under `modules/<name>/node_modules`), never at
  `node_modules/@miragon/` in the repo root: it keeps the real files in the
  root `node_modules/.pnpm/` under hashed names. `node_modules` is gitignored,
  the `@miragon/*` entries are symlinks and `.pnpm` is hidden, so a search
  from the repo root (the Grep tool, `rg`) finds none of these files: give one
  package directory as the path, e.g.
  `server/node_modules/@miragon/pulse-engine-connector/src`.
