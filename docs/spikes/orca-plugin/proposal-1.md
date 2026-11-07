# Proposal 1: Pulse in Orca, as close to VS Code as Orca allows

Engines tree in a right-sidebar panel, each cockpit view a custom editor tab, the active engine in
the status bar, commands in the palette. A trusted worker runs the core panels and the C7
adapter, as `apps/vscode/dev/host/dev-host.ts` does in plain Node. Ids from the
[inventory](inventory.md); Orca 1.4.252; "guess" marks what no doc, typing or plugin confirms.

## 1. Mapping per feature

| ID                  | Orca surface                                                                         | How                                                                                                                                                                                                     | Fallback                                                                          | Cite                                                        |
| ------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| S1                  | Right-sidebar panel "Pulse", icon `activity`                                         | `contributes.panels`, `ui: "components"`                                                                                                                                                                | none needed                                                                       | [PanelContribution][m-panel]                                |
| S2                  | `Tree` in that panel                                                                 | One item per target: label = name, description = "PROD · CIB seven 2.0 · read-only", `defaultExpanded` = active engine                                                                                  | none                                                                              | [Tree][dui-cat], [TreeItem][t-data]                         |
| S3                  | Lazy `Tree` children                                                                 | `hasChildren`, then `engines.definitions` from the worker fills `children` (`DefinitionNodes`)                                                                                                          | none                                                                              | [Tree][dui-cat]                                             |
| S4                  | Tree item `icon` + `description`                                                     | A TreeItem has no badge or tone: definitions with incidents get icon `error` and "3 incidents · 5 running · v4"; production engines icon `warning`                                                      | `Table` with a count column, if the icon is too weak                              | [TreeItem][t-data]                                          |
| S5                  | Tree items with `warning`/`error` icon                                               | `Problems.of` text; `onAction` on a file problem opens `.pulse-cli.json` by `editor.open`                                                                                                               | `Callout` above the tree                                                          | [editor.open][h-methods]                                    |
| S6                  | `IconButton` `refresh` in a `Toolbar` + palette command                              | `engines.refresh`; command `pulse.refresh`                                                                                                                                                              | none                                                                              | [Catalog][dui-cat], [CommandContribution][m-cmd]            |
| S7                  | `IconButton` `settings` + palette                                                    | Worker writes the template with Node fs if missing, then `editor.open`                                                                                                                                  | none                                                                              | [editor.open][h-methods], [git-log openTab][gl-tab]         |
| S8                  | `EmptyState` with a "Configure engines" button                                       | Shown when only the `local` fallback fails                                                                                                                                                              | none                                                                              | [Catalog][dui-cat]                                          |
| S9                  | Tree `onAction` on an engine; palette "Open engine overview" (active engine)         | Handle file `view: "engine"` (section 2)                                                                                                                                                                | none                                                                              | [CustomEditorContribution][m-editor]                        |
| S10                 | Tree `onAction` on a definition; drills in a tab                                     | Handle files `definition` / `instance`                                                                                                                                                                  | none                                                                              | section 2                                                   |
| S11                 | `Input type="search"` in the panel, `onSubmit`                                       | `instance.find`; several matches as a `List` under the field                                                                                                                                            | A palette command cannot prompt and the worker has no clipboard: no palette entry | [Catalog][dui-cat], [host methods][h-methods]               |
| S12                 | `Select` "Engine" in the panel; status-bar press                                     | Select sets the active engine (stored with `storage.set`); the status-bar command steps to the next engine (guess: no picker API)                                                                       | panel only                                                                        | [statusBarItems][m-status]                                  |
| S13                 | Status bar item `engine`                                                             | `statusBar.update`: "shop-dev · LOCAL · 10 incidents", tone `danger` for production                                                                                                                     | No active-file API, so no per-`.bpmn` figure                                      | [statusBar.update][h-methods]                               |
| S14                 | Custom editor on `.bpmn`, `priority: "option"` ("Runtime data" toggle beside Source) | The frame reads the XML, sends the process ids; the worker finds the file with `BpmnModelSource`                                                                                                        | later                                                                             | [CustomEditorContribution][m-editor]                        |
| S15                 | Worker `DefinitionsLoop`                                                             | Lease from the panel's `ctx.visible` (section 6)                                                                                                                                                        | manual refresh                                                                    | [Lifetime][dui-life]                                        |
| S16                 | Hook `editor.save.before` on `.bpmn`; `agent.status.changed` to `done`               | Nudge local engines, return nothing                                                                                                                                                                     | later                                                                             | [Hooks][h-hooks], [Events][h-events]                        |
| S17                 | Tree `selected`                                                                      | Worker posts `engines.focus` when a tab attends                                                                                                                                                         | later                                                                             | [TreeProps][t-data]                                         |
| S18                 | Custom editor on `.board.json`; a longer suffix opens by default                     | Board files are real files: the closest fit of all                                                                                                                                                      | later; no `jsonValidation`, the parser's problems show in the tab                 | [CustomEditorContribution][m-editor]                        |
| C1                  | Worker, Node fs                                                                      | Focused workspace from `workspace.readContext`, matched in `workspace.list`; read every `.pulse-cli.json` under its path; local hosts only                                                              | refuse remote workspaces with a message                                           | [host methods][h-methods], [pitfalls][pa-pit]               |
| C2                  | `fs.watch` + `settings.onDidChange` + event `workspace.changed`                      | Reload the registry                                                                                                                                                                                     | Refresh                                                                           | [orca-worker.d.ts][t-worker] `settings`, [Events][h-events] |
| C3                  | Form in the panel: `Input`, `Input type="password"`                                  | `credentials.set` to the worker; `secrets.protection` must be `os-keyring`, key `<file>::<profile>` bound to the origin as in `packages/core/runtime-view/src/host-kit/connections/credential-store.ts` | refuse to store; no plaintext fallback                                            | [secrets.*][h-methods], [credentials][pa-cred]              |
| C4                  | Worker                                                                               | `TargetPolicy`, `FailingRuntime` unchanged                                                                                                                                                              | none                                                                              | n/a                                                         |
| C5                  | Setting `environments`, `multiline` string, one `name=production` per line           | Orca settings are per plugin, so a workspace cannot set them (stronger than VS Code)                                                                                                                    | none                                                                              | [SettingContribution][m-set]                                |
| C6                  | Tree description                                                                     | `describeEngine` in the worker                                                                                                                                                                          | none                                                                              | n/a                                                         |
| C7                  | Unchanged core                                                                       | `Problems`, error translation                                                                                                                                                                           | none                                                                              | n/a                                                         |
| C8                  | Setting `writes`, `enum` localOnly / enabled / disabled                              | `WritePolicy` unchanged                                                                                                                                                                                 | none                                                                              | [SettingContribution][m-set]                                |
| C9                  | Confirmation card in the components panel                                            | Section 3                                                                                                                                                                                               | none                                                                              | [Isolation][dui-iso]                                        |
| C10                 | `orca.log`                                                                           | `AuditLog { info }` of `packages/core/runtime-view/src/host-kit/connections/write-audit.ts` fits as is; read with `orca plugin logs`                                                                    | none                                                                              | [authoring][a-frames]                                       |
| C11                 | Four `enum` settings `liveLocal`, `liveTest`, `liveProduction`, `liveUnclassified`   | `LivePolicy`; "turn on" is a worker `settings.set`                                                                                                                                                      | none                                                                              | [SettingContribution][m-set]                                |
| P1                  | Custom editor tab per handle file                                                    | Key in the file name; `editor.open` again to reveal (guess: it focuses the open tab); title = file name (guess: no API retitles a tab)                                                                  | none                                                                              | section 2                                                   |
| P2 to P6, P8 to P10 | The webview bundle unchanged, in the editor frame                                    | Contract of section 4                                                                                                                                                                                   | none                                                                              | [Custom editors][a-editor]                                  |
| P7                  | `light`/`dark` class on `<html>` + `theme` event                                     | Shim maps it to `data-cd-theme`, as the modeler suite does; no high contrast                                                                                                                            | `prefers-contrast: more` for high contrast                                        | [Custom editors][a-editor], [mount.ts][ms-mount]            |
| P11                 | Handle `view: "engine"`                                                              | As S9                                                                                                                                                                                                   | none                                                                              | section 2                                                   |
| P12                 | Handle files per drill; `pickInstance`                                               | `toSide` is ignored (`editor.open` has no column); the picker is a shim overlay in the frame (picking grants nothing)                                                                                   | none                                                                              | [editor.open][h-methods]                                    |
| P13                 | Webview controls                                                                     | Attention from the frame (section 6)                                                                                                                                                                    | none                                                                              | n/a                                                         |
| P14                 | `getState`/`setState`                                                                | Shim over `localStorage`, keyed by the handle key                                                                                                                                                       | memory only when storage throws                                                   | [Files and assets][a-files]                                 |
| P15                 | `copy` intent                                                                        | The shim runs `document.execCommand('copy')` inside the click, before it forwards the intent; `navigator.clipboard` is refused                                                                          | handover text (async, the gesture is gone): a selectable text box                 | [Isolated guests][iso-guest]                                |
| P16                 | `orca.shell.openExternal`                                                            | The shim asks `pulse.webUiUrl`, then opens within the click's activation window                                                                                                                         | none                                                                              | [frames][a-frames], [host API][h-intro]                     |
| P17                 | `.log` file in Source                                                                | Worker writes `.orca/pulse/incidents/<id>.log`, then `editor.open`                                                                                                                                      | frame links to code: later                                                        | [editor.open][h-methods]                                    |
| P18                 | `editor.open` on the model or source file                                            | No line or element parameter                                                                                                                                                                            | later                                                                             | [editor.open][h-methods], [pitfalls][pa-pit]                |
| P19                 | Retry: should; set variable, move token: later                                       | Through section 3; `valueJson` must fit the 64 KiB request cap with its envelope                                                                                                                        | none                                                                              | [limits][a-data]                                            |
| P20, P21            | Bulk, migration                                                                      | Same confirmation path                                                                                                                                                                                  | later                                                                             | n/a                                                         |

