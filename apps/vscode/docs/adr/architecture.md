# Architecture

- Status: accepted
- Last reviewed: 2026-11-10 (the C7 adapter joined the c7 family as `@miragon/pulse-c7-adapter`); 2026-11-09 (#585 merged: the layers live in the runtime view and the engine adapter, which Pulse for Orca hosts too, the runtime view's contract is `@miragon/pulse-engine-core` and its own ports moved to `ports`; before that, the host kit's connections read the project file with `@miragon/pulse-profile`, the engine contract left the app for `@miragon/pulse-engine-core`, the engine family's neutral core, and 2026-11-08 Pulse's UI foundation in core and webview)

## Context

Pulse shows what a process engine is running, next to the BPMN models in VS Code.
It must be engine-neutral like the Miragon BPMN modeler: Camunda 7 family engines
(Operaton, CIB seven, Camunda 7) now, Camunda 8 later, without reworking the core.
The product owner asked for extremely good encapsulation: a core with logic and UI,
and adapter modules that only provide data and fulfil contracts.

## Decision

### Layers

Seven layers, as folders of three workspace packages since Pulse for Orca (`apps/orca`) became a
second host of the same runtime view: `ports`, `core`, `webview` and `model` (with the host
kit, the engine-neutral host rules both hosts share) in `packages/core/runtime-view` over the
engine contract of `@miragon/pulse-engine-core`, the C7 adapter in
`packages/connectors/c7/c7-adapter`, the VS Code host in `apps/vscode/src/host`.
The packages build their declarations only; each host bundles their sources with esbuild: the
extension its host as CommonJS for Node 22 and the webview as an IIFE.

| Layer        | Responsibility                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Runtime                               |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `ports`      | The ports only the editor hosts need, in `packages/core/runtime-view/src/ports`: `EngineAdapter` with the connection, the credentials and `EngineWebUi`, the local `ModelSource` and `CodeLocator` ports with the `WorkspaceFiles` seam and their read models. The engine contract they plug into is `@miragon/pulse-engine-core` (`packages/connectors/engine/engine-core`: the `ProcessRuntime` and `ProcessCommands` ports, read models and `RuntimeError`; its `./testing` the kit and an in-memory `FakeEngine`) | none (no DOM, no Node)                |
| `core`       | Engine-neutral logic: use cases turn read models into view models, panel sessions handle webview intents; `packages/core/runtime-view/src/core/protocol` holds the JSON-only messages and view models                                                                                                                                                                                                                                                                                                                 | none                                  |
| `webview`    | Preact UI and bpmn-js diagram. Renders protocol view models, sends intents                                                                                                                                                                                                                                                                                                                                                                                                                                            | browser                               |
| `c7-adapter` | `EngineAdapter`, `ProcessRuntime`, `ProcessCommands` and the Cockpit web UI for the Camunda 7 family ([c7-adapter.md](c7-adapter.md)); `packages/connectors/c7/c7-adapter/src/engine-rest` reads and writes the engine's REST API                                                                                                                                                                                                                                                                                     | Node                                  |
| `model`      | `ModelSource` and `CodeLocator` for the local workspace: reads `.bpmn` files with bpmn-moddle and its vendor descriptors, finds the implementing code ([local-sources.md](local-sources.md)); the only layer with those libraries                                                                                                                                                                                                                                                                                     | none (files through `WorkspaceFiles`) |
| `host-kit`   | The engine-neutral host rules both hosts share: targets from `.pulse.json`, the write and live policies, the write audit, logins, panel titles                                                                                                                                                                                                                                                                                                                                                                        | Node                                  |
| `host`       | VS Code host: composition root, connections, tree, panels, commands, status bar                                                                                                                                                                                                                                                                                                                                                                                                                                       | Node + `vscode`                       |

The core in the product owner's sense is everything that is engine-neutral
(`core`, `webview`, `host`); adapters only provide data.

### Allowed dependencies

The list is closed: every import edge not listed is an error
(one closed-world config per package: `packages/core/runtime-view/.dependency-cruiser.cjs`,
`packages/connectors/c7/c7-adapter/.dependency-cruiser.cjs`,
`apps/vscode/.dependency-cruiser.cjs`, each with `allowedSeverity: error`, run by
`pnpm lint:architecture:runtime-view`, `:c7-adapter` and `:vscode`).

```mermaid
flowchart TB
  extension --> core
  extension --> ports
  extension --> engineCore["@miragon/pulse-engine-core"]
  extension -- composition root only --> adapterC7[c7-adapter]
  extension -- composition root only --> modelAdapter[model-adapter]
  ports --> engineCore
  modelAdapter --> ports
  core --> ports
  core --> engineCore
  core --> tones["@miragon/pulse-ui/tones"]
  core --> format["@miragon/pulse-ui/format"]
  webview -- types only --> protocol[core/protocol]
  webview --> tones
  webview --> format
  adapterC7 --> ports
  adapterC7 --> engineCore
  adapterC7 --> c7core["@miragon/pulse-c7-core"]
  adapterC7 --> http["@miragon/pulse-http"]
  http -. "fetch" .-> rest[[engine REST API]]
```

```text
ports       → @miragon/pulse-engine-core (main entry only)
core        → ports (entry only), @miragon/pulse-engine-core (main entry only),
              @miragon/pulse-ui/tones, @miragon/pulse-ui/format (only from views/labels.ts)
protocol    → (nothing outside protocol)
webview     → protocol (type-only), @miragon/pulse-ui/tones,
              @miragon/pulse-ui/format (only from format/), preact,
              bpmn-js, diagram-js, modeler-shell, fonts
              (nothing else of @miragon/pulse-ui ships: no React kit, no stylesheet, no ./testing)
adapter     → @miragon/pulse-engine-core, @miragon/pulse-c7-core (main entries only), ports,
              @miragon/pulse-http (main entry only, from src/engine-rest/http)
model       → ports (entry only), @miragon/pulse-engine-core (main entry only),
              bpmn-moddle, camunda-bpmn-moddle, zeebe-bpmn-moddle (nothing else may import these)
host-kit    → core, protocol, ports, @miragon/pulse-engine-core (main entry only), Node built-ins
              @miragon/pulse-profile (main entry only, from host-kit/connections/)
host        → core, protocol, ports, host-kit, @miragon/pulse-engine-core (main entry only),
              vscode, modeler-shell, Node built-ins
              adapters and the model adapter only from host/composition-root.ts
tests, scripts, dev tooling → anything (the kit and FakeEngine: @miragon/pulse-engine-core/testing)
```

The engine contract is the core of the engine family, the neutral layer above the dialects:
`@miragon/pulse-engine-core` in `packages/connectors/engine/engine-core`, which esbuild bundles
like c7-core. It holds what every dialect answers (the read and write ports, ids,
read models, queries, `RuntimeError`, `FailingRuntime`, `ValueKinds`, `MoveReasons`,
`RootCauses`) and, in `./testing`, the conformance kit, its world and the fake. It is the
runtime view's contract too, its one home (owner decision 2026-11-09 on #585: the runtime view
keeps no contract layer of its own). What only the editor hosts need stays in the runtime view's
`ports`: `EngineAdapter` with the connection, the credentials and `EngineWebUi` (the links into an
engine's web UI differ between the MCP server and the editor hosts), the local ports and their
read models. The package keeps the extension's house rules (the repository's ESLint config names
its paths next to the editor trees') and imports nothing (the repository's
`family-core-is-a-leaf`); in the repository the runtime view's `ports`, `core`, `model` and
`host-kit`, the adapter, the hosts and their tests and dev hosts import it, besides the `src` of a
dialect's core (c7-core takes `RootCauses` from its main entry) and tests anywhere; the engine
connector and the CLI do not until they serve a second dialect (`engine-core-consumers`). The
runtime view is foundation code, and this is its one edge into a family, which the owner
accepted (`runtime-view-builds-on-the-engine-contract`). They import its entries, never a file of
the package by path (`engine-core-only-by-its-entries`): a module reached by path would be a
second copy of the contract, whose `RuntimeError` the first copy's `RuntimeError.is` no longer
recognises.
`@miragon/pulse-ui/tones` and `@miragon/pulse-ui/format` are the part of Pulse's UI foundation
the extension ships: the tone vocabulary and `SITUATION_TONES`, the one tone per situation (an
open incident, a running or suspended instance), and the formatters (times to the millisecond,
relative times, the one duration form, exact and compact counts with their lower bound, short
ids), both of which the MCP widgets read too. They import nothing (the repository's
`ui-foundation-entries-import-nothing`), so esbuild bundles about a kilobyte and no React.
The extension shares which tone a situation takes and how a date, a duration, a count or an id
reads, not a component: the webview draws the tone with its own CSS
([user-interface.md](user-interface.md)), `TimeLabels` and `CountLabels` (webview) and `Labels`
(core) delegate to the formatters and set their locale (English, a 24-hour clock:
`en-u-hc-h23`, once per layer: `Labels` in the core, `LabelLocale` in the webview), the
repository's date and number gates keep `Intl` and `toFixed` out of core and webview, and
`pulse-ui-only-its-foundation` keeps pulse-ui's React kit, its stylesheets and `./testing` out of
shipped code. Only those label helpers import the formatters (`core/views/labels.ts` and the
webview's `format/` folder, the closed world's one entry for `@miragon/pulse-ui/format`): the
formatters keep their locale in the module, so a module that called them directly would format
in the machine's locale until a helper had loaded.

