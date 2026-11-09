# Developing @miragon/pulse-widget-shell

Shared widget plumbing for the [Pulse](../../../README.md) MCP App widgets. It is the common base
the engine module ([`engine-connector`](../../connectors/engine/engine-connector)) and your own
modules build on, so every widget gets the same data-loading, refresh and view-composition
behaviour. Its UI builds
on the design kit [`@miragon/pulse-ui`](../ui). Setup and the repository's bar:
[CONTRIBUTING.md](../../../CONTRIBUTING.md); the architecture invariants in
[`CLAUDE.md`](../../../CLAUDE.md) say how a view is registered.

## Checks

`pnpm typecheck` types both halves: `tsconfig.json` (Node, no DOM) and `tsconfig.widgets.json`
(DOM, no Node). Changes here also need `test:host` (`pnpm --filter @miragon/pulse-mcp-server test:host`)
and a manual render check in the MCP Inspector, as the root `CLAUDE.md` describes.

The `lucide-react` peer range still admits 0.562 only for this repo's own test graph; a host
bundle that dedupes it needs a 1.x copy, and no package manager warns about it.

## How the parts work

- **The view runtime** (`./widgets`): the bundle root `mountViews({ views })` picks
  the view the document's prelude names (the show tool's name) from your view map and mounts it
  under the view root (the host adapter over ext-apps' official `App`, ONE `QueryClient` per
  document, `HostDocument`, `LocaleGate`, toasts); `mountView` mounts one view without a map. The
  adapter is the only code that imports the view runtime of `@modelcontextprotocol/ext-apps`: it fills the
  host-agnostic contexts every widget reads, as `TestViewHost` does in a test, so another host (a
  web app, an editor webview) needs an adapter of its own and no widget change. `LocaleGate` renders German
  for a host locale whose language is `de` (`de`, `de-DE`, `de_AT`) and English otherwise. The
  root's call hook (`useViewCall` over `resolveViewCall`) owns the stripped-result recovery: a host that
  drops `structuredContent` (claude.ai) gets the view re-running its own show tool ONCE (every
  view-bound tool is a read), stamped "Reloaded at"; the view frame renders the phases (waiting,
  error with a retry, cancelled, ready) and keeps a crashing view, and each `ViewStack` row,
  inside its own error boundary. Widgets reach the host only through the view
  host seam (`useViewHost`: `callTool`, `sendFollowUp`, `openExternal`; `HostModelContext`) and the query
  hooks (`useToolQuery`, `useToolQueries` (one read per entry of a list, under `useToolQuery`'s
  keys), `useToolMutation`, `useViewData` (which seeds a feed with the view's data),
  `useQueryClient`), never ext-apps, so a widget renders under `TestViewHost`
  (fake tools, a log of host actions and model contexts) in a plain test. No module renders
  another's widget, and the view root keeps no map for one.
- **View builders** (`./server`): `buildViewResult(data, summary)` (a show tool's result: the
  `structuredContent` IS the view's data, the text what the model reads: a short summary or,
  where the model needs the figures, the result as compact JSON) and
  `buildDataFeedResult` (the single implementation of the app-only `*_data` feed result);
  `decodeToolResult` reads either (on both entries: a widget decodes `callTool`'s raw result with
  it, a server test its own tool's). The view itself is declared on the tool by `showToolBinding`,
  spread into `registerTool`'s config (both `_meta` halves: MCP Apps' `ui.resourceUri` and the
  `openai/*` keys; `appOnly` is a feed's `ui.visibility: ["app"]`), and the boot serves each
  view with `viewPrelude(name)` ahead of the bundle.
- **A view a module brings itself** (`./server`): a finished HTML document, built by any toolchain
  and shipped on npm, without the server's Vite build knowing it. Register it as a resource of your
  own, `registerAppResource(server, name, "ui://<module>/<view>.html", config, read)`, and bind the
  tool with `showToolBinding(name, title, { resourceUri, csp })`. The document runs the MCP Apps
  handshake itself. It shares no code with the bundle, so it pays for its own React and styles;
  gets none of this package's view host, query hooks or stripped-result recovery; and its CSP
  (`_meta.ui.csp` on the resource, `csp` for the Apps SDK half) and fonts are its own: the boot adds
  nothing to it. The boot guards its callbacks: one that returns no `contents` or throws no `Error`
  gets an answer naming the module, a thrown error's message reaches the client, its stack the log,
  and a template's `list` that fails or hangs costs only its own entries. A widget in the bundle is
  the right choice unless you need that independence.
- **BPMN names** (`./server`, and `./widgets` for a view): `readBpmnNames` / `parseBpmnNames`: the one rule every module
  reads a model's names by, without a DOM (a process's own name, else its Modeler pool's;
  character references such as `&#10;` and `&#38;` decoded, space folded), so two modules never
  name the same process or activity differently.
- **Host-bound UI** (`./widgets`): what widget-shell adds on top of the design kit
  `@miragon/pulse-ui`, the pieces that touch the host, a tool call or BPMN
  (`WidgetShell`, `ListTable` + `PagedRows`, the dual-mode data hooks, hand-offs, the BPMN
  viewer, …), reused across both widget packages.
  Inline in a chat a view is a card (#396): the view root's measured fit (`HostDocument`,
  `InlineFitBox`) caps a paged list (`usePagedViewData`) and an unpaged `ListTable` to the
  rows that fit the host's height budget, measured on the rendered view, with the count and
  a way to the rest (fullscreen where the host offers it); the BPMN canvas stays at 320 px.
  Layout, states and feedback: `ListTable` scrolls inside a named, keyboard-reachable region
  (column priorities via `hideBelow`, the row actions pinned with `sticky`, the sorted
  column marked with `sort`, heads over adjacent columns with `groups`), `IdCell`/`IdText`
  show an id shortened in Geist Mono with a copy button (the short form, `shortId`, and the
  severity ladder for incident and job counts, `countTone`/`severityTone`, are pulse-ui's), `describeError` turns an engine or
  transport failure into what happened and what you can do (pulse-ui's `ErrorState` in
  `ViewDataState`, `QueryFallback`, `useDetailView`, raw text under "Details", retry
  required), `useActionFeedback` raises pulse-ui's toasts after a write (an engine
  refusal's own reason quoted, a write whose answer never came flagged), `ConfirmDialog`
  asks before one, and the BPMN canvas reads one token module (`BPMN_TOKENS`,
  `BPMN_OVERLAY_CSS`) with its height from the diagram's size at the scale bpmn-js draws it
  (read from the XML's DI before the import). The design kit (the
  primitives and components, the `TONE_*` maps, `cn`, the formatters, `Icon`, the table
  cells `Th`/`Td`, `TableEmptyState`, `NamedId`, `KometMark`/`AppEmptyState`,
  `TEXT_BLOCK_FRAME`, …) is imported from `@miragon/pulse-ui`: widget-shell neither forks nor
  re-exports it.
- **Test server** (`./testing`): `recordingModuleServer`, the `ModuleServer` a module's tests
  register on, and `testServerContext`. The brand gates and the product glossary every widget
  package checks its catalogs against are `@miragon/pulse-ui/testing`. Node only.
- **Theme:** none of its own. The widgets colour through the role variables of pulse-ui's
  Miragon theme (`@miragon/pulse-ui/theme.css`: the vendored `--cd-*` corporate-design
  tokens and the roles on top, light and dark). Your stylesheet imports it after `tailwindcss`,
  `@source`s pulse-ui's `dist` and this package's `dist`, and
  overrides ROLE variables only; measure your overrides with `themeStylesheets()` from
  `@miragon/pulse-ui/testing`. The widgets follow the host's theme (then the OS); there is no
  theme preference.
- **Module composition** (inside the boot): `createComposedServer` composes the modules you hand
  it: `MCP_ACTIVE_MODULES` selection with `module:toolset` suffixes (an unknown module name fails
  the boot, listing the modules), the env-typo warner and boot warnings. It resolves ONE concrete
  toolset per module per boot and threads it into the module's `config.toolset` (`ModuleEntry`),
  authenticated exactly when it installed OAuth. A module's
  `createPlugin(config, shared)` returns a `ModulePlugin`: its `name` and one `register(server)`
  that registers all its tools, prompts and resources on a `ModuleServer`, the official SDK's own
  `registerTool`/`registerPrompt`/`registerResource` (`Pick<McpServer, …>`, so the SDK's docs and
  ext-apps' `registerAppTool` and `registerAppResource` apply as they are); `shared(entries)` is
  the port for what the modules of a composition share (a module of yours that needs the engine
  module's engine access gets it there, never by importing it); the Pulse server and the starter
  hand nothing through today. The boot log states each module's toolset
  and why. A module's tests register on `recordingModuleServer()` (`./testing`), which calls a
  handler and reads a resource (`resource(uri).read()`) the way the SDK does
  (`testServerContext(signal?)` builds its context).
  `composedEnvVars(modules)` names every variable such a boot reads (the boot's own and each
  module's `knownEnvVars`), e.g. for a `.env.example` check; a module's optional
  `referencedEnvVars(env)` names the variables its own settings point at (the engine module's
  profiles name `ENGINE_SECRET_*` variables), which the typo warner then takes as known.
- **Toolset vocabularies** (`./server`): a module declares its toolsets as
  `toolsets: createToolsetVocabulary(module, names, floor, { authenticatedDefault })` on its
  definition; a module without one has no toolsets (a suffix is ignored with a warning) and
  registers every tool, so a boot without OAuth warns once per tool of it without
  `readOnlyHint: true`, naming the tool and the module. The rule is fail-closed: no suffix →
  `floor` without OAuth, `authenticatedDefault` (default: `floor`) with it; an empty or unknown
  suffix → `floor` with a warning; `resolve(undefined)` → `floor`. Nothing resolves to
  "everything" (a module's widest toolset is reachable only by naming it).
- **Server boot** (`./server`): `createComposedServer` (options `info`, `modules`, `shared?`,
  `bundle`, `env?`, `envVarHint?`, `oauth?`) is the one boot sequence every composed server shares:
  env-typo warnings, the HTTP edge policy, OAuth, ONE module selection, the boot log, the plugins of
  the active modules, each plugin's `register` recorded once (a tool, prompt or resource name or a
  resource URI two modules register fails the boot, naming both; so does an input schema that lets
  an unknown key through, a resource under `ui://views/`, which the boot keeps for the bundle, or a
  tool that binds neither the view of its own name, `ui://views/<tool>.html`, nor a resource a
  module registered), the bundle views the tools bind primed
  once with your `bundle`, then per request a fresh `McpServer` with `serverInfo`/`instructions`
  that the recording replays into, behind the SDK's stateless `createMcpHandler`; request context
  and one log line per request (the error text on a failure), `/metrics` (optional
  `MCP_METRICS_TOKEN`), the Host/Origin guard in front of the OAuth gate,
  `/health/*` and the font route (`installFontAssets`: Geist + Geist Mono as woff2 under
  `/fonts/geist-<version>/`, cached immutable, any origin, behind the guard). OAuth comes from one
  provider's `MCP_OAUTH_*` variables: a resource server that verifies tokens with `jose`; tokens
  must carry `<MCP_URL>/mcp` in `aud`
  (RFC 8707) and a `sub`, and the boot logs that audience. The providers, what fails the boot and
  the identity provider's side are under
  [Security](https://miragon.github.io/pulse/mcp/operations#security). Without a provider the boot
  runs unauthenticated with one warning. OAuth is the only caller identity, and `oauth` installs a
  provider instead (a test's stub IdP). Every bundle view advertises `MCP_URL`'s origin in its
  view CSP `resourceDomains` and the Apps SDK `openai/widgetCSP` (`fontAssetsCsp`, merged into its
  tool as it registers); without `MCP_URL` the boot appends the origin the host read the
  view from. `HostDocument` declares the faces from that origin (`declareServedFonts`,
  `font-display: swap`), so a host that blocks it shows its own font, then the system's.
  The entry runs it through `runComposedServer(createApp)`, in production and under `pnpm dev`
  alike, which prints a failed boot as one line naming the server and the
  setting (a ZodError as `path: message`, no stack; a bug's TypeError, ReferenceError or RangeError
  adds its frames) and exits 1.
  `listen({ handleSignals: true })` is
  the SDK's `toNodeHandler` (`@modelcontextprotocol/node`) behind a check of the raw target (a path that is not its own normal form gets 404 on every route, a `Host` that holds more than a host or names none 400, a TRACE, which no `Request` can carry, 405) and a request-body cap (`MCP_MAX_BODY_BYTES`, 413 before buffering),
  an in-flight body budget of 4× the cap (503) and a 30 s request timeout, plus a graceful drain
  (stop accepting, in-flight requests finish, readiness 503 `draining`). The guard is DNS-rebinding
  protection: `Host` (and a POST's `Origin`) must be localhost-class, `MCP_URL`'s or in
  `MCP_ALLOWED_HOSTS`/`MCP_ALLOWED_ORIGINS`; `/health*` and `/metrics` stay reachable by IP for
  probes and scrapers. `/mcp` answers POST only (405 for GET, DELETE and HEAD, as the SDK's
  stateless handler does).

## Where it fits

```
engine-connector widgets (and your modules')
            │  use
            ▼
   @miragon/pulse-widget-shell   ──  view runtime · view builders · host-bound UI
            │  build on
            ▼
   @modelcontextprotocol/ext-apps (the view's host, behind one adapter) · @tanstack/react-query · @miragon/pulse-ui (design kit)
```

One package, two halves that share one wire protocol: `./widgets` is `src/ui`, `./server` (and
`./testing`) the rest of `src/`, and both import the protocol modules in `src/protocol` (tool
results, the view name, the served fonts, the translator, the BPMN-name reader), which import
nothing themselves. The shipped code of one half imports nothing of the other (tests and the
`./testing` fixtures aside): a server never loads React and a view bundle never loads the boot.
dependency-cruiser holds the seam (`widget-shell-views-browser-only`,
`widget-shell-server-headless`, `widget-shell-protocol-is-a-leaf`), and the two tsconfigs type
each half with its own runtime's globals (`tsconfig.widgets.json`: DOM, no Node; the protocol
under both).
