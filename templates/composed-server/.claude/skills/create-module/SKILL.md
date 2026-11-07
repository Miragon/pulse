---
name: create-module
description: Step-by-step house pattern for building your own connector module under `modules/`, a self-contained package exporting a module definition plus tools, wired into the server composition. Use whenever integrating a new system ("build a connector for X", "add tools for our API", "new module"), or wiring a module into the server. Not for engine operations (start a process, correlate a message, job retries, variables): the engine module's `engine_*` tools do those already. For the widget path see the add-widget skill.
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# create-module: your own connector module

A module is a workspace package that exports a module-definition object
conforming **structurally** to the server's port (the `ModuleDefinition` type
in `server/src/setup.ts`). Your module never imports the server, and the
server never reaches into your module. Modules are peers: they never import
each other; anything shared goes through `@miragon/pulse-ui` (the design kit),
`@miragon/pulse-widget-shell` or the app-wired `SharedResources`.

**Reference implementation: `modules/mcp-notes`.** Copy it rather than
inventing a new shape; every step below points at the file that shows the
pattern. For patterns the notes module doesn't cover (toolsets, paged
lists), the published Miragon modules ship their sources under
`server/node_modules/@miragon/pulse-{engine,analytics}-connector/src/`
(gitignored symlinks: search one package directory, not the repo root; see
`CLAUDE.md` → Reference code).

**A module is for your other systems, not for the engine.** The engine
module already registers the generic engine operations as tools
(`engine_start_process_instance`, `engine_correlate_message`,
`engine_set_job_retries` and more), so "start our leasing process" needs no
new tool. A listing shows only the running toolset: these writes appear with
OAuth or under `MCP_ACTIVE_MODULES=engine:operations,<yours>`, never
in the default read-only boot. List them in the inspector or with
`pnpm exec mcp-use client local tools list` in `server/`, after the one-time
`connect` (`CLAUDE.md` → Verification). To give the model your processes'
keys and variables, put them into your module's `instructions` (Step 3)
without naming `engine_*` tools: the engine module may be off.

## Step 1: scaffold the package

```bash
cp -R modules/mcp-notes modules/mcp-<name>
```

`pnpm-workspace.yaml` already covers `modules/*`, so no workspace edit is
needed. Then adjust:

- `package.json`: name it `@<your-scope>/mcp-<name>` and keep the two-entry
  `exports` map exactly: `.` (compiled server code) and `./widgets` (pointing
  at **TypeScript source**, compiled by the server's Vite build). Keep `react`
  an optional peer: server-side consumers must not need it.
- Keep the three tsconfigs: `tsconfig.json` excludes `src/widgets` from the server
  build; `tsconfig.widgets.json` type-checks the widget `.tsx` (wired into the
  `typecheck` script, the only check that covers widget code); and
  `src/widgets/tsconfig.json` extends it, so editors, which read only files named
  `tsconfig.json`, check the widgets with the same settings.
- Do a global rename `notes` → `<name>` across `src/` (module name, plugin
  name, tool prefixes and thus view names, query keys), `src/module.test.ts`
  and the widget test included.

The copy carries its own pins of `@miragon/pulse-ui`,
`@miragon/pulse-widget-shell`, `mcp-use` and the shared libraries, and they
move with the server's: an upgrade bumps them in every module too.
`server/test/pins.test.ts` names each pin that differs from the installed
`@miragon/pulse-widget-shell`.

## Step 2: the data layer

`src/notes-store.ts` shows the shape: tools and widgets only ever see an
interface; the implementation behind it is yours (an HTTP client, an SDK, a
DB). Keep the client code in this layer, so handlers stay thin. If the client
grows real weight (generated SDK, query library), split it into its own
package later: extract on the second consumer, not speculatively.

The client talks to your system, never to a Camunda engine: a second engine
client built from `ENGINE_BASE_URL` skips what the engine module does on every
call (the engine pick by `engine` and `ENGINE_DEFAULT`, each engine's auth
including passthrough, its error rules). If the engine tools do not cover a
need, stop and ask: custom modules have no supported engine seam yet.

## Step 3: the module definition (`src/module.ts`)

The contract, field by field (see `notesModule`):

- `name`: the key used in `MCP_ACTIVE_MODULES` and the name of its plugin.
- `configFromEnv(env)`: a **pure** env → raw-config mapping; no I/O, no
  `process.env` reads outside the argument. It may check the config and
  throw one plain `Error` that names the variable, as the engine and
  analytics modules do: a wrong setting then fails the boot before its
  `Toolsets:` line.
- `knownEnvVars`: every env var your module reads. This feeds the server's
  boot-time typo warner, and each var contributes its prefix (`ACME_URL` →
  `ACME_`) to the watched set, so your module gets the same typo coverage as
  the built-in ones.
- `toolsets`: required as soon as your module registers a tool without
  `readOnlyHint: true` and the server may run without OAuth (Step 5). A
  module of reads only, like notes, leaves it out; a `<name>:<toolset>`
  suffix on it is ignored with a warning.
- `createPlugin(config, shared)`: validate `config` with your zod schema
  (also after a check in `configFromEnv`) and return a `ModulePlugin` (the type
  from `@miragon/pulse-widget-shell/server`), `{ name, register(server) }`.
  Construct your data source/client once in `createPlugin`; `register` hands
  it to `registerTools`, then to `registerWidgetTools`. `name` is the module's
  name: the boot refuses a tool name two plugins register and names both
  owners. `shared` is the app-wired cross-module resource bag; type the fields
  you consume structurally (e.g. `fetchBpmnXml?: FetchBpmnXml`, as analytics
  does) and tolerate their absence.
- Optional `bootWarnings(env)`: return actionable hints for misconfigured
  deployments (see the analytics module's Prometheus-URL warning).
- Optional `instructions(config)`: a short snippet the
  server appends to its MCP `instructions` (the rules that hold for EVERY tool
  of your module: routing, argument conventions, which tool answers what), so
  tool descriptions stay one-liners. `config` carries the effective `toolset`;
  return `undefined` to add nothing.

`src/index.ts`, the package root, exports the module definition and only what
a root wires (`notesModule`); `createPlugin`, the config and the data types stay
inside the package, as in the Miragon connectors.

`src/module.test.ts` checks the port the way the boot uses it: the plugin's
name and the tools its `register` adds. Keep it in step with your tools.

## Step 4: tools

`src/tools.ts` holds the plain tools **for the model**, registered through
`createToolRegistrar(server, store)` (from
`@miragon/pulse-widget-shell/server`). The second argument is threaded into
every handler as its first parameter; the registrar refuses unknown keys.
Raw `server.tool()` is reserved for the widget path (`widget-tools.ts`).

Tool conventions (they carry the contract, so they are not cosmetic):

- Names are `<module>_<verb>_<noun>` in snake_case. **Never** use `_show_` or a
  `_data` suffix for a plain tool: the server's wire-contract e2e test asserts
  widget `_meta` on every `*_show_*` tool and app-only visibility on every
  `*_data` feed, by name, across all composed modules including yours.
- Describe an input field only where it means more than its name; a rule every tool of your
  module shares goes once into `instructions` (Step 3), which the server sends with every
  session.
- Annotations: reads get `{ readOnlyHint: true, idempotentHint: true }`
  (+ `openWorldHint: true` when they talk to an external system); writes drop
  `readOnlyHint` and need toolsets (Step 5); every write states
  `destructiveHint` explicitly (MCP reads an absent hint as `true`): `true`
  for irreversible operations, `false` otherwise.
- Write tools that only flip state return a small `{ success: true, … }`
  object, not the raw (often empty) upstream response.

## Step 5: toolsets (as soon as a tool writes)

A module without toolsets registers every tool whenever it runs. Without OAuth
nobody signs in, so each of its writes is open to anyone who reaches the
port; the boot warns once per tool without `readOnlyHint: true`, naming the
tool and your module. So take this step as soon as your module registers a
tool without `readOnlyHint: true` and the server may run without OAuth; a
module of reads only skips it. Declare a vocabulary and put it
on the module definition. The boot resolves ONE concrete toolset per
boot, logs it, and hands it to `createPlugin` as `config.toolset`:

```ts
import { createToolsetVocabulary } from "@miragon/pulse-widget-shell/server"

export const MY_TOOLSETS = ["read-only", "standard"] as const
export const myToolsets = createToolsetVocabulary("<name>", MY_TOOLSETS, "read-only", {
  authenticatedDefault: "standard",
})
// src/module.ts: `toolsets: myToolsets,` on the module definition
```

- Accept it in your config schema (`toolset: z.string().optional()`) and
  resolve it once in `createPlugin` with `myToolsets.resolve(config.toolset)`.
- The third argument is your READ-ONLY FLOOR (it must permit no write). No suffix on a boot without OAuth, an empty or unknown suffix
  (with a warning), and a direct `createPlugin` caller passing no toolset all
  land there.
- `authenticatedDefault` is the no-suffix default under OAuth, which the boot
  installs from `MCP_USE_OAUTH_*`, so every OAuth boot
  that names no suffix runs it: your standard non-admin toolset. Never make it
  your widest one: an admin-like toolset must only be reachable by naming it.
- Write ONE rule function for the module, `isToolInToolset(config, toolset)`
  over the toolset `resolve` returned: admin-only names first, then the
  annotations (read-only ⇔ `readOnlyHint: true`). Apply it through ONE
  registrar wrapper, `withToolsetFilter`, so every tool, writes included,
  registers through the registrar and the filter decides it. Never a scattered
  `toolset === "read-only"` compare (fails open for every name you add later)
  or a `toolset === undefined` shortcut (an absent toolset is the floor, not
  "everything"). Reference:
  `server/node_modules/@miragon/pulse-engine-connector/src/lib/mcp/toolsets.ts`.

## Step 6: wire the module into the server

Four edits, plus the env documentation:

1. `server/package.json`: add `"@<your-scope>/mcp-<name>": "workspace:*"`,
   then `pnpm install`.
2. `server/src/setup.ts`: add your module to `MODULES`.
3. `server/src/ui/view-registry.ts`: spread your `<name>Views` map into
   `viewRegistry` (needed once you have show tools; harmless before).
4. `MCP_ACTIVE_MODULES` in `.env.example` and in your `.env`: add `<name>` to
   the list. A module the list does not name stays off and its tools are absent
   (the boot log's `Toolsets:` line shows what runs).
   `server/test/env-example.test.ts` holds `.env.example` to `MODULES`; nothing
   checks your `.env`, so a stale copy boots without your module. The playground
   recipe in the README's Quickstart and in the `setup-server` skill's Step 5
   names the modules itself in `-e MCP_ACTIVE_MODULES`: add `<name>` there too.

A missed spread is **silent** (tools work, the view says it can't show
itself), which is why `server/test/view-registry.test.ts` covers you
without an edit: it boots the real composition (edit 2) and fails naming a
view-bound tool without a view.

Tailwind needs no edit: `server/src/ui/globals.css` scans every workspace
module through the `modules/*/src` glob. Only an npm-installed module
package would need its own `@source` line there.

Then document every var from `knownEnvVars` in `.env.example`.
`server/test/env-example.test.ts` fails on both drift directions (an
undocumented var, or a documented var no module reads).

The other guard tests in `server/test/` need no edit either: they boot the
composed server in-process and derive what they check from `MODULES` and the
tools it lists, so they cover your module by naming convention and on every
toolset it declares. Only `server/test/example-notes.test.ts` names the
example module, and it goes with it (see "Remove the example module").

## Step 7: verify

```bash
pnpm build && pnpm typecheck && pnpm test
```

Then boot it for real: `pnpm dev`, check the boot log (your module's env-var
typo coverage and boot warnings show up here, and a warning names each write
a module without toolsets leaves open), and call your tools in the
inspector at `http://localhost:8400/mcp/inspector`, or headless via the
mcp-use client/screenshot commands in `CLAUDE.md` → Verification. Also verify
the selection path: `MCP_ACTIVE_MODULES=<name> pnpm dev` must expose exactly
your module's tools (the shell's value beats `.env`). If you declared `toolsets`, that is its read-only floor
without OAuth and its `authenticatedDefault` with it (the boot log's
`Toolsets:` line says which).

## Remove the example module

`modules/mcp-notes` is an example to copy, not part of your server. Once your
own module stands, take the example out in one change:

1. `server/src/setup.ts`: drop `notesModule` from `MODULES` and its import.
2. `server/src/ui/view-registry.ts`: drop the `notesViews` spread and its
   import.
3. `server/package.json`: drop the `@acme/mcp-notes` dependency and the notes
   in `description`; delete `modules/mcp-notes`, then `pnpm install`.
4. `.env.example`: drop the Notes block (`NOTES_TITLE`), `notes` from the live
   `MCP_ACTIVE_MODULES` value and every other `notes` mention (that variable's
   comment). Take it out of your `.env` too: the boot refuses a name the list
   still holds once `MODULES` no longer does.
5. `server/src/app.ts`: `SERVER_INSTRUCTIONS` tells the model the server holds
   team notes; say what yours does.
6. Delete `server/test/example-notes.test.ts`, the one test that names the
   example.
7. The smoke checks that name `notes_show_notes` (`CLAUDE.md` → Commands and
   Verification, the `setup-server` skill's Step 1, the README's Quickstart)
   take a show tool of yours, and the README's Configuration names your
   module where it names notes (the toolset prose and the variable table).
8. Every module list that still names `notes` names your module: the README's
   Quickstart (`MCP_ACTIVE_MODULES=engine,notes`, and
   `-e MCP_ACTIVE_MODULES=engine,analytics,notes` in the playground recipe),
   `CLAUDE.md` (`engine:operations,notes` and the comment on
   `cp .env.example .env`) and the `setup-server` skill (Steps 1, 2, 3 and 5,
   Troubleshooting). Copied as it stands, such a value fails the boot.
   `git grep -n notes` shows what is left, including the comment in
   `server/src/setup.ts` that names the deleted test.

Then run Step 7's bar. The other guard tests follow `MODULES`, so they need no
edit. The same holds for a Pulse module you leave out: dropping analytics is
`analyticsModule` in `MODULES`, `analyticsViews` and `analyticsHostWidgets` in
`view-registry.ts`, its block in `.env.example` and its name in any
`MCP_ACTIVE_MODULES` value that holds it.

## Anti-patterns

- Importing another module (or the server) instead of conforming
  structurally: peer isolation is the architecture.
- Reading `process.env` anywhere in the module but `configFromEnv`'s
  argument, or letting a check there throw a ZodError: the boot prints its
  schema path (`engines[0].id`), not the variable to fix.
- Registering plain tools with raw `server.tool()`: the registrar is the
  contract; the raw path is for widget tools only.
- Naming a plain tool `*_data` or `*_show_*`: the e2e naming contract will
  fail it, correctly.
- Talking to your backend from widget code: widgets read through `*_data`
  feeds only, via the view runtime's query hooks (see the add-widget skill).
