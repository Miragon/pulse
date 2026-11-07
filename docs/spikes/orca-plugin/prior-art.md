# Orca plugin prior art for the Pulse port

What published Orca plugins teach a port of Pulse for VS Code (Engines tree, definition and
instance views with a bpmn-js diagram, guarded writes, secret logins, named targets in
`.pulse-cli.json`). All plugin code was read as data from the catalogs' mirror at each release's
commit; nothing was installed, built or run. Read on 2026-11-07 against Orca 1.4.252.

## 1. Sources and scope

- Catalogs: [stablyai/orca-plugins][cat-off] (official) and [stablyai/orca-community-plugins][cat-com]
  (community), their orca-catalog.json. Plugin bytes from [stablyai/orca-community-mirror][mirror]
  at each release's tag, pinned below to the tag's commit. graphiql's sources are not in the
  mirror; they come from its own repository at the same tag.
- Orca's reference: [plugin-manifest.md][ref-manifest], [plugin-host-api.md][ref-host],
  [plugin-authoring.md][ref-authoring], [plugin-declarative-ui.md][ref-dui] and, for `newFiles`,
  Orca's renderer source (section 2). The local typings in the app bundle confirmed the worker's
  request context.

Catalog counts by execution profile of each plugin's newest release:

| Catalog   | Plugins | data | declarative | sandboxed-ui | trusted-worker |
| --------- | ------- | ---- | ----------- | ------------ | -------------- |
| Official  | 43      | 36   | 1           | 6            | 0              |
| Community | 107     | 35   | 5           | 18           | 49             |

No official plugin is a trusted worker; every plugin that talks to an outside service is a
community one. 19 trusted-worker plugins were read in depth (table in section 3): the ten named
in the brief plus nine picked from the other 39 for panels, custom editors, `newFiles`, status
bar items or `agent:launch` next to an external service.

## 2. What `newFiles` is

The manifest reference ([NewFileContribution][ref-newfile]): "A kind of untitled file the user
can create from the tab bar + menu or the command palette, in the active workspace." Fields:
`id`, `title` (the menu item), `extension` (the file opens "in whatever editor takes that
suffix, such as a custom editor from this plugin"), optional `template` (UTF-8, at most 256 KB,
copied into the new file) and `icon`. At most 16; since 1.4.245; no execution profile of its own
beyond what the matching custom editor needs.

What Orca does with it, read in the renderer source:

- It writes a real file. [untitled-file-creation.ts][orca-untitled] "creates an untitled file at
  the active workspace's root on its own host (local, SSH or a runtime) and opens it"; the name
  is `untitled<extension>`, then `untitled-2<extension>` and so on up to 100 tries
  ([create-untitled-markdown.ts][orca-untitled-md], `untitledFileNameWith`). The content is the
  template, read through `readNewFileTemplate`, and only while the plugin is enabled and approved
  ([plugin-new-file-template.ts][orca-template]).
- An empty file is deleted again when its tab closes untouched; a file seeded from a template is
  not (`deleteUntouchedOnClose` is `false` whenever `newFile.content` is non-empty). moseoh's
  README says the same from the outside: "creates an empty `untitled.githistory` ... at the
  project root. It shows in the file tree while the tab is open. Nothing is written to it, so
  Orca deletes it when the tab closes" ([git-history README][gh-readme]).
- A paired web client without the template reader gets no menu entries
  ([plugin-new-files.ts][orca-newfiles]), and with no focused workspace nothing is created.

So `newFiles` is only a launcher: "+ → My view" creates a handle file that the plugin's custom
editor then opens in a full editor tab. The editor still gets only the document, never its path
([CustomEditorContribution][ref-editor]). How the plugins use it:

- moseoh.git-history: no template; the editor ignores the file and follows the focused workspace
  ([editor/main.ts][gh-main]: "the untitled file ... is only a handle").
- faisalmuhammad.graphiql: template [empty.graphiql][gq-tpl] is the session document itself
  (environments, operations), so the file is real data the editor edits and saves.
- kyino-pan.agent-activity: template [overview.orca-activity][ka-tpl] is a view descriptor,
  `{"view":"agent-activity","windowHours":24}`.
- satangbudsai.git-control: `newFiles` for the + menu, but its command and status bar item write
  their own marker file instead (section 4.2).

## 3. Plugins studied

Links point at the mirror commit of the release named. "Reads" lists which of our questions the
plugin answers.

