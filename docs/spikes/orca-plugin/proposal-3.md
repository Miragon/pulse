# Proposal 3: least new code

The webview bundle runs unchanged in an Orca HTML frame. The core panels and the C7 adapter run
unchanged in the Orca worker. Only the glue is new: a frame shim that plays `acquireVsCodeApi`, and a
worker that plays the extension host, as `apps/vscode/dev/host/dev-host.ts` already does over SSE.
Feature ids are the [inventory](inventory.md)'s. Orca claims cite a source; "guess" marks the rest.

## 0. Shape, placement and files

**Frame.** `panel.html` (the sidebar panel) and `editor.html` (the custom editor, section 2) load
`bridge.js` (new), then the unchanged `webview.js`, `webview.css` and `fonts/`. Orca serves them
from the plugin folder by relative URL ([isolated frames][iso]). `bridge.js` defines the
`acquireVsCodeApi()` that `packages/core/runtime-view/src/webview/main.tsx` calls.

**Worker.** The worker (`trusted-worker`) keeps one session per frame, keyed by `context.panel.id`,
which "stays the same while it stays open" (orca-worker.d.ts `PanelCaller`). A session holds one
core `Panel`. Its `StatePublisher` posts to that frame only (`PanelsApi.post` with `{ panel }`).

**Navigation.** An `open*` effect posts `pulse.navigate`, and the shim sets `location.href`
(`panel.html?view=…&engine=…`). Links to pages in the plugin folder "navigate the frame"
([files and assets][a-files]). One document per view gives each view its own viewport and its own
`HostBridge` revisions, as in the dev host.

**Engine list.** The worker builds the home view in memory as a board. Every target is an engine,
with an `incidentSummary` per engine and per process, like
`apps/vscode/sandbox/.pulse/boards/shop-operations.board.json`. `BoardPanel` draws it unchanged.

| Placement                                                       | Repo rules                                                                                                                                                                      | Cost                                                                                                                      |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| A. `src/orca/{worker,frame}` inside `apps/vscode` (recommended) | No new package: naming, "apps never import each other" and the invariant 8 edges hold. Against the interface axis of the root `CLAUDE.md` ("an app of its own"): owner decision | 6 config seams                                                                                                            |
| B. New app at apps/orca                                         | Fits the axis, but may not import `apps/vscode/src`                                                                                                                             | Contract, core, protocol, webview, adapter and connections move to packages first: thousands of lines, every gate rewired |
| C. Packages only                                                | As B, plus a host somewhere                                                                                                                                                     | As B                                                                                                                      |

`src/orca`, not `dev/`: `src` is already linted, type-checked and tested by the package scripts
(pinned by `scripts/check-ratchets.mjs`); `dev/` would exempt shipped code from every dependency rule.

