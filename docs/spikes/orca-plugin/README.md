# Spike: Pulse as an Orca plugin

**Result:** Pulse for VS Code runs as an Orca plugin with the feature set of the extension,
writes included. The plugin shows the Engines tree, the engine overview, definitions, instances,
migrations, a local model against its deployment and boards, each with real data from the
sandbox engines, with live refresh, back links, incident details and the engine's web app. Writes
follow the extension's policy; the confirmation waits in the Pulse panel.

**Since then, ready for a first release** (section 4): Pulse for Orca is an app of its own,
`apps/orca`, over two packages it shares with the extension, the runtime view
(`packages/core/runtime-view`) and the C7 adapter (`packages/connectors/engine/engine-adapter`).
It ships with every Pulse release to the mirror `Miragon/pulse-orca`, and it is tested on Orca's
own kit and in a real Orca. What stays open are gaps only Orca can close and two owner steps
(section 5).

How it came about: [inventory](inventory.md), [prior art](prior-art.md), proposals
[1](proposal-1.md), [2](proposal-2.md), [3](proposal-3.md), the reviewed [plan](plan.md). The
first, read-only round is in the Git history of this file.

## 1. What it shows

Against the sandbox engines (`pnpm --filter pulse-cockpit run sandbox:up`), Orca 1.4.252, dark:

| Screenshot                                                             | Shows                                                                                                                             |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| [engine-overview.png](screenshots/engine-overview.png)                 | shop-dev's processes in a tab, writable, live; the panel with the active engine, go to instance and the tree; the status bar item |
| [model-compare.png](screenshots/model-compare.png)                     | order-fulfillment.bpmn from the workspace against the deployed v3, the tree selecting the process of the focused tab              |
| [board.png](screenshots/board.png)                                     | The sandbox board `shop-operations.board.json` in Orca's custom editor, read from both engines, prod-eu unreachable               |
| [panel-confirmation.png](screenshots/panel-confirmation.png)           | A token move on shop-dev waiting for its confirmation in the Pulse panel, with the facts the extension's dialog shows             |
| [status-bar-confirmation.png](screenshots/status-bar-confirmation.png) | The status bar while a write waits                                                                                                |
| [definition-dark.png](screenshots/definition-dark.png)                 | First round: Order fulfillment v3 with its badges                                                                                 |
| [instance-dark.png](screenshots/instance-dark.png)                     | First round: ORD-10129 with the root cause `CardExpiredException`                                                                 |

![The engine overview and the Pulse panel in Orca](screenshots/engine-overview.png)

Checked on the way: `orca plugin validate` and `orca plugin check` pass; `orca plugin dev request`
drove a retry on shop-dev (no confirmation, local), a retry on shop-test (TEST, confirmed in the
panel) and a token move on shop-dev (asked, then cancelled), each with its line in the write audit
of `orca plugin logs`; the worker bundle carries no `vscode`; the extension's typecheck, ESLint,
1,447 tests with their coverage floors, dependency-cruiser, knip and prettier stay green. Not
captured: the light theme and an acted panel (`--theme` and `--act` need Orca's window hidden,
which this session may not do; section 6).

## 2. Feature set against VS Code

| VS Code                                                 | Orca                                                                                                                        |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Engines tree, reveal of the focused panel               | Components panel with Orca's `Tree`; the focused tab selects its engine or process                                          |
| Live tree and live panels (`pulse.liveUpdates`)         | Same loops; four settings `liveUpdates.<environment>`; visibility from the panel and from each tab                          |
| Engine overview, definition, instance, migration panels | Custom editor on `.pulse-view` handle files in `.pulse/views/` next to the project file                                     |
| Show runtime data for this model                        | "Local models" in the panel: each `.bpmn` of the project opens the definition against that file                             |
| Boards tree, open board, new board                      | "Boards" in the panel; `.board.json` opens in Orca's custom editor, whose Source toggle edits it                            |
| Go to process instance (input box, quick pick)          | Search field in the panel, a list when several instances share the business key                                             |
| Switch engine (quick pick), status bar                  | "Active engine" select and a command; the status bar shows the active engine with its incidents                             |
| Set credentials                                         | Login form in the panel, asked for by a tab or a board; kept in `secrets:own` on the OS key store                           |
| Configure engines                                       | Opens the project file, creating it from the extension's template                                                           |
| `pulse.writes`, write dialog, bulk dialog               | Setting "Writes"; the extension's `ConfirmationPolicy` decides; the panel asks for host, count and reason as the dialogs do |
| Pick one of several called instances                    | A list in the panel                                                                                                         |
| Incident details with links into code                   | A `.log` file opened in Orca's editor, without links                                                                        |
| Open model, open code                                   | Opens the file in Orca, without the element or line                                                                         |
| Open in web app, copy, copy handover                    | Answered within the click: the frame opens the URL (`shell.openExternal`) or copies (`execCommand`)                         |
| Back to the panel that opened this one                  | Back link to the opening tab, reopened through its handle                                                                   |
| Nudge on save, debug end, task end                      | Nudge on saving a `.bpmn` (`editor.save.before`)                                                                            |
| `.pulse-cli.json` in every workspace folder             | Setting "Project file", else the one at the root of the focused workspace                                                   |
| `pulse.environments` in user and workspace settings     | Setting "Environments" (JSON) and `.vscode/settings.json` next to the project file                                          |