| Plugin (version)                   | Contributions                                                                             | Capabilities                                                                                            | Reads: how it solves our questions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Files                                                                                                                                                                             |
| ---------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| faisalmuhammad.graphiql 0.1.6      | panels (html), customEditors `.graphiql`, newFiles (template), hooks `editor.save.before` | workspace:read, workspace:write, storage:own, secrets:own                                               | Closest to Pulse. Named environments live in the session file; the worker holds credentials and does every HTTP call, the editor asks via `plugin.request`. Connect is an explicit "approval" with a 30 min idle expiry; remote http needs a second confirmation; a Production environment makes the editor confirm each mutation in an HTML `<dialog>` and the worker refuses one without `confirmedMutation`. Redirects refused. Secrets bound to endpoint, session and environment; no plaintext fallback. The `editor.save.before` hook teaches the worker the path of a session file, which the editor never sees. Explorer panel lists sessions, refreshed by a debounced `panels.post`. esbuild worker, Vite editor. | [protocol][gq-proto], [worker][gq-worker], [credentials][gq-cred], [session files][gq-files], [editor App][gq-app], [Modal][gq-modal], [explorer][gq-activity], [build][gq-build] |
| michelvelzr.ork-dbclient 0.1.0     | panels (html)                                                                             | storage:own, secrets:own                                                                                | Saved connections in storage, password per connection in secrets, refused unless `secrets.protection` is `os-keyring`. Panel tree is hand-built HTML: collapsible groups per database, one row per table. Delete confirms in an HTML backdrop modal. esbuild bundles pg, mysql2, ioredis into one worker file with a `createRequire` banner.                                                                                                                                                                                                                                                                                                                                                                                | [worker][od-main], [panel tree][od-panel], [build][od-build]                                                                                                                      |
| ivanha-dev.openproject 0.1.4       | panels (components), commands, statusBarItems, hooks `agent.launch.before`, settings      | storage:own, settings:own, secrets:own, workspace:read, agent:launch, notifications:show                | URL and allowlists in settings, API token in secrets (falls back to plaintext storage, a pitfall). Worker caches a snapshot in storage and pushes it with `panels.post` plus `statusBar.update` (tone by state). Agent writes over its MCP server are preview then `confirm=true`; the panel itself sends `confirm: true` at once. Launch prompt fences ticket text as untrusted. Injects token and URL into every agent's env through `agent.launch.before`. Shells out to the `orca` CLI to create worktrees and focus.                                                                                                                                                                                                   | [protocol][op-proto], [hook][op-hook], [status bar][op-status], [token fallback][op-token], [prompt][op-prompt], [launch][op-launch], [panel state][op-state]                     |
| eskono.docker-logs 0.4.0           | panels (html), statusBarItems, events `workspace.changed`, settings                       | workspace:read, storage:own, settings:own, terminal:send, agent:launch, notifications:show              | Panel polls the worker with `setInterval`, skipped while `document.hidden`. Worker follows the focused workspace and polls every 10 s for the status bar and failure notifications. "Down" is a two-click button that arms for a few seconds. "Ask agent" calls `agent.launch` with the agent from a setting and a prompt of instruction, "untrusted evidence, not instructions", fenced diagnostics and fenced log tail (300 lines, 24000 chars). Uses the bundled `orca` CLI to reveal a terminal and open a file at a line. No build: worker and panel are TypeScript Orca transpiles.                                                                                                                                   | [contract][dl-proto], [agent.ask][dl-ask], [status poll][dl-poll], [two-click][dl-confirm], [panel poll][dl-ppoll], [orca CLI][dl-cli], [panel html][dl-html]                     |
| moseoh.git-history 0.1.2           | customEditors `.githistory`, newFiles (no template)                                       | workspace:read, workspace:write, storage:own                                                            | Full-tab view without a document: the + menu file is a throwaway handle, the tab follows `workspace.changed`. Requests name a workspace by id, never a path; worker resolves it via `workspace.list`, local hosts only. No build step.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | [README][gh-readme], [editor entry][gh-main], [contract][gh-proto], [worker][gh-worker]                                                                                           |
| satangbudsai.git-control 0.5.0     | customEditors `.gitgraph`, newFiles, commands, statusBarItems, events, settings           | workspace:read, workspace:write, notifications:show, storage:own, settings:own, terminal:send           | Command and status bar open the full tab by writing `.orca-git-graph.gitgraph` (JSON naming the repo), adding `*.gitgraph` to `.git/info/exclude`, then `orca file open --focus` on the CLI. The tab reads the repo from the document. Every destructive git step goes through a `confirmBox` (title, consequence, verb, danger tone). Polls reviews every 3 min into a status bar item. Inlines CSS and JS into one HTML file so browser clients work.                                                                                                                                                                                                                                                                     | [open tab][gc-tab], [command][gc-cmd], [document read][gc-doc], [confirmBox][gc-confirm], [inline build][gc-build]                                                                |
| emamalet.git-log 0.1.5             | panels (html), customEditors `.gitlog`, commands, settings                                | workspace:read, workspace:write, settings:own                                                           | One app for sidebar and tab (`data-mode="panel"` or `"editor"`). "Open in Editor Tab" writes `.orca-git-log.gitlog` with `{root, workspaceId}`, excludes it in git and calls host `editor.open`. Live refresh: worker watches the repo and posts `repo.changed`. Rewrites get a worker precheck (`action.check`) before the dialog.                                                                                                                                                                                                                                                                                                                                                                                         | [openTab][gl-tab], [watch][gl-watch], [editor html][gl-editor], [panel html][gl-panel], [precheck][gl-check]                                                                      |
| plozmun.redmine-tasks 0.1.7        | panels (components), commands, settings                                                   | settings:own, secrets:own, workspace:read, terminal:send                                                | URL in settings, API key entered in the panel and kept in secrets. "Send to agent" types a prompt without Enter into a chosen terminal and puts the task context in a 0600 temp file the prompt points to; "new workspace" runs `orca worktree create` with the agent. Prompt templates and context caps (12000 chars) are settings. Finds the focused workspace by display name and branch.                                                                                                                                                                                                                                                                                                                                | [contract][rm-proto], [sendToAgent][rm-send], [context file][rm-files], [prompt rules][rm-launch]                                                                                 |
| cmdaltctr.release-status 0.1.2     | panels (components)                                                                       | storage:own, workspace:read, notifications:show, agent:read, terminal:send                              | Worker starts on the panel's first request. Panel polls, listens to `status.changed`, `agent.status.changed` and `workspace.changed`. "Re-run" acts only on a run id the worker itself listed. "Ask agent" types into a terminal only after `agents.list` still shows it as an agent.                                                                                                                                                                                                                                                                                                                                                                                                                                       | [handlers][rs-handlers], [panel setup][rs-panel], [contract][rs-proto]                                                                                                            |
| joneszeng.orchestra 0.2.2          | panels (html)                                                                             | none                                                                                                    | Remote data from servers saved in Orca. Panel gets ids and names only, never endpoints or tokens; the worker accepts only `{kind:"local"}` or a saved id. Every write: preview with exact target, confirm, durable request id, never an automatic retry. One generic `orchestra.call` handler. 2 MB single-file panel built from Orca's own sources; reads Orca's private server registry.                                                                                                                                                                                                                                                                                                                                  | [worker][oc-worker], [security][oc-sec], [build][oc-build]                                                                                                                        |
| ky1ezer0.git-graph 1.0.1           | panels (html), customEditors `.git-graph-diff`                                            | workspace:read, storage:own                                                                             | Diff tabs as cached files under `.orca/git-graph-diffs/` (real directories only, excluded in git), opened with `orca plugin open <key> --editor <file>` because the host API has no historical diff. Worker refuses an unconfirmed action.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | [diff cache][gg-cache], [open][gg-open], [guard][gg-guard]                                                                                                                        |
| tienne.git-logs 0.1.1              | panels (html), customEditors `.orcadiff`, events                                          | workspace:read, workspace:write                                                                         | Same idea: writes `.orca/git-logs/<uuid>.orcadiff` and calls host `editor.open`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | [worker][tl-worker]                                                                                                                                                               |
| kyino-pan.agent-activity 0.1.1     | panels, customEditors `.orca-activity`, newFiles (template), commands, events, settings   | agent:read, storage:own, settings:own                                                                   | One `panel.html` serves the sidebar and the tab; the template is a view descriptor.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | [manifest][ka-manifest], [template][ka-tpl]                                                                                                                                       |
| roflochinsky.beads 0.2.0           | panels (html), statusBarItems, settings                                                   | workspace:read/write, settings:own, storage:own, agent:read, agent:launch, terminal:send, terminal:read | Agent handoff as a stored preview with a fingerprint; send re-builds it and refuses when the fingerprint changed, persists "unknown" before any effect and never resends on its own.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | [types][rb-types], [send][rb-send]                                                                                                                                                |
| bautistapessagno.now-playing 0.3.2 | panels, commands, keybindings, settings                                                   | secrets:own, settings:own, storage:own                                                                  | OAuth (PKCE) for a web API: worker listens on 127.0.0.1 for the redirect, panel opens the login URL with `orca.shell.openExternal`, tokens in secrets, memory only when secrets fail.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | [auth][np-auth]                                                                                                                                                                   |
| aamonnaig4.now-playing 1.3.1       | panels (html, `.ts` entry), settings                                                      | storage:own, settings:own, secrets:own                                                                  | Same shape; client id as a setting, panel entry a `.ts` file.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | [manifest][an-manifest]                                                                                                                                                           |
| iml885203.orbit-status 0.1.1       | panels (components)                                                                       | workspace:read                                                                                          | Read-only status of an external tool in a components panel.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | [manifest][io-manifest]                                                                                                                                                           |
| awallsr.beads 0.2.1                | panels (components), commands, settings                                                   | notifications:show, workspace:read, storage:own, settings:own                                           | Agent name as a setting for "Start" in its own worktree.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | [manifest][ab-manifest]                                                                                                                                                           |
| rgarciade.containers 0.1.1         | panels (html), commands                                                                   | notifications:show, workspace:read, storage:own                                                         | Docker engine control from an html panel; refresh as a palette command.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | [manifest][rc-manifest]                                                                                                                                                           |