## 2. Opening a cockpit tab without a file

| Way                                              | For                                                          | Against                                                                                                                                                               |
| ------------------------------------------------ | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Custom editor on `.pulse-cli.json` (`filenames`) | No extra files                                               | Orca opens `.json` itself, so it would only be an option beside Source ([CustomEditorContribution][m-editor] `priority`); one tab only; it hides the file people edit |
| Worker-written handle file + `editor.open`       | Any number of tabs, one per key; the worker picks the moment | Needs `workspace:write`; files show in the tree ([git-log][gl-tab], [tienne.git-logs][pa-tab])                                                                        |
| `newFiles`                                       | "+ → Pulse engines" in the tab bar                           | User-started only; `untitled.pulse` at the root, kept after close when templated ([prior art §2][pa-new])                                                             |
| Everything in the panel                          | No files                                                     | A narrow sidebar cannot carry a bpmn-js diagram; no tabs, no back and forth                                                                                           |

**Recommendation: handle files, plus `newFiles` as a second entry point.** The worker writes
`.orca/pulse/<engine>/<view>-<id>.pulse` in the focused workspace and a `.orca/pulse/.gitignore`
holding `*`. The folder then ignores itself, so the worker never edits `.git/info/exclude`
(git-log does, [gl-tab][gl-tab]). After that it calls `editor.open` with the relative path, as
git-log does. Content: `{"pulse":1,"engine":"shop-dev","view":"definition","bpmnProcessId":"order-fulfillment"}`.
It holds no URL and no login: the worker resolves the engine name against its own targets, so a
crafted handle (by an agent, say) can open only a configured engine. The editor reads the
handle once with `orca.document.get()` and never edits it, so the tab never turns dirty
([orca-frame.d.ts][t-frame] `EditorDocumentApi`). Version and filter changes stay inside one tab:
one handle per engine, view and id, unlike VS Code's variant keys. A `newFiles` template
`{"pulse":1,"view":"engine"}` (active engine) gives the + menu entry
([NewFileContribution][m-newfile]). Guess: Orca restores the tab after a restart (section 6).

