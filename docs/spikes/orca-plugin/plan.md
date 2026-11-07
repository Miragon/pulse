# Plan: Pulse as an Orca plugin (spike)

Built from the [inventory](inventory.md), the [prior art](prior-art.md) and three proposals:
[1, close to VS Code](proposal-1.md), [2, Orca-native](proposal-2.md),
[3, least new code](proposal-3.md). Feature ids (S*, C*, P*) are the inventory's. Orca facts cite
the docs ([authoring][a], [manifest][m], [host API][h], [frames][iso]) or the typings that ship
with Orca 1.4.252 in `/Applications/Orca.app/Contents/Resources/plugins/`; where the docs on `main`
are newer, `orca plugin validate` and the installed typings decide. Section 7 lists what the review
changed.

## Measured before planning

- The worker runs Node v24.22.1 with `JSON.rawJSON` and global `fetch`, and reaches
  `http://localhost:18090/engine-rest` (a probe plugin, `orca plugin dev request . probe.env`).
  `LosslessJson` and `EngineHttp` run unchanged.
- A definition state of shop-dev is 23.6 KB (11.6 KB of it BPMN XML), an instance state 19.5 KB
  (proposal 3): far below the 256 KiB post and 1 MiB answer limits ([panels, workers and data][a-data]).
- The worker modules bundle for Node with no `vscode` import left (their `vscode` imports are
  type-only), and `webviewBuildOptions` builds the webview into another folder unchanged
  (reviewer B). `orca plugin check` loads the real `webview.js`, `webview.css` and fonts in an
  isolated editor frame without warnings (reviewer A).
- Sandbox engines up: shop-dev (Operaton, no login), shop-test (CIB seven, demo/demo), prod-eu
  (unreachable by design). Order fulfillment v3 shows Check order 120 waiting and Charge payment
  4 incidents; ORD-10129 exists on v3.

## 1. Feature mapping

| Id                                         | Surface in Orca                                                                                                                                                                                    | Why                                                                                                                                                                               | Rejected (one line each)                                                                                                                                        |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1, S2, S3                                 | Components panel `engines` with Orca's `Tree`: engine rows, definitions as lazy children (`hasChildren` + `onToggle`), expanded keys in a keyed atom                                               | Closest to the Engines tree; Orca draws it, so it looks native and keeps engine text as text (`orca-components-data.d.ts` `TreeProps`)                                            | HTML panel with the board screen (proposal 3): no tree, Miragon chrome inside Orca's sidebar                                                                    |
| S4                                         | Definition rows as in VS Code: `icon: "error"` when `withIncident > 0`, description "3 with incident · 5 running · latest v4"; engine rows sum it as the engine overview does ("13 with incident") | `TreeItem` has no badge or colour; `withIncident` counts instances with an open incident, so the words stay "with incident" (`apps/vscode/src/core/views/engine-view-builder.ts`) | an "incidents" count: wrong, it counts instances                                                                                                                |
| S5                                         | Engine rows with `icon: "warning"` and the `Problems` text; a `Callout` above the tree for a broken `.pulse-cli.json`                                                                              | Same words as VS Code (`apps/vscode/src/core/panels/problems.ts`)                                                                                                                 | none                                                                                                                                                            |
| S6                                         | `IconButton` "Refresh" in a `Toolbar` at the top of the panel                                                                                                                                      | Cheap, needed while live is off; a panel has no header slot                                                                                                                       | a palette command: one more manifest entry for the same thing                                                                                                   |
| S7, S8, C1                                 | Plugin setting `projectFile` (a path to `.pulse-cli.json`), shown in Orca's Settings; the empty panel says where to set it                                                                         | Deterministic for the spike; the person's other workspaces are never scanned                                                                                                      | scan every workspace (`workspace.list`): reads unrelated projects' engines; a form in the panel: Settings already draws the declared setting                    |
| C5                                         | `pulse.environments` read from `.vscode/settings.json` next to the project file, as the workspace scope `EnvironmentClassifier` takes                                                              | The sandbox keeps them there; same scope rules as VS Code                                                                                                                         | a plugin setting: user scope only, so the sandbox would show no TEST or PROD                                                                                    |
| C3                                         | Selecting an engine that needs a login shows a form under the tree (`Input` text and `type: "password"`, `Button`); the worker stores them through `CredentialStore` over `orca.secrets`           | Orca-drawn controls; the worker never sends a secret to a frame (a frame could still read them, see section 6)                                                                    | login page in the editor frame (proposal 3): the frame renders engine text                                                                                      |
| C4, C6, C7                                 | Worker: `TargetPolicy`, `Problems`, product label, unchanged                                                                                                                                       | Pure classes, vscode-free                                                                                                                                                         | none                                                                                                                                                            |
| S10, P1                                    | Custom editor `pulse-view` on the suffix `.pulse-view`; the worker writes a handle file, calls `workspace.open`, then `editor.open` with the path relative to the workspace                        | A full editor tab per view, like VS Code's panels; the pattern of git-log and tienne.git-logs (prior art 4.2)                                                                     | custom editor on `.pulse-cli.json`: only an option beside Source, one tab; everything in the panel: too narrow for bpmn-js; `newFiles` alone: user-started only |
| P2 to P6, P8 to P11                        | The unchanged webview bundle in the custom editor frame (`frame: "isolated"`), mounted through a shim that defines `acquireVsCodeApi`                                                              | Zero webview changes; the dev host proves the seam (`apps/vscode/dev/host/dev-host.ts`)                                                                                           | `@miragon/modeler-shell/orca/webview`: Pulse pins 0.10.0 without it, and it syncs a document Pulse does not edit                                                |
| P7                                         | `index.html` sets `class="cd-shell-document"`; the shim sets `data-cd-theme` from Orca's `light`/`dark` class before `webview.js` runs and posts `modelerShell.appearance` on `orca.on("theme")`   | The VS Code path of the shell (`renderWebviewHtml`, `connectAppearance`)                                                                                                          | `--orca-*` colours: the webview keeps Miragon tokens by rule                                                                                                    |
| P12                                        | `openInstance`, `openDefinition` write another handle and open a new tab; `pickInstance` takes the first choice                                                                                    | Same tab model as VS Code's "open beside"                                                                                                                                         | in-frame navigation: loses the tab per view                                                                                                                     |
| P14                                        | `getState`/`setState` in the frame's `localStorage`, keyed by the handle                                                                                                                           | Frames keep storage per plugin ([files and assets][a-files])                                                                                                                      | none                                                                                                                                                            |
| S11 to S18, P13, P15 to P21, C2, C8 to C11 | Not in the spike: mapping for a real version in the README                                                                                                                                         | Out of scope                                                                                                                                                                      |                                                                                                                                                                 |