## 4. Per question

### 4.1 Navigation

- Panels live only in the right sidebar. Two ways to draw a tree:
  - Components panel (`ui: "components"`): Orca's own `Tree` (items as data, `hasChildren` for
    lazy children, `onToggle`, `onAction`, up to 2000 items, 16 levels), `Table` (virtualised,
    5000 rows, `onLoadMore`) and `List` ([catalog][ref-dui-catalog]). openproject builds its
    ticket hierarchy from `List` plus collapse atoms ([panel state][op-state]); none of the
    plugins read uses `Tree` yet.
  - HTML panel: the plugin draws its own. ork-dbclient renders collapsible groups with buttons per
    row ([panel tree][od-panel]); graphiql renders session cards ([explorer][gq-activity]).
- A components panel has no DOM (a hidden module), so bpmn-js cannot run there; a diagram needs
  an HTML frame (panel or custom editor). Guess: a Pulse Engines tree fits a components `Tree`,
  the definition and instance views need an HTML custom editor.
- Following focus: `workspace.changed` carries `displayName`, `branch` and terminals, no
  workspace id. git-history and redmine match it against `workspace.list` by name and branch
  ([git-history worker][gh-worker], [redmine contract][rm-proto]).

### 4.2 Full-tab view without a file

Every plugin with a full tab uses a custom editor on its own suffix plus a handle file. Three ways
to get that file:

| Way                                               | Who                                                                                                                        | Where the file lands                                     | Trade-off                                                                                |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `newFiles` from the + menu                        | git-history, graphiql, agent-activity, git-control                                                                         | `untitled<ext>` at the workspace root                    | User-started only; empty files vanish on close, templated ones stay and show in the tree |
| Worker writes a dot file, then host `editor.open` | git-log ([openTab][gl-tab]), tienne.git-logs                                                                               | `.orca-git-log.gitlog`, `.orca/git-logs/<uuid>.orcadiff` | Needs `workspace:write`; the plugin adds the pattern to `.git/info/exclude`              |
| Worker writes, then the `orca` CLI opens it       | git-control (`orca file open --focus`, [open tab][gc-tab]), git-graph (`orca plugin open <key> --editor`, [open][gg-open]) | `.orca-git-graph.gitgraph`, `.orca/git-graph-diffs/`     | Brings the tab to the front; depends on the CLI's location and output                    |

The file's content says what the tab shows: `{repo}` (git-control), `{root, workspaceId}`
(git-log), a view descriptor (agent-activity). The editor reads it with `orca.document.get()`
([git-control][gc-doc]). Guess for Pulse: one suffix such as `.pulse-view` whose JSON names
target, route and id, written under a git-excluded `.orca/pulse/` folder per open view and
opened by the worker; `newFiles` as "+ → Pulse cockpit".

The editor instance is addressable: `context.panel` in a worker handler is
`{ id, surface: "panel" | "editor", contributionId }` and stays the same while the tab is open
(local typings, orca-worker.d.ts), so `panels.post(event, payload, { panel: id })` reaches one
tab. graphiql keys its connection approvals and running requests by that id
([worker][gq-worker]).

### 4.3 Settings and credentials

- Non-secret configuration in `contributes.settings` (URL, page size, agent, allowlists), read
  with `settings.get`; Orca draws the form. Redmine and openproject put the base URL there.
- Secrets with `secrets:own`, read and written only in the worker. Good practice seen:
  - Ask `secrets.protection` first and refuse to store when it is not `os-keyring`
    (graphiql [credentials][gq-cred], ork-dbclient [worker][od-main]); offer explicit
    temporary in-memory credentials instead (graphiql) or keep tokens in memory only
    (now-playing [auth][np-auth]).
  - Bind a stored secret to what it is for: graphiql stores `{endpoint, sessionId,
environmentId, headers}` under a random id and refuses it for any other endpoint.
  - The frame never receives a secret; it sends one in once and gets back a reference
    (graphiql `secretId`, orchestra "ids and names only" [security][oc-sec]).
- Several named connections: ork-dbclient keeps the list in storage and one secret per id;
  graphiql keeps environments in the workspace file and secrets by reference. Pulse's
  `.pulse-cli.json` maps onto graphiql's model: a workspace file with names and URLs, logins in
  secrets. The worker can read it with Node, as graphiql reads `.graphiql` files from
  `workspace.list` paths ([session files][gq-files]).
- OAuth: PKCE with a loopback server in the worker and `shell.openExternal` from a click in the
  frame (now-playing [auth][np-auth]).

### 4.4 Live refresh

- Panel polling: `setInterval` + `plugin.request`, skipped while `document.hidden`
  (docker-logs [panel poll][dl-ppoll]); release-status polls and also reloads on
  `workspace.changed` and `agent.status.changed` ([panel setup][rs-panel]).
- Worker push: the worker posts after its own change or a watcher event, debounced (graphiql
  250 ms in [worker][gq-worker], git-log's repo watcher [watch][gl-watch], openproject's
  snapshot [status bar][op-status]). Posts are fire and forget, 256 KiB each, 200 per 10 s.
- Status bar: a plugin with `main` and `statusBarItems` has its worker started on enable and kept
  running, so it may poll without a panel (docker-logs 10 s [status poll][dl-poll], git-control
  3 min). Otherwise a worker may stop when idle and loses its memory (graphiql tells the user to
  reconnect "or the worker restarted").