## 3. Write confirmations without native modals

The rule ([writes ADR](../../../apps/vscode/docs/adr/writes.md), "Intents carry no authority"):
a click in the view is no consent. In Orca the editor frame renders engine data (names,
messages, variables) in a DOM, and frames have `disableDialogs`, so `confirm` does nothing
([Isolated guests][iso-guest]). A trusted confirmation needs a surface where engine text cannot
become script and where the worker can tell who answered:

- The components panel is that surface: Orca draws it with its own controls from JSON props,
  without a DOM the person sees ([Isolation][dui-iso]), so engine strings stay text.
- The worker knows the caller: each request carries `PanelCaller` (`id`, `surface`,
  `contributionId`), set by Orca, not by the frame ([orca-worker.d.ts][t-worker]).

Flow:

1. The tab's Retry sends `retryIncident`. The core resolves it against its snapshot and calls
   `PanelEffects.confirmWrite`. `ConfirmationPolicy` (`packages/core/runtime-view/src/host-kit/connections/confirmation-policy.ts`)
   gives the level. At level "none" (loopback) the click is the confirmation, as today.
2. Otherwise the worker keeps a pending write `{ id, engine, facts, level, expiresAt: +120 s }`.
   It posts `writes.pendingChanged`, turns the status bar item to "Confirm write on shop-test",
   tone `warning`, and the tab's state shows "Waiting for your confirmation in the Pulse panel".