Writes stay off (C8): every connection is built with writes `disabled`. For a real version the
confirmation lives in the components panel, never in the frame that asked: the worker keeps the
write pending and accepts the answer only from a request whose `PanelCaller` is
`{ surface: "panel", contributionId: "engines" }` (`orca-worker.d.ts`). Orca binds that caller to the
frame's session token, so a frame cannot forge it (reviewer A, Orca's `plugin-panel-sessions.ts`).

Orca-native additions (proposal 2), not in the spike: "Ask an agent about this incident" through
`agent.launch` with a fenced, capped prompt, "Inspect in a terminal" with `pulse inspect` through
`terminal.create`, and the status bar item with the incident total.

## 2. Spike scope

Against the sandbox engines:

1. The Engines panel lists shop-dev, shop-test and prod-eu with environment, product, "with
   incident" sums, the definitions with their counts, and the problem rows (login needed,
   unreachable).
2. Credentials for shop-test entered in the panel are stored with `secrets:own`; afterwards
   shop-test lists its definitions.
3. A definition opens in an editor tab with the bpmn-js diagram and its badges (Order fulfillment
   v3).
4. One instance opens in a tab (ORD-10129, opened by its instance id).
5. Light and dark.

Stretch, only once all five are green: the status bar item with the total.

## 3. Architecture

**Where the code lives: `apps/vscode/dev/orca/`.** The root rule says apps never import each
other, so an app at apps/orca could not import `apps/vscode/src` without failing
`pnpm lint:architecture`. `dev/` already holds a second, non-VS Code host of the same app
(`apps/vscode/dev/host/dev-host.ts`); `apps/vscode/.dependency-cruiser.cjs` treats `dev/` as
tooling, ESLint (with the house rules: no comments, complexity 10, 300 lines) and the app's
`tsconfig.json` cover it, coverage counts `src/` only, and `.vscodeignore` ships none of it. The
extension's behaviour cannot change. This home is fair for a spike branch only: a real version
needs an owner decision between an Orca app over extracted packages and a host layer `src/orca`
with its own dependency rules (proposal 3, option A).

