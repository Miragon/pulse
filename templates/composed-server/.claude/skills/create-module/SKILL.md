---
name: create-module
description: Step-by-step house pattern for building your own connector module under `modules/`, a self-contained package exporting a module definition plus tools, wired into the server composition. Use whenever integrating a new system ("build a connector for X", "add tools for our API", "new module"), or wiring a module into the server. For the widget path see the add-widget skill.
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
`node_modules/@miragon/pulse-{engine,analytics}-connector/src/`.

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
- Keep both tsconfigs: `tsconfig.json` excludes `src/widgets` from the server
  build; `tsconfig.widgets.json` type-checks the widget `.tsx` (wired into the
  `typecheck` script, the only check that covers widget code).
- Do a global rename `notes` → `<name>` across `src/` (module name, plugin
  name, tool prefixes and thus view names, query keys), `src/module.test.ts`
  and the widget test included.

## Step 2: the data layer

`src/notes-store.ts` shows the shape: tools and widgets only ever see an
interface; the implementation behind it is yours (an HTTP client, an SDK, a
DB). Keep the client code in this layer, so handlers stay thin. If the client
grows real weight (generated SDK, query library), split it into its own
package later: extract on the second consumer, not speculatively.

## Step 3: the module definition (`src/module.ts`)

The contract, field by field (see `notesModule`):

- `name`: the key used in `MCP_ACTIVE_MODULES` and the name of its plugin.
- `configFromEnv(env)`: a **pure** env → raw-config mapping; no I/O, no
  `process.env` reads outside the argument, no validation here.
- `knownEnvVars`: every env var your module reads. This feeds the server's
  boot-time typo warner, and each var contributes its prefix (`ACME_URL` →
  `ACME_`) to the watched set, so your module gets the same typo coverage as
  the built-in ones.
- `toolsets`: leave it out unless you implement Step 5 (the notes module has
  none); without it a `<name>:<toolset>` suffix is ignored with a warning.
- `createPlugin(config, shared)`: validate `config` with your zod schema
  (**this** is where validation lives) and return a `ModulePlugin` (the type
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
  `readOnlyHint`; every write states `destructiveHint` explicitly (MCP reads an
  absent hint as `true`): `true` for irreversible operations, `false` otherwise.
- Write tools that only flip state return a small `{ success: true, … }`
  object, not the raw (often empty) upstream response.

## Step 5: toolsets (optional)

Skip this until someone needs to run your module with a narrowed tool surface
(`MCP_ACTIVE_MODULES=<name>:read-only`). Then declare a vocabulary and put it
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
  `node_modules/@miragon/pulse-engine-connector/src/lib/mcp/toolsets.ts`.

## Step 6: wire the module into the server

Three edits, plus the env documentation:

1. `server/package.json`: add `"@<your-scope>/mcp-<name>": "workspace:*"`,
   then `pnpm install`.
2. `server/src/setup.ts`: add your module to `MODULES`.
3. `server/src/ui/view-registry.ts`: spread your `<name>Views` map into
   `viewRegistry` (needed once you have show tools; harmless before).

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

The e2e tests (`server/test/widget-contract.e2e.test.ts`,
`server/test/strict-input.e2e.test.ts`) need no edit either: they boot the
composed server in-process and cover your module by naming convention and on
every toolset it declares.

## Step 7: verify

```bash
pnpm build && pnpm typecheck && pnpm test
```

Then boot it for real: `pnpm dev`, check the boot log (your module's env-var
typo coverage and boot warnings show up here), and call your tools in the
inspector at `http://localhost:8400/mcp/inspector`, or headless via the
mcp-use client/screenshot commands in `CLAUDE.md` → Verification. Also verify
the selection path: `MCP_ACTIVE_MODULES=<name> pnpm dev` must expose exactly
your module's tools. If you declared `toolsets`, that is its read-only floor
without OAuth and its `authenticatedDefault` with it (the boot log's
`Toolsets:` line says which).

## Anti-patterns

- Importing another module (or the server) instead of conforming
  structurally: peer isolation is the architecture.
- Validating config in `configFromEnv` (belongs in `createPlugin`) or reading
  `process.env` anywhere else in the module.
- Registering plain tools with raw `server.tool()`: the registrar is the
  contract; the raw path is for widget tools only.
- Naming a plain tool `*_data` or `*_show_*`: the e2e naming contract will
  fail it, correctly.
- Talking to your backend from widget code: widgets read through `*_data`
  feeds only, via the view runtime's query hooks (see the add-widget skill).