The host kit's connections read `.pulse.json` with Pulse's profile format, for Pulse for VS Code
and Pulse for Orca alike, `@miragon/pulse-profile` (`packages/core/profile`, its main entry,
bundled by esbuild like c7-core): `TargetsParser` hands it the file's text under the credential policy `none` (a file
others share names neither a secret nor the variable that holds one) and maps each verdict onto a
target or a problem, `refusalsOn` with the extension's `Surface` for what it cannot serve (the
auth types bearer and passthrough, a named process engine, a missing `url`, `headers`), and
`describeProblem` for the wording, behind which `TargetsParser` puts the way out the format leaves
to each reader: after an auth type it refuses or the format does not take, the auth types a target
then connects with (those `TargetPolicy` lets connect, so not `oauth` yet); after `headers`, to
remove them. The format owns its JSON Schema and the shared fixtures (the
`./testing` entry of the package); the runtime view owns what it makes of each, in
`packages/core/runtime-view/test/host-kit/project-file-fixtures.expected.json`, so rewording a
problem changes no file of the package. The test
`packages/core/runtime-view/test/host-kit/project-file-fixtures.test.ts` holds
`TargetsParser` to them: every profile the format takes is a target with the format's URL, auth
type and read-only flag, or a named problem, and every fixture has exactly one expectation. The
extension reads profile by profile: a credential, a header or a key the format does not know
refuses that profile, never the file, and the other profiles still list engines.