```
apps/vscode/dev/orca/
  orca-plugin.json        manifest (copied into the build)
  build.mjs               esbuild: worker, shim, webview, panel → dist-orca (gitignored)
  orca.d.ts               the slice of Orca's API the spike uses, comment-free
  protocol.ts             PluginRequests / PluginPanelEvents, shared by every surface
  worker/                 activate(orca); targets, credentials, connections, cockpit sessions
  panel/engines.tsx       the components panel (Tree, credentials form)
  editor/index.html       loads bridge.js, then webview.js and webview.css
  editor/bridge.ts        acquireVsCodeApi shim, theme, intent queue
```

**Typings.** `orca plugin types` writes into a dot folder that tsc skips and Git ignores, and its
comments fail the house rules. So `dev/orca/orca.d.ts` declares the used slice of `orca`,
`orca/worker` and `orca/jsx-runtime`, mapped through `paths` in `apps/vscode/tsconfig.json`; that
keeps `pnpm lint:architecture:vscode` resolvable without touching its rules (reviewer B tested it).

**Manifest** (`trusted-worker`, `engines.orca` `>=1.4.248` for `frame: "isolated"`,
`pluginApi: 1`, `$schema`, id `pulse-cockpit`, metadata and `icon` from
`apps/vscode/media/icon.png` as in modeler-suite's manifests): `main: "worker.mjs"`;
`panels: [{ id: "engines", title: "Pulse", icon: "activity", entry: "panel/engines.js",
ui: "components" }]`; `customEditors: [{ id: "pulse-view", title: "Pulse", extensions:
[".pulse-view"], entry: "editor/index.html", frame: "isolated" }]`; `settings: [{ key:
"projectFile", type: "string", title: "Project file" }]`; capabilities `secrets:own`,
`settings:own`, `workspace:read`, `workspace:write` (for `workspace.list`, `workspace.open`,
`editor.open`).

**Handle files.** `<workspace>/.pulse/views/<engine>/<view>-<key>.pulse-view`, plus
`.pulse/views/.gitignore` holding `*`. Content: `{"pulse":1,"engine":"shop-dev","view":
"definition","bpmnProcessId":"order-fulfillment"}` or `{…,"view":"instance","instanceId":"…"}`.
No URL, no login: the worker resolves the engine name against its own targets. The workspace is
the local one (`hostId` null) from `workspace.list` whose path holds `projectFile`; without one the
panel names the problem.

**Contract** (`dev/orca/protocol.ts`):

| Request                  | Input                            | Output                                                        |
| ------------------------ | -------------------------------- | ------------------------------------------------------------- |
| `engines.list`           | none                             | `{ projectFile, engines: EngineRow[], problems: string[] }`   |
| `engines.definitions`    | `{ engine }`                     | `{ definitions: DefinitionRow[] }` or `{ problem }`           |
| `engines.setCredentials` | `{ engine, username, password }` | `{ ok }`                                                      |
| `engines.setProjectFile` | `{ path }`                       | `{ ok }` (for `orca plugin dev request`; people use Settings) |
| `views.open`             | `{ engine, view, id }`           | `{ path }`                                                    |
| `cockpit.attach`         | `{ handle }` (the document text) | `{ attached }`                                                |
| `cockpit.intent`         | `{ intent: WebviewIntent }`      | `{ known }`                                                   |

Sessions are keyed by `PanelCaller.id`, which stays the same while the editor stays open
(`orca-worker.d.ts`). The worker posts `cockpit.state { message: StateMessage }` to that editor only
(`orca.panels.post(event, payload, { panel })`). `cockpit.intent` answers before `Panel.handle`
finishes, so a slow engine never runs into the request timeout. `{ known: false }` means the worker
restarted: the shim reloads the frame, because a new `StatePublisher` starts its revisions at 0 and
`HostBridge` drops anything older than what it saw (reviewer A). The shim queues intents (the
webview posts `ready` at once) until `cockpit.attach` answers.

**Worker.** `activate(orca)` does what `ConnectionRegistry.reload()` does
(`apps/vscode/src/host/connections/connection-registry.ts`), without `vscode`: `TargetsParser` on
the project file, `CredentialStore` over an adapter of `orca.secrets` that maps `null` to
`undefined` and refuses when `secrets.protection` is `unavailable`, `EngineLanes.assign`,
`EnvironmentClassifier.classify` with the workspace settings above,
`new ConnectionBuilder(CompositionRoot.create(), new WriteAudit(log)).build(…, { writes:
"disabled", … })`. Each attached editor gets a core `DefinitionPanel` or `InstancePanel` with a
`PanelContext` (`runtime`, `engine`, `diagrams`, `definitions`, `effects`, `publish`, `now`,
`wait`, `bulkRuns`), no `live`, and `PanelEffects` whose navigation calls `views.open` and whose
other methods log. Reused unchanged: `src/contract`, `src/core`, `src/adapters/c7`, `src/model`,
`src/host/composition-root.ts` and the vscode-free files of `src/host/connections`.

**Bundling** (`dev/orca/build.mjs`, script `orca:build` in `apps/vscode/package.json`, output
dist-orca in the app, added to `.gitignore`): unminified and without sourcemaps, as modeler-suite's
Orca builds do for the listing policy.

- worker: esbuild of `worker/main.ts`, `platform: node`, ESM, the `createRequire` banner and
  `.bpmn` loader of `apps/vscode/scripts/dev-server.mjs` → `worker.mjs`;
- frame: `webviewBuildOptions` of `apps/vscode/scripts/webview-build-options.mjs` with
  `sourcemap: false` → `editor/webview.js`, `editor/webview.css`, fonts; `editor/bridge.ts` as a
  small IIFE;
- panel: esbuild of `panel/engines.tsx`, ESM, `tsconfigRaw` with `jsxImportSource: "orca"`,
  `orca` and `orca/*` external → `panel/engines.js`;
- the manifest, the icon and `editor/index.html` copied.

No live refresh: the spike's core panels get no `live`, so they refresh on the Refresh button
inside the view, and the panel on its own button. Closed tabs leave a session without timers in
the worker's memory; a real version needs a lease (section 6).

## 4. Steps and checks

| #   | Step                                                                              | Check                                                                                                                                                                                                                                 |
| --- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `orca.d.ts`, manifest, protocol, build script, empty worker and panel             | `orca plugin validate` on dist-orca passes; `orca plugin dev load <dist-orca> --approve <fingerprint>` loads it                                                                                                                       |
| 2   | Worker: targets, environments, connections, `engines.list`, `engines.definitions` | `orca plugin dev request <dist-orca> engines.list` shows shop-dev LOCAL with "with incident" sums, shop-test TEST with a login problem, prod-eu PROD unreachable                                                                      |
| 3   | Panel: tree, problems, credentials form                                           | `orca plugin shot` shows the tree; after `engines.setCredentials` for shop-test its definitions list                                                                                                                                  |
| 4   | Worker: handle files, `views.open`, `cockpit.attach`, `cockpit.intent`, sessions  | `dev request … views.open` writes the handle and opens a tab; `orca plugin logs` without errors                                                                                                                                       |
| 5   | Frame: `editor/index.html`, shim, webview bundle                                  | `orca plugin check` passes; `orca plugin shot --editor <handle>` shows Order fulfillment with badges (fallback: `orca plugin open --editor`, then `shot --window`)                                                                    |
| 6   | Instance view                                                                     | `shot --editor` on the ORD-10129 handle shows the incident and its root cause                                                                                                                                                         |
| 7   | Light and dark                                                                    | shots with `--theme light` and `--theme dark`; `--json` says `themeApplied`                                                                                                                                                           |
| 8   | Repo gates                                                                        | `pnpm --filter pulse-cockpit run typecheck`, `lint`, `test`; `pnpm lint:architecture:vscode`, `pnpm lint:deadcode`, `pnpm lint:deadcode:exports`, `pnpm lint:ratchets`, `pnpm format:check`, `node --test scripts/docs-refs.test.mjs` |
| 9   | Stretch: status bar item                                                          | `orca plugin shot --status-bar`                                                                                                                                                                                                       |

Each screenshot is read back and judged before the next step. `--theme` and `--act` work only
while Orca's window is hidden or minimized; the window shows this session, so the theme shots
are taken last.

## 5. Screenshots (`docs/spikes/orca-plugin/screenshots/`)

1. `engines-panel.png`: the tree with the three engines, sums and problem rows.
2. `engines-panel-signed-in.png`: shop-test expanded after login.
3. `definition-light.png`, `definition-dark.png`: Order fulfillment with badges.
4. `instance.png`: ORD-10129 with its incident.
5. `window.png`: Orca with the panel and a cockpit tab.

## 6. Open questions and how the spike answers them

| Question                                                                                                                                                                                                | Answered by                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Does `editor.open` open a handle under `.pulse/views/` in the custom editor? (yes for dot folders in prior art)                                                                                         | step 4                                           |
| Does the webview bundle render in the isolated editor frame with real state?                                                                                                                            | step 5, `orca plugin logs`                       |
| Do targeted posts reach a custom editor by `PanelCaller.id`?                                                                                                                                            | step 5                                           |
| Does `shot --editor` wait for the state that arrives after `cockpit.attach`?                                                                                                                            | step 5                                           |
| Does a click still count as a gesture after a worker round trip (copy handover, open web UI)?                                                                                                           | not in the spike; README                         |
| Secrets: every surface of the plugin may call `secrets.get`, so the frame that renders engine text could read the logins; frames have no network, and `openExternal` needs a click and a consent prompt | stated in the README as the real boundary        |
| Closed tabs: Orca sends the worker no close event                                                                                                                                                       | README: a lease renewed by visible frames        |
| Large models: a state with BPMN XML above 256 KiB cannot be posted                                                                                                                                      | README: the XML through a request answer (1 MiB) |

## 7. Review

Reviewer A checked the plan against Orca 1.4.252 (no blockers, 8 major, 11 minor), reviewer B
against the repository (3 blockers, 7 major, 6 minor). Changed:

- Typings: a comment-free `dev/orca/orca.d.ts` mapped through `paths` is the plan, not the fallback
  (B1, B2, A-M6). Panel JSX through `tsconfigRaw` with `jsxImportSource: "orca"`, since a pragma is
  a comment and the app's tsconfig says Preact (B5, A-m1).
- Incident words: "with incident" as VS Code and the engine overview say, the engine sum kept with
  those words (B6).
- Environments from the project's `.vscode/settings.json` (B7, A-m10).
- Cut from the spike: live refresh and `cockpit.attention` (B8), copy and web UI (B9, A-m3), back
  links (B13), the project-file form (B scope), separate session ids (B scope), the status bar
  moved to a stretch step.
- Worker restart: the shim reloads the frame on `{ known: false }` (A-M2); intents queued until
  attach, `cockpit.intent` answers before the core finishes (B14).
- `editor.open` with a workspace-relative path after `workspace.open`, local workspaces only (A-M4).
- Secrets adapter maps `null` to `undefined` and checks `secrets.protection` (A-M5, B signatures).
- The "no secret reaches a frame" claim reworded to what holds (A-M1, B10).
- `PanelCaller` forgery answered: Orca binds it to the frame's session (A, open questions).
- Screenshot conditions stated (A-M8); `index.html` class and theme message (A-m2, B14); manifest
  metadata, icon, no `storage:own` (A-m6, A-m7); unminified without sourcemaps (A-m8); dist-orca
  gitignored (A-m9, B11); the worker wiring cites `ConnectionRegistry.reload` and lists `bulkRuns`
  (B12); the instance handle takes an id (B15); `lint:ratchets` and `format:check` in the gates (B4).

Rejected:

- Moving the spike docs to `apps/vscode/docs/spikes/` (B3, A-M7): the task names
  `docs/spikes/orca-plugin/`. They stay there; `docs/.vitepress/config.ts` excludes `spikes/**` so
  the site never publishes them, each page gets a `DOCS_BUDGETS` entry, and paths that are never
  committed (dist-orca) stay out of backticks.
- Adding `^orca(/|$)` to dependency-cruiser's `pathNot` (A-M6): a gate change, where the `paths`
  mapping keeps the gate as it is.
- Dropping the engine-row sum (B6): the scope asks for incident counts per engine, and the engine
  overview already sums the same field with the same words.
- knip without a ratchet exception (B4): knip only learns of `dev/orca` through new `entry` globs,
  which `scripts/check-ratchets.mjs` holds shrink-only. The spike adds them in a commit with a
  `Ratchet-Exception:` trailer; whether that may land is the owner's call, and nothing is pushed.

[a]: https://github.com/stablyai/orca/blob/main/docs/reference/plugin-authoring.md
[a-data]: https://github.com/stablyai/orca/blob/main/docs/reference/plugin-authoring.md#panels-workers-and-data
[a-files]: https://github.com/stablyai/orca/blob/main/docs/reference/plugin-authoring.md#files-and-assets
[m]: https://github.com/stablyai/orca/blob/main/docs/reference/plugin-manifest.md
[h]: https://github.com/stablyai/orca/blob/main/docs/reference/plugin-host-api.md
[iso]: https://github.com/stablyai/orca/blob/main/docs/reference/plugin-isolated-frames.md