3. The panel draws a `Callout` (tone `danger` for production) with `KeyValue` facts. A
   type-the-host level adds an `Input`. Confirm and Cancel are Orca `Button`s.
4. `writes.answer` counts only when `surface === "panel"` and `contributionId === "engines"`, and
   only for a pending id. The typed host must match. Every answer and write goes through
   `WriteAudit` to `orca.log`. Expired, restarted or unknown ids are refused, never retried.

Weaker alternatives, both inside the frame that renders engine data: a frame `<dialog>`
(graphiql, git-control) or two-click arming (docker-logs) ([prior art §4.5][pa-conf]). Open: a
frame that navigates to another plugin HTML page gets the panel API ([Files and
assets][a-files]), so the plugin ships no other HTML page (guess: a navigated frame keeps its
`contributionId`). No host method opens the panel ([host methods][h-methods]): the status bar
item and the tab text point to it.

## 4. Frame and worker contract

One file `protocol.ts` declares `PluginRequests` and `PluginPanelEvents`
([Panels, workers and data][a-data]). The worker keys each tab by `context.panel.id`, which stays
the same while the tab is open ([orca-worker.d.ts][t-worker]). Answers are
`{ ok: true, value } | { ok: false, error: { kind, message } }`, as in graphiql
([prior art §4.8][pa-contract]).

| Request (frame → worker)                                                   | Input                                                                      | Output                                                                           |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `pulse.view.open`                                                          | handle document + saved UI state                                           | `{ revision }`; a `ready` intent follows from the webview                        |
| `pulse.view.intent`                                                        | `{ intent }`, a `WebviewIntent` checked by `MessageGuards.isWebviewIntent` | `{}`                                                                             |
| `pulse.view.state`                                                         | `{ after: revision }`                                                      | `{ revision, state, back? }` with each `diagramXml` replaced by `{ diagramRef }` |
| `pulse.diagram`                                                            | `{ engine, definitionId }`                                                 | `{ xml }`, cached in the frame per definition                                    |
| `pulse.view.attend`                                                        | `{ visible, focused }`                                                     | `{ known }`; false after a worker restart                                        |
| `pulse.webUiUrl`                                                           | `{ target }`                                                               | `{ url }`                                                                        |
| `engines.list`, `engines.definitions`, `engines.refresh`, `engines.attend` | engine name                                                                | rows for the Tree                                                                |
| `engines.open`                                                             | `{ engine, view, id? }`                                                    | writes the handle, `editor.open`                                                 |
| `instance.find`, `credentials.set`, `writes.pending`, `writes.answer`      | as named                                                                   | as named                                                                         |

Small posts (worker → frames): `pulse.view.changed { revision }` to one tab (`{ panel: id }`),
`engines.changed`, `writes.pendingChanged`.

Sizes: an input may be 64 KiB, an answer 1 MiB, a post 256 KiB, with 200 posts per 10 s per
plugin ([Panels, workers and data][a-data]). `StatePublisher`
(`packages/core/runtime-view/src/core/panels/state-publisher.ts`) sends the whole `PanelState` on every
publish, `diagramXml` included (`packages/core/runtime-view/src/core/protocol/view-models.ts`). The sandbox
diagrams measure 5 to 12 KB (shop-dev, 2026-11-07). Real models of several hundred KB would not
fit a post. Hence notify, then pull: the post is a revision only, the pull leaves out the XML,
and the XML travels once per definition. A state over 1 MiB fails with `too_large` and shows the
problem screen. Guess: chunk `pulse.diagram` by offset for XML over 1 MiB.