Each layer has its own `tsconfig.<layer>.json` with `lib`/`types` matching its runtime,
so code that uses `document` in the core or `process` in the webview does not compile.

### Composition root

`apps/vscode/src/host/composition-root.ts` is the only place that knows engines. Its
class `CompositionRoot` holds one `EngineAdapter` per engine kind (`c7` → `C7Adapter`
in a `Record<EngineKind, EngineAdapter>`, so a new kind does not compile without its
adapter) and implements `EngineFactories`: for a configured target it
returns the `ProcessRuntime` and, where the adapter has them, the `ProcessCommands` and
the `EngineWebUi` (for a target with a `cockpitUrl`) of the adapter for `target.engine`. A target the target policy refuses (OAuth2,
credentials saved for another endpoint, basic credentials over plain HTTP) gets a
`FailingRuntime` with the refusal text and no commands; the connection builder keeps
the commands only when the write policy allows them ([writes.md](writes.md)). The
static `CompositionRoot.create` builds the adapters; nothing else constructs one.

The rest of the extension is VS Code wiring. `activate` in `extension.ts` hands the
`ExtensionContext` to `PulseExtension`, which builds the connection registry, the
trees, the status bar, the panel manager and the commands (each a class implementing
`Command`, registered by `CommandRegistrar`) and puts them into the context's
subscriptions. No DI container, no plugin registry: adding an engine means one adapter
folder and one entry in the composition root's adapter map.