| New file (under apps/vscode)                             | Lines | Job                                                                           |
| -------------------------------------------------------- | ----- | ----------------------------------------------------------------------------- |
| src/orca/protocol.ts, src/orca/routes.ts                 | 105   | Contract (section 4); route to query string and back                          |
| src/orca/worker/main.ts                                  | 60    | Default export `activate`, the `JSON.rawJSON` check, the handlers             |
| src/orca/worker/frame-sessions.ts                        | 120   | Session per frame, route to core panel, size fallback                         |
| src/orca/worker/orca-panel-effects.ts                    | 110   | `PanelEffects` over posts, `editor.open`, notifications                       |
| src/orca/worker/orca-connections.ts                      | 100   | Stand-in for the registry: discovery, credentials, `ConnectionBuilder`, lanes |
| src/orca/worker/orca-secret-storage.ts, orca-settings.ts | 65    | Secrets as `CredentialStore` expects them; settings for environments and live |
| src/orca/worker/home-board.ts, frame-attention.ts        | 90    | Home board `BoardContext`; visibility to `Attention`                          |
| src/orca/frame/bridge.ts                                 | 120   | The shim: theme, navigation, copy, heartbeat                                  |
| src/orca/frame/login.ts and three html pages             | 115   | Credentials form (C3), the two entry pages                                    |
| src/orca/orca-plugin.json, scripts/orca-build.mjs        | 120   | Manifest; both builds into dist/orca                                          |
| test/orca/*.test.ts, test/webview/orca-bridge.test.tsx   | 330   | Fake `orca` API, sessions on FakeEngine, routes, shim                         |

That is about 1,000 production lines and 330 test lines.

**Reused unchanged:** `packages/core/runtime-view/src/webview`, `packages/core/runtime-view/src/core` (with `MessageGuards`),
`packages/core/runtime-view/src/contract`, `packages/connectors/engine/engine-adapter/src` with engine-core, `packages/core/runtime-view/src/model`,
`apps/vscode/src/host/composition-root.ts`, `packages/core/runtime-view/src/host-kit/live/timer-scheduler.ts`,
`apps/vscode/src/host/connections` except the five files that import `vscode` at runtime (registry,
watcher, settings, discovery, targets file), `packages/core/runtime-view/scripts/webview-build-options.mjs` and
`hostBuildOptions` of `apps/vscode/scripts/build.mjs`.

**Seams in apps/vscode** (configuration only, behaviour-neutral for the extension):

1. `apps/vscode/.dependency-cruiser.cjs`: `orca` in the own-layer rule, one allowed entry to the
   contract, core, protocol and adapter entries, `src/host/connections/`, the composition root and
   Node built-ins (the frame: protocol types only).
2. `apps/vscode/tsconfig.host.json` includes src/orca/worker (it type-imports `vscode` through
   `packages/core/runtime-view/src/host-kit/connections/credential-store.ts`); `packages/core/runtime-view/tsconfig.webview.json`
   includes src/orca/frame.
3. `knip.jsonc`: the worker main and the frame bridge as entries.
4. `apps/vscode/package.json`: a new `orca:build` script; the pinned lint, typecheck, test stay.
5. Tests to hold the floors of `apps/vscode/vitest.config.ts` (its coverage exclude only shrinks).
6. "Where code goes" in `apps/vscode/CLAUDE.md`, the boundary in `apps/vscode/docs/adr/architecture.md`.

Output goes to dist/orca: gitignored, skipped by the linters, kept out of the .vsix by
`apps/vscode/.vscodeignore`.

## 1. Feature mapping

| Id             | Orca surface          | How                                                                                                                                                                             | Fallback                     | Citation                                                                 |
| -------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------ |
| S1             | Sidebar HTML panel    | Manifest panel, icon `activity`                                                                                                                                                 | none                         | [PanelContribution][m-panel]                                             |
| S2, S6, S8, S9 | Panel, home view      | Board chip per target with product, running and incident counts; refresh; `LOCAL_TARGET` when there is no file; a chip opens the engine view                                    | none                         | `packages/core/runtime-view/src/core/boards/board-engine.ts`             |
| S3             | Panel, engine view    | `EnginePanel`: running, latest version and incidents per process                                                                                                                | one click deeper             | `packages/core/runtime-view/src/core/views/engine-view-builder.ts`       |
| S4, S5         | Panel, home view      | `incidentSummary` by engine and by process; production chips in red; problem strips                                                                                             | no "9+" badge                | `packages/core/runtime-view/src/webview/screens/board/board-engines.tsx` |
| S7             | Worker `editor.open`  | `editConnection` opens the `.pulse-cli.json` it read (`workspace:write`)                                                                                                        | a notice that names the path | [host methods][h-methods]                                                |
| S10, P1        | Panel or editor frame | One view per document; back is `history.back()` with a `back` label in the URL; the tab title stays fixed (orca-frame.d.ts has no title call; guess)                            | none                         | [files and assets][a-files]                                              |
| S11 to S17     | none in v1            | No command input, IDE events or tree; a status bar item would keep the worker running; `BoardPanel.attend` does nothing, so refresh is manual                                   | later                        | [status bar][m-status], [events][h-events]                               |
| S18            | Panel, board view     | The worker reads `.pulse/boards/*.board.json` with Node                                                                                                                         | later                        | `packages/core/runtime-view/src/core/boards/board-panel.ts`              |
| C1, C2         | Worker                | `workspace.list` on local hosts (`hostId` null; guess); Node reads each root's `.pulse-cli.json` through `TargetsParser`, dedupes by name and discovers again on each home open | all workspaces               | [host methods][h-methods]                                                |
| C3             | Frame `login.html`    | `setCredentials` navigates there; `pulse.setCredentials` stores through `CredentialStore` only on `os-keyring`                                                                  | refuse                       | [prior art 4.3][pa-cred]                                                 |
| C4, C6, C7     | Worker                | `TargetPolicy`, `Problems` and the product label as they are                                                                                                                    | none                         | `apps/vscode/src/host/composition-root.ts`                               |
| C5, C11        | Plugin settings       | `environments` as one JSON string; four on/off enums for live updates                                                                                                           | none                         | [SettingContribution][m-setting]                                         |
| C8, C9, C10    | Worker                | v1 builds every connection with writes `disabled`; section 3 later; `WriteAudit` writes to `orca.log`                                                                           | read-only                    | `packages/core/runtime-view/src/host-kit/connections/write-policy.ts`    |
| P2 to P11, P13 | Frame                 | Webview and core as they are; the theme comes through the shim (section 5)                                                                                                      | light only                   | `packages/core/runtime-view/src/webview/host/host-bridge.ts`             |
| P12            | Frame                 | Navigate; ignore `toSide`; `pickInstance` takes the first choice (incidents first)                                                                                              | the user goes back           | `apps/vscode/src/host/panels/vscode-panel-effects.ts`                    |
| P14            | Frame                 | `getState` and `setState` in `localStorage`, keyed by route                                                                                                                     | in memory                    | [files and assets][a-files]                                              |
| P15            | Frame                 | For a `copy` intent the shim runs `execCommand` inside the click; `copyHandover` goes through the worker                                                                        | none                         | [isolated frames][iso]                                                   |
| P16            | Frame                 | The worker posts the URL; the frame calls `orca.shell.openExternal`, which needs a click (guess: the round trip fits its time window)                                           | show the URL                 | [host API][h-methods]                                                    |
| P17 to P21     | later                 | Incident text and root cause stay visible; writes are off                                                                                                                       | later                        |                                                                          |

## 2. A cockpit "tab" without a file

| Way                                                                   | New code           | What the user gets                                                        |
| --------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------- |
| Everything in the panel                                               | none               | The right sidebar: narrow for a diagram                                   |
| Custom editor on `.pulse-cli.json` (`filenames`, `frame: "isolated"`) | 15 lines           | The same page at full width, through the view toggle                      |
| Handle file the worker writes, then `editor.open`                     | about 80           | A tab per view, with files in the tree ([prior art 4.2][pa-tab])          |
| `newFiles`                                                            | 10, plus an editor | `untitled.pulse` at the workspace root ([NewFileContribution][m-newfile]) |

**Recommendation: the panel, plus the custom editor on `.pulse-cli.json`.** One page serves both
(the shim branches on `orca.document`, orca-frame.d.ts "Custom editors only"); opening a view writes
no file and needs no `workspace:write`. The editor never calls `applyEdit`, so the tab never turns
dirty ([custom editors][a-editors]). Orca opens `.json` in Source ([CustomEditorContribution][m-editor]:
"always behave as `option`"), so the person picks Pulse in the view toggle (guess: also for a
`filenames` entry ending in `.json`). Guess: navigating the editor frame keeps the editor API; if
not, it swaps sessions in place with one shared `StatePublisher`
(`packages/core/runtime-view/src/core/panels/state-publisher.ts`), so revisions keep rising.

## 3. Write confirmations without native modals

v1 is read-only (C8): the core offers writes only with `commands`, and `confirmWrite` answers
`false` as well. Later: the dialog in the frame, the decision in the worker, since `alert` and
`confirm` do nothing there (`disableDialogs`, [isolated frames][iso]). The worker posts
`pulse.confirm { id, title, facts, confirmLabel, typeHost }` from the `WriteRequest`; the shim
draws a `<dialog>` (graphiql, git-control: [prior art 4.5][pa-confirm]) and answers
`pulse.confirmed { id, typed }`; the worker compares `typed` with the host itself, accepts each id
once within two minutes and records it with `WriteAudit`. Cost: VS Code's modal
(`apps/vscode/src/host/panels/write-dialog.ts`) sat outside the webview; this dialog sits beside the
button, so "a click carries no authority" weakens and `apps/vscode/docs/adr/writes.md` must say so.

## 4. The frame and worker contract

```ts
declare module "orca" {
  interface PluginRequests {
    "pulse.open": { input: { route: Route; back?: string }; output: { session: string } }
    "pulse.intent": {
      input: { session: string; intent: WebviewIntent }
      output: { known: boolean }
    }
    "pulse.attention": { input: { session: string; visible: boolean }; output: { known: boolean } }
    "pulse.state": { input: { session: string }; output: StateMessage }
    "pulse.setCredentials": {
      input: { engine: string; username: string; password: string }
      output: null
    }
  }
  interface PluginPanelEvents {
    "pulse.state": { session: string; message: StateMessage }
    "pulse.stateTooLarge": { session: string; revision: number }
    "pulse.navigate": { session: string; to: Route | "back"; back?: string }
    "pulse.openExternal": { session: string; url: string }
  }
}
```

The shim turns `postMessage(intent)` into `pulse.intent`; the worker checks it with
`MessageGuards.isWebviewIntent` and calls `Panel.handle`. Each `pulse.state` post reaches
`HostBridge` as a `MessageEvent` dispatched on `window`; the session id drops posts for an earlier
document. Limits: inputs 64 KiB, answers 1 MiB, posts 256 KiB and 200 per 10 s
([panels, workers and data][a-data]), `timeoutMs` up to 120 s (orca-services.d.ts
`PluginRequestOptions`).

Measured with the dev host bundled into the scratchpad against shop-dev: loading 240 B,
order-fulfillment definition 23,595 B (11,568 B of it BPMN XML), instance 19,544 B, engine 831 B.
Only the XML grows with the model; above 240 KiB the worker posts `pulse.stateTooLarge` and the
frame pulls `pulse.state` (1 MiB). `setVariable` allows a 64 KiB value
(`packages/core/runtime-view/src/core/protocol/message-guards.ts`), more than the input limit leaves after the
envelope, so writes need a 60 KiB cap. A failed request keeps the last state; the heartbeat retries.

## 5. Bundling

- **Frame**: `webviewBuildOptions` unchanged, `production: false`, no sourcemap, as modeler-suite's
  Orca builds do for the listing policy's readable code ([context-maps build.mjs][ms-build],
  [policy][policy]): `webview.js` 862,060 B (412,216 B minified), `webview.css` 139,109 B, 11 fonts
  of 147 KB, well within 2,000 files, 50 MiB and 10 MiB per entry ([limits][a-limits]). The shim is
  an esbuild IIFE of about 5 KB.
- **Worker**: `hostBuildOptions` with ESM output, no `vscode` external and the `createRequire`
  banner of `apps/vscode/scripts/dev-server.mjs`; the dev host built so is 391,266 B. Orca calls the
  default export `activate` ([files and assets][a-files]).
- **Node**: `packages/connectors/engine/engine-adapter/src/engine-rest/views/lossless-json.ts` needs `JSON.rawJSON`
  (Node 21 and later). Orca 1.4.252 bundles Electron 43.8.6 with Node v24.22.1 (version strings in
  its app bundle); [hello-orca][ex-hello] calls the worker "plain-Node". Guess: it runs on that
  Node. The version is experimental ([stability][a-stab]), so `activate` checks `JSON.rawJSON` first.
- **Theme**: the shim copies Orca's `light`/`dark` class on `<html>` into `data-cd-theme` and, on
  each `theme` event (orca-frame.d.ts `FrameEvents.theme`), dispatches `modelerShell.appearance`,
  which the unchanged `mountVsCodeShell` listens for; `prefers-contrast: more` maps to high
  contrast as in [modeler-shell mount.ts][ms-mount]. `--orca-*` ([frame CSS variables][tok]) stays
  unused.
- **Not `@miragon/modeler-shell/orca/webview`**: Pulse pins 0.10.0 (`apps/vscode/package.json`)
  without that entry; `orcaEditorApi()` throws without `orca.document.session` ([api.ts][ms-api]),
  so not in a panel; `mountOrcaShell` would change `packages/core/runtime-view/src/webview/diagram/canvas-shell.ts`;
  `orcaEditorHost` ([editor-host.ts][ms-host]) syncs a document Pulse lacks. Worth taking: the
  theme mapping, and `installOrcaEditorStub` ([orca-stub.ts][ms-stub]) for a smoke test.

## 6. Live refresh when workers may stop

Workers "may be stopped at any time" ([stability][a-stab]) and start on the next request. Sessions
live in worker memory, routes in the frames' URLs, so a session can be rebuilt. While
`document.visibilityState` is `visible`, the shim sends `pulse.attention` every 15 s; `{ known:
false }` means a restart, and the shim sends `pulse.open` again. Hidden frames send nothing, and the
core pauses. `frame-attention.ts` maps visibility and the existing `activity` intent to `watched`,
`hidden` or `idle`; `LiveContext` uses `TimerScheduler` and `LiveSwitch` as
`apps/vscode/src/host/live/live-wiring.ts` does. One post per tick stays far below 200 per 10 s. Not
chosen: a status bar item, which keeps the worker running while enabled ([status bar][m-status]).
Guess: an HTML panel unmounts on a sidebar tab switch like a components panel ([lifetime][dui-life]);
the heartbeat covers it.

## 7. Risks and what the least-code choice costs the user

- **Costs to the user**: narrow by default (full width only through the toggle on `.pulse-cli.json`,
  which hides Source); one view at a time, back through history, the first of several called
  instances; read-only, no stack trace document, no jump to model or code; an engine list, not a
  tree, without status bar or go-to-instance; targets of every local workspace, logins keyed by the
  absolute path of `.pulse-cli.json` (`packages/core/runtime-view/src/host-kit/connections/credential-store.ts`);
  Miragon colours, only light and dark follow Orca; up to 15 s stale after a worker stop.
- **Risks**: unchecked guesses (worker Node, navigation in the editor frame, a click still counting
  after a round trip, the `.json` toggle rule); Orca's `secrets.get` answers `null` where
  `CredentialStore` expects `undefined` (the adapter maps it); the owner decision on the interface
  axis, with option B's extraction later if the plugin stays; a catalog pins a commit and content
  hash ([catalogs][a-catalog]) while dist/orca is gitignored, so it needs a mirror repo (guess);
  committed pages need `DOCS_BUDGETS` entries (`scripts/docs-refs.test.mjs`).

[a-files]: https://github.com/stablyai/orca/blob/main/docs/reference/plugin-authoring.md#files-and-assets
[a-data]: https://github.com/stablyai/orca/blob/main/docs/reference/plugin-authoring.md#panels-workers-and-data
[a-editors]: https://github.com/stablyai/orca/blob/main/docs/reference/plugin-authoring.md#custom-editors
[a-limits]: https://github.com/stablyai/orca/blob/main/docs/reference/plugin-authoring.md#2-load-it-while-you-work
[a-stab]: https://github.com/stablyai/orca/blob/main/docs/reference/plugin-authoring.md#stability
[a-catalog]: https://github.com/stablyai/orca/blob/main/docs/reference/plugin-authoring.md#5-publish-to-a-catalog
[h-methods]: https://github.com/stablyai/orca/blob/main/docs/reference/plugin-host-api.md#methods
[h-events]: https://github.com/stablyai/orca/blob/main/docs/reference/plugin-host-api.md#events
[m-panel]: https://github.com/stablyai/orca/blob/main/docs/reference/plugin-manifest.md#panelcontribution
[m-editor]: https://github.com/stablyai/orca/blob/main/docs/reference/plugin-manifest.md#customeditorcontribution
[m-newfile]: https://github.com/stablyai/orca/blob/main/docs/reference/plugin-manifest.md#newfilecontribution
[m-setting]: https://github.com/stablyai/orca/blob/main/docs/reference/plugin-manifest.md#settingcontribution
[m-status]: https://github.com/stablyai/orca/blob/main/docs/reference/plugin-manifest.md#statusbaritemcontribution
[iso]: https://github.com/stablyai/orca/blob/main/docs/reference/plugin-isolated-frames.md#isolated-guests-desktop
[tok]: https://github.com/stablyai/orca/blob/main/docs/reference/plugin-theme-tokens.md#frame-css-variables
[dui-life]: https://github.com/stablyai/orca/blob/main/docs/reference/plugin-declarative-ui.md#lifetime
[policy]: https://github.com/stablyai/orca/blob/main/docs/reference/plugin-listing-policy.md#safe-code
[ex-hello]: https://github.com/stablyai/orca/blob/main/examples/plugins/hello-orca/main.mjs
[ms-mount]: https://github.com/Miragon/modeler-suite/blob/main/packages/shell/src/orca/webview/mount.ts
[ms-api]: https://github.com/Miragon/modeler-suite/blob/main/packages/shell/src/orca/webview/api.ts
[ms-host]: https://github.com/Miragon/modeler-suite/blob/main/packages/shell/src/orca/webview/editor-host.ts
[ms-stub]: https://github.com/Miragon/modeler-suite/blob/main/packages/shell/src/testing/orca-stub.ts
[ms-build]: https://github.com/Miragon/modeler-suite/blob/main/modelers/context-maps/apps/orca/build.mjs
[pa-tab]: prior-art.md#42-full-tab-view-without-a-file
[pa-cred]: prior-art.md#43-settings-and-credentials
[pa-confirm]: prior-art.md#45-write-confirmations