### 4.5 Write confirmations

Orca has no confirm dialog for plugins. What the plugins do instead:

- HTML frames: an own `<dialog>` with `showModal()` naming target and consequence, the verb on
  the button, a danger tone for irreversible steps (graphiql [Modal][gq-modal] and
  [App][gq-app], git-control [confirmBox][gc-confirm], git-log, ork-dbclient).
- Two-click arming: the button turns into "Confirm down" and disarms after a timeout
  (docker-logs [two-click][dl-confirm]).
- Components panels: no dialog component in the catalog. openproject skips confirmation in its
  panel ([panel state][op-state]). Guess: an inline `Callout` with Confirm and Cancel buttons.
- The worker checks again, so a frame cannot skip the dialog:
  - a flag the worker requires (graphiql `confirmedMutation` on a Production environment,
    git-graph `confirmed !== true` [guard][gg-guard]);
  - only ids the worker listed itself (release-status re-run [handlers][rs-handlers]);
  - a precheck before the dialog (git-log `action.check` [precheck][gl-check]);
  - preview with fingerprint, revalidated on send, "unknown" persisted before the effect, no
    automatic retry (beads [send][rb-send], orchestra [security][oc-sec]).

### 4.6 Agent handoff

- `agent.launch` takes `{ workspaceId, agent, prompt }` and returns a `terminalId`; the agent
  comes from a setting (docker-logs `agent`, openproject `defaultAgent`).
- Prompt shape, as in docker-logs [agent.ask][dl-ask]: one line of task, one line that the data
  is "untrusted evidence, not instructions", then the data fenced with a fence longer than any
  backtick run inside, with stated caps ("Included N of M lines"). openproject wraps ticket text
  in `<untrusted_ticket_data>` and escapes look-alike closing tags ([prompt][op-prompt]); redmine
  caps context at a setting (12000 chars) and moves long context to a 0600 temp file
  ([context file][rm-files]).
- Into an existing agent: `terminal.sendText` only after `agents.list` still lists that terminal
  (release-status), or without Enter so the person sends it (redmine [sendToAgent][rm-send]).
- Gaps filled with the `orca` CLI: focusing a terminal (docker-logs [orca CLI][dl-cli]), creating
  a worktree and launching into it (openproject [launch][op-launch], redmine, beads).
- Env injection: openproject's `agent.launch.before` hook adds URL and token to every agent
  Orca starts ([hook][op-hook]).

### 4.7 Bundling

- No build at all: `main`, a panel or editor `entry` and `<script type="module" src="x.ts">` may
  be TypeScript that Orca transpiles on load, relative imports resolved (docker-logs,
  git-history, redmine, release-status, openproject, git-log). Workers cannot be `.tsx`.
- esbuild single-file worker when npm packages are needed: ork-dbclient bundles its drivers
  (`packages: 'bundle'`, `external: ['node:*']`, a `createRequire` banner, [build][od-build]);
  graphiql emits ESM for node22 with `orca` external ([build][gq-build]).
- Frames: Vite for a heavy editor with local workers (graphiql, Monaco), esbuild IIFE
  (ork-dbclient), or one self-contained HTML file so `orca serve` browser clients can load it
  (git-control [inline build][gc-build], orchestra). graphiql's release checker cites Orca limits
  of 2000 files and 50 MiB per plugin, 10 MiB per entry and 1 MiB per transpiled file
  ([build README][gq-buildreadme]). Guess: bpmn-js must be bundled into the frame, since frames
  have no network and Orca resolves only relative imports.

### 4.8 Frame and worker contract

- One shared file declares the contract by module augmentation, `declare module 'orca' {
interface PluginRequests {…}; interface PluginPanelEvents {…} }`, imported by both sides
  ([authoring][ref-authoring-data]; graphiql [protocol][gq-proto], git-history
  [contract][gh-proto], openproject [protocol][op-proto]). docker-logs keeps a plain `Requests`
  type instead ([contract][dl-proto]).
- Frame calls `orca.plugin.request(name, input, { timeoutMs, signal })` (default 30 s, at most
  120 s; starts the worker); worker answers with `orca.panels.handle` and pushes with
  `orca.panels.post`. Inputs up to 64 KiB, answers up to 1 MiB; graphiql caps its own requests at
  60 KiB to leave room for the envelope.
- Errors: a thrown error with a host code reaches the frame with that code, anything else is
  `action_failed`. graphiql returns `{ ok, value } | { ok: false, error: { kind, message } }`
  instead, so the frame can branch on kind (approval, authentication, tls, production).
- Requests carry ids, never paths or URLs: git-history names a workspace by id, orchestra a
  saved server by id, release-status a run it listed.

## 5. Patterns worth copying

1. Worker owns network, secrets and Node; frames only render and ask by id through one typed
   contract file (graphiql, git-history, orchestra).
2. Full tab as a custom editor on a Pulse suffix, opened by the worker from a git-excluded handle
   file whose JSON names the view; `newFiles` only as the + menu entry (git-log, git-control,
   agent-activity).