### Host ⇄ webview protocol

Hand-rolled discriminated unions in `packages/core/runtime-view/src/core/protocol` with runtime guards
(`MessageGuards.isWebviewIntent` in the host; the webview, which may import only types,
checks state messages in its `HostBridge`). Rule: **intents in,
state out**. The webview sends intents (`ready`, `refresh`, `selectVersion`,
`filterInstances`, `filterProcesses`, `openInstance`, `openProcess`, `openCall`,
`retryIncident`, `setVariable`, `moveToken`, `setCredentials`, …); the
host answers by pushing the complete `PanelState` with a monotonically increasing
revision; the webview drops stale revisions. Write intents carry no authority: the core
resolves them against the shown snapshot, and the write state travels back in the view
like everything else. The bulk intents neither: `toggleInstances` names ids, but the
core keeps only its loaded rows that an offered action may touch; `selectMatching` and
`startBulk` (which names only the action) carry no ids, and the core collects them
itself ([writes.md](writes.md)). The same holds for jumps: `openCall` names only an element id, the
core finds the called process or instances in its snapshot and opens them through
`PanelEffects` (`openDefinition`, `openLatestDefinition`, `openInstance`, `openMigration`, `pickInstance`);
`openProcess` names only a BPMN process id, and the engine overview opens it only when its
snapshot lists it. A board ([boards.md](boards.md)) is the one panel over several engines: its
intents (`openBoardInstance`, `openBoardProcess`, `openBoardEngine`, `setBoardCredentials`)
name an engine and an id, and the core opens them only when the shown board lists them on that
engine. `filterProcesses` costs no engine call: the overview filters its
snapshot again. `filterInstances` carries up to five variable conditions as text with an
optional type; `VariableConditionRules` decides the type, and the guard drops a filter
whose condition does not fit it. `suggestVariableNames` names nothing either: the core
reads the names of the shown version once and puts them into the view. `openWebUi` carries no URL either: the core picks the shown version or
instance, or the engine's start page in the overview, the extension builds the URL with
the connection's `EngineWebUi` and hands it to `vscode.env.openExternal`. Nothing
awaits a reply, so no correlation is needed. View models carry ISO
timestamps; the webview formats them.

```mermaid
sequenceDiagram
  actor user as User
  participant host as extension
  participant panel as core: InstancePanel
  participant runtime as ProcessRuntime (C7ProcessRuntime)
  participant engine as Engine REST
  participant view as Webview

  user->>host: Go to Process Instance… ORD-10144
  host->>panel: open the panel for the instance
  view->>panel: intent "ready"
  panel->>runtime: getInstanceDetail(id)
  runtime->>engine: GET process instance, incidents, variables …
  engine-->>runtime: JSON
  runtime-->>panel: InstanceDetail (read model)
  panel->>panel: build the view model
  panel-->>view: state, revision n
  view->>view: draw diagram, badges, tabs
```

Panel sessions (`EnginePanel`, `DefinitionPanel`, `InstancePanel`, `MigrationPanel`, all implementing
`Panel`) live in the core and are free of VS Code: host actions go through the
`PanelEffects` port, which the extension implements. The browser dev host
(`apps/vscode/dev/host`) runs the same sessions (`?panel=engine`, `definition`, `instance`, `migration`).