The frame side is a shim of about 100 lines, loaded before `dist/webview.js`, and the webview
code does not change. It defines `acquireVsCodeApi()` for
`packages/core/runtime-view/src/webview/host/host-bridge.ts` (`postMessage` becomes `pulse.view.intent`,
`getState`/`setState` go to `localStorage`) and handles `copy`, `openWebUi` and `pickInstance`
itself. It dispatches each pulled state as a window `message` event with a revision counted in
the frame, since `HostBridge` drops a revision at or below its last and a restarted worker starts
at 1 again.

## 5. Bundling and where the code lives

"Apps never import each other" (root `CLAUDE.md`), and the same file says another interface is
an app of its own. A new apps/orca that imports `apps/vscode/src` breaks the first rule.

Spike (recommended now): an Orca host inside `apps/vscode` beside the VS Code host, as a new
layer apps/vscode/src/orca. Its allowed edges in `apps/vscode/.dependency-cruiser.cjs` go to core,
protocol, contract, `apps/vscode/src/host/composition-root.ts` and the vscode-free files of
`apps/vscode/src/host/connections`. Rewritten for Orca, each small: the registry, target
discovery (Node fs), settings, a `SecretStorage`-shaped wrapper over `orca.secrets`, the panel
host (`PanelEffects`, about 60 lines in the dev host) and the panel confirmation. Product (an
owner decision): move contract, core, protocol, the C7 adapter, the pure connection rules and
the webview into a package of the engine family and build apps/orca from it, a large move.

A second esbuild script next to `apps/vscode/scripts/build.mjs` writes the plugin tree:

- worker: `platform: "node"`, ESM, engine-core bundled as the extension bundles it. Orca 1.4.252's
  Electron framework carries the string v24.22.1 (guess: the worker's Node); engine-core needs
  at least 22.22.2;
- editor: `editor/index.html` + shim + the unchanged `dist/webview.js`, CSS and fonts, with
  `"frame": "isolated"` as the modeler suite sets it ([manifest][ms-manifest]); frames load only
  relative files ([Files and assets][a-files]);
- panel: TSX bundled with `--external:orca` ([Bundling instead][dui-bundle]).

Limits: 2,000 files, 50 MiB, 10 MiB per entry ([authoring][a-load]). Manifest: `trusted-worker`,
`engines.orca >=1.4.248` (isolated editors, status bar items, hooks), capabilities
`workspace:read`, `workspace:write`, `storage:own`, `secrets:own`, `settings:own`. The
`@miragon/modeler-shell` pinned in `apps/vscode/package.json` has no Orca entry yet (the modeler
suite's newer shell has one): copy its theme bridge into the shim or bump the pin.

## 6. Live refresh with a worker that may stop

Facts: workers "may be stopped at any time" and lose memory ([Stability][a-stab]); with `main`
and `statusBarItems` the worker starts on enable and is kept running while enabled
([statusBarItems][m-status]); a components panel runs only while it is the open sidebar tab
([Lifetime][dui-life]).

Design: the core loops (`packages/core/runtime-view/src/core/refresh/definitions-loop.ts`, `RefreshLoop`) stay
in the worker on the `setTimeout` scheduler. Frames feed attention as leases: each tab calls
`pulse.view.attend` on `visibilitychange`, `focus`, `blur` and every 30 s (guess: a background
tab is `hidden` to its frame); no lease for 75 s means `hidden`, the 15-minute idle comes from
the webview's `activity` intent, the panel leases from `ctx.visible`. After a restart `attend`
answers `known: false` and the frame sends `pulse.view.open` again with its handle and UI state;
the last state stays on screen meanwhile, and pending writes die with the worker, by design.
Posts are coalesced to one per tab per second, far under 200 per 10 s. With no lease, the worker
reads the active engine every 60 s for the status bar, within `LivePolicy` (production off).

## 7. Risks

- Two hosts in one package (spike) bend the root rule "another interface is an app of its own".
  Extracting the shared code later is the larger cost.
- Capabilities are per plugin, not per surface: an editor frame may call `secrets.get` and
  `plugin.request` like the panel ([host methods][h-methods]). Isolating logins from the frame
  is our convention, enforced only by review.
- The worker's knowledge of the focused workspace rests on name and branch matching
  ([pitfalls][pa-pit]); the wrong match writes handles into another workspace.
- Handle files show in Orca's file tree (guess). No tab title API, no column, no line on
  `editor.open`, no picker or input box for palette commands: S11, S12, P12 and P18 lose comfort.
- The worker process model, its Node version and restarts are experimental ([Stability][a-stab]).
- A `PanelState` above 1 MiB without its XML (long variables, large pages) fails closed.
- Publishing: a catalog pins a commit of the plugin tree ([Publish][a-pub]), so the built tree must
  be committed somewhere, for example a mirror like `Miragon/pulse-starter`.
- Browser clients (`orca serve`) get neither components panels nor isolated editors
  ([Isolation][dui-iso], [CustomEditorContribution][m-editor]): desktop only.

[m-panel]: https://github.com/stablyai/orca/blob/main/docs/reference/plugin-manifest.md#panelcontribution
[m-cmd]: https://github.com/stablyai/orca/blob/main/docs/reference/plugin-manifest.md#commandcontribution
[m-editor]: https://github.com/stablyai/orca/blob/main/docs/reference/plugin-manifest.md#customeditorcontribution
[m-newfile]: https://github.com/stablyai/orca/blob/main/docs/reference/plugin-manifest.md#newfilecontribution
[m-set]: https://github.com/stablyai/orca/blob/main/docs/reference/plugin-manifest.md#settingcontribution
[m-status]: https://github.com/stablyai/orca/blob/main/docs/reference/plugin-manifest.md#statusbaritemcontribution
[h-intro]: https://github.com/stablyai/orca/blob/main/docs/reference/plugin-host-api.md#orca-plugin-host-api-reference
[h-methods]: https://github.com/stablyai/orca/blob/main/docs/reference/plugin-host-api.md#methods
[h-events]: https://github.com/stablyai/orca/blob/main/docs/reference/plugin-host-api.md#events
[h-hooks]: https://github.com/stablyai/orca/blob/main/docs/reference/plugin-host-api.md#hooks
[a-frames]: https://github.com/stablyai/orca/blob/main/docs/reference/plugin-authoring.md#frames-windoworca
[a-files]: https://github.com/stablyai/orca/blob/main/docs/reference/plugin-authoring.md#files-and-assets
[a-data]: https://github.com/stablyai/orca/blob/main/docs/reference/plugin-authoring.md#panels-workers-and-data
[a-editor]: https://github.com/stablyai/orca/blob/main/docs/reference/plugin-authoring.md#custom-editors
[a-load]: https://github.com/stablyai/orca/blob/main/docs/reference/plugin-authoring.md#2-load-it-while-you-work
[a-pub]: https://github.com/stablyai/orca/blob/main/docs/reference/plugin-authoring.md#5-publish-to-a-catalog
[a-stab]: https://github.com/stablyai/orca/blob/main/docs/reference/plugin-authoring.md#stability
[dui-cat]: https://github.com/stablyai/orca/blob/main/docs/reference/plugin-declarative-ui.md#catalog
[dui-life]: https://github.com/stablyai/orca/blob/main/docs/reference/plugin-declarative-ui.md#lifetime
[dui-iso]: https://github.com/stablyai/orca/blob/main/docs/reference/plugin-declarative-ui.md#isolation
[dui-bundle]: https://github.com/stablyai/orca/blob/main/docs/reference/plugin-declarative-ui.md#bundling-instead
[iso-guest]: https://github.com/stablyai/orca/blob/main/docs/reference/plugin-isolated-frames.md#isolated-guests-desktop
[t-worker]: file:///Applications/Orca.app/Contents/Resources/plugins/types/orca-worker.d.ts
[t-frame]: file:///Applications/Orca.app/Contents/Resources/plugins/types/orca-frame.d.ts
[t-data]: file:///Applications/Orca.app/Contents/Resources/plugins/declarative/orca-components-data.d.ts
[gl-tab]: https://github.com/stablyai/orca-community-mirror/blob/36f68b2f304aab6ca9410e90329809d5f20ccd12/src/worker/main.ts#L13-L62
[ms-mount]: https://github.com/Miragon/modeler-suite/blob/main/packages/shell/src/orca/webview/mount.ts
[ms-manifest]: https://github.com/Miragon/modeler-suite/blob/main/modelers/context-maps/apps/orca/orca-plugin.json
[pa-new]: prior-art.md#2-what-newfiles-is
[pa-tab]: prior-art.md#42-full-tab-view-without-a-file
[pa-cred]: prior-art.md#43-settings-and-credentials
[pa-conf]: prior-art.md#45-write-confirmations
[pa-contract]: prior-art.md#48-frame-and-worker-contract
[pa-pit]: prior-art.md#6-pitfalls-seen