3. Production makes confirmation mandatory, and the worker enforces it: confirm flag plus "only
   ids I listed" plus a fresh precheck (graphiql, git-graph, release-status, git-log).
4. Confirm in the frame with an own `<dialog>` that names the target and the verb (graphiql,
   git-control).
5. Secrets: check `secrets.protection`, bind each secret to its endpoint, never fall back to
   plaintext, never send one to a frame (graphiql, ork-dbclient).
6. Agent handoff: `agent.launch` with the agent from a setting and a prompt of task line,
   untrusted note and capped, fenced data (docker-logs, openproject).
7. Status bar item polled by the worker with a tone per state (docker-logs, openproject).
8. Panel polling paused while hidden, plus a worker `panels.post` after each write
   (docker-logs, git-log).
9. One app for sidebar and tab, switched by a `data-mode` attribute (git-log, agent-activity).

## 6. Pitfalls seen

- Frames have no network and an editor never learns its file's path: everything remote goes
  through the worker; graphiql recovers paths through `editor.save.before`.
- The host API has gaps (focus a terminal, open a file at a line or with a given editor, create a
  worktree), so many plugins shell out to the `orca` CLI found in the app bundle or on PATH. It
  works but ties the plugin to the CLI's flags and JSON. orchestra goes further and reads Orca's
  private server registry.
- Handle files show up in the file tree and in `git status` unless excluded; templated
  `newFiles` stay after the tab closes.
- openproject stores the token in plaintext storage when secrets fail, and injects it into every
  agent's environment through `agent.launch.before`.