How a write is confirmed: the core asks `confirmWrite`; the worker keeps the write pending and
posts the question to the Pulse panel, raises a desktop notification and turns the status bar
item to "Confirm in the Pulse panel". Only a request from the panel (`PanelCaller`
`{ surface: "panel", contributionId: "engines" }`, set by Orca) settles it; a tab's request is
refused and logged. Unanswered questions lapse after ten minutes. `orca plugin dev request`
calls as the plugin's first panel, so a developer can answer from the CLI; installed plugins have
no such path.

## 3. What Orca made easy

- The split fits. Pulse already keeps the engine in a Node host and the UI in a sandboxed
  webview; Orca's `trusted-worker` plus isolated frames is the same shape. Node 24 in the worker
  has `JSON.rawJSON`, so `LosslessJson` and `EngineHttp` run as they are.
- The webview bundle runs unchanged, in isolated frames, without network, from the state the
  worker posts.
- The host layer of the extension carries over in part: `ConfirmationPolicy`, `WritePolicy`,
  `LivePolicy`, `WriteAudit`, `CredentialStore`, `TargetsParser`, `EngineLanes`,
  `ConnectionBuilder`, `PanelOrigins` and `PanelTitle` run in the worker untouched.
- Orca's own surfaces cover what the extension needs from VS Code: settings with pickers, a
  status bar item, commands, a save hook, workspace events and the components catalogue for
  forms, lists and trees.

## 4. From spike to release

| Was open after the spike | Done                                                                                                                                                                                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Placement                | `apps/orca` as an app of its own; what both hosts run moved out of `apps/vscode` unchanged into `packages/core/runtime-view` and `packages/connectors/engine/engine-adapter` (the family's new `-adapter` role), each with closed-world dependency rules and planted violations |
| Tests in Orca            | 145 unit tests of the worker on a fake Orca with coverage floors; 55 kit tests of the panel and the worker on `orca/testing` of the pinned release; `test:smoke` loads the build into the running Orca and reads the sandbox engines                                            |
| CI                       | The job "Orca plugin (validate, check, kit tests)" runs the CLI of the pinned Orca .deb on plain Node, checks the vendored typings against it, validates and checks the plugin folder and runs the kit tests                                                                    |
| Packaging and release    | `publish-orca-plugin.yml` in the release-please train: build and check, push to the mirror, tag and release it, the catalog entry by `orca plugin release-entry`, plugin folder and entry on the Pulse release                                                                  |
| Wording                  | Each host names its own writes setting in the read-only notes                                                                                                                                                                                                                   |
| Docs                     | `docs/orca/` on the docs site; `apps/orca/CLAUDE.md`                                                                                                                                                                                                                            |

## 5. Still open

1. **Owner steps before the first release:** create `Miragon/pulse-orca` (empty, public) and
   install the release-please app on it with Contents write; decide the plugin id for a catalog
   (today `pulse-cockpit`, the publisher comes from the repository owner) and open the catalog
   pull request with the entry the release attaches.
2. **Gaps against VS Code that Orca can close** (candidates for the Orca team):
   - no editor tab without a file, so views need handle files and `workspace:write`;
   - no tab title from the frame, so a tab shows its handle's file name;
   - no way to open or focus a panel from code, so a waiting write can only point at the panel;
   - no close event for tabs and panels; the plugin uses a request Orca aborts on close;
   - no active editor for the worker, so "Show runtime data for this model" became a list;
   - `editor.open` takes no line or selection, so incident details, models and code open at the
     top;
   - tree items have no badge, colour or row action;
   - every surface of a plugin may read its secrets;
   - `orca plugin check` reads scenario files only from the folder it checks, so scenarios would
     ship in the plugin; the kit tests cover them instead.
3. **Orca only, after parity:** an agent hand-off for an incident (`agent.launch` with typed ids
   and fenced engine text, [proposal 2](proposal-2.md)) and `pulse inspect` in a terminal.

## 6. Run it locally

```sh
pnpm install && pnpm build                      # engine-core is bundled from its build
pnpm --filter pulse-cockpit run sandbox:up      # shop-dev, shop-test (demo/demo), about two minutes
pnpm --filter @miragon/pulse-orca run build     # builds the plugin into apps/orca/dist
O=/Applications/Orca.app/Contents/Resources/bin/orca
$O plugin dev load apps/orca/dist        # prints the approval command with its fingerprint
$O plugin dev load apps/orca/dist --approve <fingerprint>
$O plugin dev request apps/orca/dist engines.setProjectFile \
  --data "{\"path\":\"$PWD/apps/vscode/sandbox/.pulse-cli.json\"}"
$O plugin open local.pulse-cockpit              # the panel; Enter on an engine or process opens it
```

Without the setting, the plugin reads `.pulse-cli.json` at the root of the focused workspace.
After a rebuild, `$O plugin dev reload apps/orca/dist` remounts open tabs and
`$O plugin restart local.pulse-cockpit` restarts the worker; tabs and the panel reconnect.

The shots that need Orca's window hidden (light theme, an acted panel), with the window
minimized:

```sh
$O plugin shot local.pulse-cockpit --theme light --width 420
$O plugin shot local.pulse-cockpit --width 420 --act \
  '[{"selectItem":{"label":"Engines"},"key":"engine|shop-test"},{"type":{"label":"Username"},"text":"demo"}]'
$O plugin shot local.pulse-cockpit --window --theme light   # with a Pulse tab open
```

`$O plugin dev unload apps/orca/dist` removes it again. `pnpm --filter @miragon/pulse-orca run
test:smoke` does the load, the project file and a first view in one go.