The sessions build immutable snapshots and hand them to one `ViewSession`, which owns
the loaded view, the latest-wins ticket and the three published states (loading,
ready/refreshing, failed with the stale view), each carrying the panel's live updates
status. Only the newest load may publish or change state; "load more" is ignored while
a reload is in flight, and a quiet background read (`refreshQuietly`, driven by the
panel's `RefreshLoop`, [live-updates.md](live-updates.md)) skips while either runs and
never publishes `refreshing`. `rebuild` derives a new
view from the loaded snapshot without the engine (the overview's filter), and a session
whose last load failed republishes the failure with the stale view, never a fresh-looking
ready state. The extension keeps
one webview, one revision counter and one theme bridge per panel and rebinds the panel
to a fresh session whenever the connections reload (credentials, endpoint, refresh,
settings), disposing the old session's loop; it tells the session whether its panel is
watched, hidden, in a background window or idle.
Panels opened from a `.bpmn` file are keyed by the file URI and compare again with the
file's current content when _Show Runtime Data for This Model_ runs again.

## Consequences

- An undeclared or forbidden import fails the closed world of its package
  (`pnpm lint:architecture:vscode`, `:runtime-view`, `:c7-adapter`; negative tests in each
  package's `test/architecture`); a wrong global fails the package's `typecheck` through the
  `@ts-expect-error` probe of each layer (`packages/core/runtime-view/test/<layer>/runtime.boundary.ts`,
  `apps/vscode/test/host/runtime.boundary.ts`).
- A new engine takes `packages/connectors/<family>/<family>-adapter` with a class implementing
  `EngineAdapter`, an engine test that runs the `ConformanceKit` of
  `@miragon/pulse-engine-core/testing` and one entry in each composition root; core,
  protocol and webview stay untouched. A new engine question is a change to that package: a
  port, a read model, a law and a saboteur there, the use in the core here. ESLint keeps engine words
  out of them, and dependency-cruiser fails while a new adapter has no engine test. The
  spike built a Camunda 8 adapter this way against a mock of the REST API v2 and removed
  it again to keep the prototype small to check.
- Source-only layers keep the build to one esbuild run per host; the extension ships as one
  .vsix, Pulse for Orca as one plugin folder.

## Decision log

Consensus round 2026-10-21 (five reviewers). Repo shape was split 2:2 between one
package with folder rules and workspaces; workspaces won on the tie-break "hard,
machine-checked boundaries beat convention" because per-package tsconfigs close the
globals gap dependency-cruiser cannot see. Superseded on 2026-10-24 by the move into the
Pulse monorepo: its gates know one package per app, so the workspaces folded into one
package, and one tsconfig per layer keeps the globals boundary. `vscode-messenger` was
rejected in favour of plain unions (its host side is bound to the `vscode` API, which
blocks the browser dev host).

Revised on 2026-11-09: one package per app no longer holds for the contract. The product owner
decided on 2026-11-08 that the contract sits above the engine dialects, with Camunda 8 the second
dialect to speak it, so its ports, read models, kit and fake moved to the public workspace package
`@miragon/pulse-engine-core` (`packages/connectors/engine/engine-core`), the core of the engine
family, which the owner made the neutral layer above the dialects on 2026-11-09, with their
floors, their tests and their house rules. The extension stayed one package with six layers; its
contract layer became the barrel of that package plus the ports of the IDE, so no import of the
core, the adapters or the host changed. No `EngineDialect` seam and no C7 runtime moved with it.

Revised on 2026-11-09 again, when #585 (Pulse for Orca) joined: a second editor host runs the
same layers, so they moved out of the app into the private packages
`@miragon/pulse-runtime-view` (`packages/core/runtime-view`: ports, core, protocol, webview, model,
host kit) and `@miragon/pulse-c7-adapter` (`packages/connectors/c7/c7-adapter`, the C7
adapter), each with a closed world of its own; apps never import each other. The product owner
decided that the contract keeps its one home: the runtime view has no contract layer, its layers,
the adapter and the hosts import `@miragon/pulse-engine-core` directly, and the barrel's ports of
the IDE became the runtime view's `ports`. The runtime view importing a family's core is the one
edge of `packages/core` into a family, accepted with that decision. The C7 adapter, first an
exception in the engine family, joined the c7 family it implements by the same decision and keeps
to the rule of every family's adapter (`adapters-own-their-family`).