- `workspace.changed` has no workspace id; matching by name and branch can pick the wrong one for
  same-named projects (git-history checks a folder's branch to tell them apart).
- Components panels need the desktop app and have no dialog and no DOM; multi-file HTML frames
  break in `orca serve` browser clients.
- A worker may stop when idle and loses in-memory state; hooks have 2 s; requests 64 KiB in and
  1 MiB out; posts 200 per 10 s.
- Remote (SSH, paired) workspaces: most plugins filter `workspace.list` to local hosts and say so.

[cat-off]: https://github.com/stablyai/orca-plugins/blob/main/orca-catalog.json
[cat-com]: https://github.com/stablyai/orca-community-plugins/blob/main/orca-catalog.json
[mirror]: https://github.com/stablyai/orca-community-mirror
[ref-manifest]: https://github.com/stablyai/orca/blob/main/docs/reference/plugin-manifest.md
[ref-newfile]: https://github.com/stablyai/orca/blob/main/docs/reference/plugin-manifest.md#newfilecontribution
[ref-editor]: https://github.com/stablyai/orca/blob/main/docs/reference/plugin-manifest.md#customeditorcontribution
[ref-host]: https://github.com/stablyai/orca/blob/main/docs/reference/plugin-host-api.md
[ref-authoring]: https://github.com/stablyai/orca/blob/main/docs/reference/plugin-authoring.md
[ref-authoring-data]: https://github.com/stablyai/orca/blob/main/docs/reference/plugin-authoring.md#panels-workers-and-data
[ref-dui]: https://github.com/stablyai/orca/blob/main/docs/reference/plugin-declarative-ui.md
[ref-dui-catalog]: https://github.com/stablyai/orca/blob/main/docs/reference/plugin-declarative-ui.md#catalog
[orca-untitled]: https://github.com/stablyai/orca/blob/main/src/renderer/src/store/slices/editor/opening/untitled-file-creation.ts
[orca-untitled-md]: https://github.com/stablyai/orca/blob/main/src/renderer/src/lib/create-untitled-markdown.ts
[orca-template]: https://github.com/stablyai/orca/blob/main/src/main/plugins/plugin-new-file-template.ts
[orca-newfiles]: https://github.com/stablyai/orca/blob/main/src/renderer/src/store/plugin-new-files.ts
[gq-proto]: https://github.com/faisalmuhammad/orca-graphiql/blob/v0.1.6/build/src/shared/protocol.ts
[gq-worker]: https://github.com/faisalmuhammad/orca-graphiql/blob/v0.1.6/build/src/worker/main.ts#L57-L130
[gq-cred]: https://github.com/faisalmuhammad/orca-graphiql/blob/v0.1.6/build/src/worker/credentials.ts
[gq-files]: https://github.com/faisalmuhammad/orca-graphiql/blob/v0.1.6/build/src/worker/session-files.ts
[gq-app]: https://github.com/faisalmuhammad/orca-graphiql/blob/v0.1.6/build/src/editor/App.tsx#L47
[gq-modal]: https://github.com/faisalmuhammad/orca-graphiql/blob/v0.1.6/build/src/editor/Modal.tsx
[gq-activity]: https://github.com/faisalmuhammad/orca-graphiql/blob/v0.1.6/build/src/activity/main.ts
[gq-build]: https://github.com/stablyai/orca-community-mirror/blob/d03b9297300ec3aae79b8cad5a0d343cc7e993a0/build/scripts/build-worker.mjs
[gq-buildreadme]: https://github.com/stablyai/orca-community-mirror/blob/d03b9297300ec3aae79b8cad5a0d343cc7e993a0/build/README.md
[gq-tpl]: https://github.com/stablyai/orca-community-mirror/blob/d03b9297300ec3aae79b8cad5a0d343cc7e993a0/templates/empty.graphiql
[od-main]: https://github.com/stablyai/orca-community-mirror/blob/0e7ce33aea23bc4bbfd742960a7e369361ea3a12/src/main.js#L164-L192
[od-panel]: https://github.com/stablyai/orca-community-mirror/blob/0e7ce33aea23bc4bbfd742960a7e369361ea3a12/src/panel.js#L86-L117
[od-build]: https://github.com/stablyai/orca-community-mirror/blob/0e7ce33aea23bc4bbfd742960a7e369361ea3a12/scripts/build.mjs
[op-proto]: https://github.com/stablyai/orca-community-mirror/blob/f1cb38a20da2b5583bc160f2a331a507d61925b7/src/protocol.ts
[op-hook]: https://github.com/stablyai/orca-community-mirror/blob/f1cb38a20da2b5583bc160f2a331a507d61925b7/src/worker.ts#L1180-L1195
[op-status]: https://github.com/stablyai/orca-community-mirror/blob/f1cb38a20da2b5583bc160f2a331a507d61925b7/src/worker.ts#L760-L784
[op-token]: https://github.com/stablyai/orca-community-mirror/blob/f1cb38a20da2b5583bc160f2a331a507d61925b7/src/worker.ts#L1278-L1286
[op-prompt]: https://github.com/stablyai/orca-community-mirror/blob/f1cb38a20da2b5583bc160f2a331a507d61925b7/src/openproject-api.ts#L115
[op-launch]: https://github.com/stablyai/orca-community-mirror/blob/f1cb38a20da2b5583bc160f2a331a507d61925b7/src/worker.ts#L1960-L2160
[op-state]: https://github.com/stablyai/orca-community-mirror/blob/f1cb38a20da2b5583bc160f2a331a507d61925b7/src/state/panel-state.ts#L394
[dl-proto]: https://github.com/stablyai/orca-community-mirror/blob/64fc3b217c5e1bd67f0b5ce7eb34a3cb16ae68c7/src/protocol.ts
[dl-ask]: https://github.com/stablyai/orca-community-mirror/blob/64fc3b217c5e1bd67f0b5ce7eb34a3cb16ae68c7/src/worker.ts#L328-L355
[dl-poll]: https://github.com/stablyai/orca-community-mirror/blob/64fc3b217c5e1bd67f0b5ce7eb34a3cb16ae68c7/src/worker.ts#L361-L400
[dl-confirm]: https://github.com/stablyai/orca-community-mirror/blob/64fc3b217c5e1bd67f0b5ce7eb34a3cb16ae68c7/panel/main.ts#L912-L926
[dl-ppoll]: https://github.com/stablyai/orca-community-mirror/blob/64fc3b217c5e1bd67f0b5ce7eb34a3cb16ae68c7/panel/main.ts#L1169-L1176
[dl-cli]: https://github.com/stablyai/orca-community-mirror/blob/64fc3b217c5e1bd67f0b5ce7eb34a3cb16ae68c7/src/orca-cli.ts
[dl-html]: https://github.com/stablyai/orca-community-mirror/blob/64fc3b217c5e1bd67f0b5ce7eb34a3cb16ae68c7/panel/index.html#L279
[gh-readme]: https://github.com/stablyai/orca-community-mirror/blob/82aa5412f51d7ac813d6b6283ce83b009aa0298c/README.md
[gh-main]: https://github.com/stablyai/orca-community-mirror/blob/82aa5412f51d7ac813d6b6283ce83b009aa0298c/editor/main.ts
[gh-proto]: https://github.com/stablyai/orca-community-mirror/blob/82aa5412f51d7ac813d6b6283ce83b009aa0298c/src/protocol.ts
[gh-worker]: https://github.com/stablyai/orca-community-mirror/blob/82aa5412f51d7ac813d6b6283ce83b009aa0298c/src/worker.ts#L25-L60
[gc-tab]: https://github.com/stablyai/orca-community-mirror/blob/8636505234ddbdf16a82bbabd45c8b5d555c822d/worker/main.mjs#L778-L812
[gc-cmd]: https://github.com/stablyai/orca-community-mirror/blob/8636505234ddbdf16a82bbabd45c8b5d555c822d/worker/main.mjs#L2498-L2503
[gc-doc]: https://github.com/stablyai/orca-community-mirror/blob/8636505234ddbdf16a82bbabd45c8b5d555c822d/panel/app.js#L445-L455
[gc-confirm]: https://github.com/stablyai/orca-community-mirror/blob/8636505234ddbdf16a82bbabd45c8b5d555c822d/panel/app.js#L267-L268
[gc-build]: https://github.com/stablyai/orca-community-mirror/blob/8636505234ddbdf16a82bbabd45c8b5d555c822d/tools/build.mjs
[gl-tab]: https://github.com/stablyai/orca-community-mirror/blob/36f68b2f304aab6ca9410e90329809d5f20ccd12/src/worker/main.ts#L13-L62
[gl-watch]: https://github.com/stablyai/orca-community-mirror/blob/36f68b2f304aab6ca9410e90329809d5f20ccd12/src/worker/main.ts#L75-L84
[gl-editor]: https://github.com/stablyai/orca-community-mirror/blob/36f68b2f304aab6ca9410e90329809d5f20ccd12/src/ui/editor.html
[gl-panel]: https://github.com/stablyai/orca-community-mirror/blob/36f68b2f304aab6ca9410e90329809d5f20ccd12/src/ui/panel.html
[gl-check]: https://github.com/stablyai/orca-community-mirror/blob/36f68b2f304aab6ca9410e90329809d5f20ccd12/src/worker/actions.ts#L52
[rm-proto]: https://github.com/stablyai/orca-community-mirror/blob/de6815dbe7d07366595e87ca5b8f496ab2c1d0c4/src/protocol.ts
[rm-send]: https://github.com/stablyai/orca-community-mirror/blob/de6815dbe7d07366595e87ca5b8f496ab2c1d0c4/src/worker.ts#L201-L211
[rm-files]: https://github.com/stablyai/orca-community-mirror/blob/de6815dbe7d07366595e87ca5b8f496ab2c1d0c4/src/agent-files.ts
[rm-launch]: https://github.com/stablyai/orca-community-mirror/blob/de6815dbe7d07366595e87ca5b8f496ab2c1d0c4/src/launch.ts
[rs-handlers]: https://github.com/stablyai/orca-community-mirror/blob/acd8eef9a612cde66a25a49f833898886b4342bb/src/handlers.ts#L505-L532
[rs-panel]: https://github.com/stablyai/orca-community-mirror/blob/acd8eef9a612cde66a25a49f833898886b4342bb/src/panel.tsx#L166-L178
[rs-proto]: https://github.com/stablyai/orca-community-mirror/blob/acd8eef9a612cde66a25a49f833898886b4342bb/src/protocol.ts#L122-L163
[oc-worker]: https://github.com/stablyai/orca-community-mirror/blob/a97172382ee0c9eeee0d35de1a7ecf3f297827c0/worker/main.mjs#L225-L233
[oc-sec]: https://github.com/stablyai/orca-community-mirror/blob/a97172382ee0c9eeee0d35de1a7ecf3f297827c0/docs/SECURITY.md
[oc-build]: https://github.com/stablyai/orca-community-mirror/blob/a97172382ee0c9eeee0d35de1a7ecf3f297827c0/source/README.md
[gg-cache]: https://github.com/stablyai/orca-community-mirror/blob/24bc65840b7e8f04ca8d759bd81844c57ef8470c/src/diff-cache.mjs#L11-L35
[gg-open]: https://github.com/stablyai/orca-community-mirror/blob/24bc65840b7e8f04ca8d759bd81844c57ef8470c/src/diff-cache.mjs#L70-L88
[gg-guard]: https://github.com/stablyai/orca-community-mirror/blob/24bc65840b7e8f04ca8d759bd81844c57ef8470c/src/actions.mjs#L19
[tl-worker]: https://github.com/stablyai/orca-community-mirror/blob/7376e52be94e0bd512906ffbc4f1f926111590c7/worker.js#L980-L1000
[ka-manifest]: https://github.com/stablyai/orca-community-mirror/blob/f2eb7ea1822ea82e8c3ae5557bfb715a21e61926/orca-plugin.json
[ka-tpl]: https://github.com/stablyai/orca-community-mirror/blob/f2eb7ea1822ea82e8c3ae5557bfb715a21e61926/overview.orca-activity
[rb-types]: https://github.com/stablyai/orca-community-mirror/blob/717d9ebb68b04aa802424f3aa2c85eb62f586b19/src/orca/workflow-types.ts
[rb-send]: https://github.com/stablyai/orca-community-mirror/blob/717d9ebb68b04aa802424f3aa2c85eb62f586b19/src/orca/workflow.ts#L254-L285
[np-auth]: https://github.com/stablyai/orca-community-mirror/blob/028ffd9adc54ed4849ae676e5f402602aa37df86/backends/webapi/auth.mjs
[an-manifest]: https://github.com/stablyai/orca-community-mirror/blob/0aa7174d882d23a29c0b45b7f9cb1bcacefb94f9/plugins/now-playing/orca-plugin.json
[io-manifest]: https://github.com/stablyai/orca-community-mirror/blob/11f2753266f23cf82f1abc8fef0a68afaed8d021/orca-plugin.json
[ab-manifest]: https://github.com/stablyai/orca-community-mirror/blob/d2a527c3231a5a314b7416110329e462569f60d3/orca-plugin.json
[rc-manifest]: https://github.com/stablyai/orca-community-mirror/blob/b378065f81db7cc1998147bdc1ef89fa5e92c29f/orca-plugin.json
