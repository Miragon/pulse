# User interface

- Status: accepted
- Last reviewed: 2026-10-26 (boards, see [boards.md](boards.md); live updates, see [live-updates.md](live-updates.md); moving a token; bulk cancel, see [writes.md](writes.md); migration, see [migrations.md](migrations.md))

## Context

Developers are the primary users (maintainers in Miragon/bpmn-modeler#1688). Four
cockpit personas (a C7 process developer, an ops engineer on call, a BPM consultant and
a C8 developer) ranked their jobs; the UX concept follows the Miragon design system for
built software surfaces (`miragon-brand:modeler-tool-design`) and VS Code's UX
guidelines.

## Decision

### Name

**Pulse**, the name of Miragon's process analytics and operations for the Camunda 7
family ([Miragon/pulse](https://github.com/Miragon/pulse), an MCP server). Same engines, same
questions, another surface: this extension is Pulse inside VS Code. The Marketplace shows
"Miragon Pulse" because the bare name is crowded there. Not "Operate" (Camunda 8's app and
Miragon's CLI) and not "Cockpit" (Camunda 7's webapp).

### Information architecture

| Surface                           | Contents                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Activity Bar container _Pulse_    | One native tree, **Engines** (engine › definitions with `vN · n running` and a red incident decoration; a click on an engine opens its overview, the twistie expands it; on top, an error item per problem of a broken `.pulse-cli.json`, e.g. `.pulse-cli.json: the file is not valid JSON`, and a warning item per project file under the CLI's former name, each opening its file); open incidents show as the red decoration and count per definition, and in the engine overview's _With incident_ scope                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Activity Bar view **Boards**      | One entry per `.pulse/boards/*.board.json`, named by the board's title with its file name beside it, an error icon and the problem count on a broken file; shown only when the workspace has a board; **New Board…** in its title bar and in the Engines menu ([boards.md](boards.md))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Webview editor tab **Board**      | "Shop operations · Board": the header names the board and its engines, Refresh and Open file, never an access chip (each engine has its own); one strip per engine that failed (with Set credentials… or Edit connection…) or is not in `.pulse-cli.json` (Edit connection…), a line of the engines that answered (production name in red when configured), then rows of cards that stack below 760 px. A counter shows the total, "from 2 of 3 engines" when one is missing, the threshold and which engines crossed it, one clickable line per engine ("not read" where it was not); an instance list is one table with an Engine column, the rows of each engine together and "showing 50 of 1,204" per engine below it; a broken file lists each problem with its path and reason above the last valid board                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Webview editor tab **Engine**     | One per engine, "shop-dev · Processes": the header names product and version from `describeEngine`, access, freshness, Refresh and the web UI's start page; one filter bar (scopes _All · With incident_ with counts, search by name or BPMN process id, the engine's summary "3 processes · 172 running · 10 with incident"); a table Process (name, BPMN process id muted) · Latest version · Running · With incident (red above 0), incidents first, then running, then name. A row opens the definition panel at the latest version (the tab the Engines tree opens), Ctrl/Cmd+click to the side                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Webview editor tab **Definition** | The header names the process (its BPMN process id when it has no name) and the version picker, not the id beside the name. Deployed diagram of one version with a badge cluster per element (running, incidents, incidents in called instances; a click on a count filters the instances to the element and its scope, _With incident_ for both incident counts, _Running_ for the blue one), a jump into each called process, version picker with per-version counts, _Open model_ in the header when a local `.bpmn` declares the process (centred on the filtered element, the tooltip says when the file differs from the deployed version) and a code button on the filtered element's shape when its code is found, notices (older versions still running, drift), one filter bar above the instance table (scopes _Running · With incident · Ended · All_ with counts, element filter, business-key search, badge legend behind `?`); on a writable engine a checkbox column, a selection bar and a bulk strip to cancel or migrate many instances                                                                                                                                                                                                    |
| Webview editor tab **Migration**  | One per engine and process, "Order fulfillment v2 → v3 · shop-dev": the target picker in the header, the source and target diagrams side by side (stacked below 900 px), the mapping table with one select per element, the action row with the summary and Migrate or what blocks it, and the shared bulk strip ([migrations.md](migrations.md))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Webview editor tab **Instance**   | A code button on the shape of the clicked element and of every incident element whose code is found, a header with id, definition, caller and start (or end) to the millisecond but no state or incident label (the diagram, the Incidents tab and its count say that), a strip docked under the header only for several incidents (their count and the first root cause, no actions) or a suspended or ended instance, waiting and incident markers, the path it took (done elements and taken flows in green), a jump into the called instances of each call activity and back to the caller, tabs History (each element run with start and end to the millisecond, and duration) / Incidents (each card with what the local model configures on the element, its file and whether it differs from the deployed version, _Open in model_ and _Open code_, all only when found, plus the actions the strip does not already offer for that incident; no message the root cause already repeats, no engine type beside the incident id; [local-sources.md](local-sources.md)) / Waiting / Variables in one bar with the marker legend behind `?`, engine types and scopes, an inline editor per editable variable, links into called instances, copy buttons |
| Native read-only document         | Complete stack trace or error message, with links from application frames to their line and from thrown and frame classes to their declaration in the workspace                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Status bar                        | One item: active engine, `$(eye)` read-only or `$(edit)` writable, red background for production; with a `.bpmn` open its running and incident counts, click shows its runtime data                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Commands                          | Go to Process Instance… (id or business key), Open Engine Overview… (picks an engine when there are several), Show Runtime Data for This Model (`.bpmn` explorer menu and an icon in the editor title bar), Switch Engine…, Set Credentials…, Configure Engines, Refresh                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

Runtime UI stays out of the BPMN modeler's own toolbar: modelling users are not
confronted with runtime data (#1688).

### Visual language

- The webview uses only Miragon `--cd-*` tokens (mostly the `--cd-ui-*` roles) from
  vendored, unchanged token files (`apps/vscode/src/webview/theme/`); no `--vscode-*` colour
  (ESLint enforces it). The
  renderer draws with the two light roles plot and text; they are constants that a drift
  test pins to `cd-tokens.generated.json`, so the bundle carries no token map it does not
  read (303 B gzip). Native surfaces use VS Code theme colours only.
- Light, dark and high contrast switch by CSS only: the cd-canvas role classes are
  assigned to the rendered SVG once per import; viewbox and overlays stay.
- One severity ladder: incident (danger, full badge), incident in a called instance
  (outline), running (blue badge), stale (outline). No state by colour alone, no green
  "healthy", no greyed-out write buttons; production is red only when configured
  (`pulse.environments`), never guessed from a name. The panel headers name neither
  engine nor environment (a board's names its engines, since it spans several): the Engines
  tree and the status bar do, and every write dialog
  names both ([writes.md](writes.md)).
- Geist / Geist Mono, Lucide icons in the webview, codicons on native surfaces. The
  webview draws Lucide's geometry itself: `components/lucide-glyphs.json` holds the
  glyphs it uses, copied from lucide-preact 1.61.0 with Lucide's ISC and Feather's MIT
  notice, and `Icon` renders them. lucide-preact's runtime and per-path keys cost
  2.1 kB gzip of the bundle budget; a new icon is one more entry in that file.

### Moving a token

A move starts on the diagram, where the token is: selecting an element that holds a
token puts a move button (arrow) below its shape, beside the code button, where every
element action sits like a bpmn-io overlay; a token that cannot move gets a "can't move"
sign there with the reason as its tooltip, so no button is greyed out. The tables stay free of write columns; on a writable engine the element names in the Waiting tab select the element on the diagram and focus its move button, the keyboard path to a move. The move panel takes the place of the tabs: the diagram outlines the allowed
targets dashed and dims the refused ones, a click on a refused one says why in the
panel's status line, and a "To" list is the keyboard path to the same targets. Once a
target is picked, the source shows "−1" with a struck-through label and the target "+1"
(a re-run shows "runs again"), and the review list says what the move does, its
warnings and "This can't be undone." A reason is required; Escape or Cancel closes the
panel and puts the focus back on the move button. The core decides every target, refusal,
effect and warning; the webview only draws them.

### Notices are docked strips

Headline, outcome of the last write, problems and definition notices are one-line
strips directly under the header. A single incident gets no headline: its card already
says it all, with its actions (Stacktrace, Open in model, Open code, Retry) next to what
they act on. Only several incidents, in parallel paths or called instances, get one, as a
summary without actions. Strips are never cards floating on the diagram: tone colour,
icon, a title that never shortens, a detail that ends in "…" with the full text in the
tooltip, actions on the right. Below 900 px the actions show their icons only, below
480 px the detail is dropped (container queries). A problem offers Reconnect, plus Set
credentials… (straight to the prompt for that engine) when the engine rejected the
credentials, or Edit connection… for the other connection problems.

### One filter bar, resizable tables

The bottom pane of the split starts with one 36 px bar; it replaced the legend line under
the diagram, the "Instances … · n running" header and the toolbar.

- **Definition panel:** scopes with counts, element chip, business-key search, the
  filter button (a funnel) with one chip per variable condition and, at the far end, the legend
  button. The scopes are a `radiogroup` ("Show instances") with one tab
  stop on the checked radio; ←/→/Home/End move and select, the latest request wins,
  and the checked segment is boxed, not underlined (an underline means tabs). Each
  scope shows `DefinitionView.scopeCounts` (compact, the exact value in the tooltip, a
  red "With incident" count when it is above 0). Counts follow the element filter, the
  business-key search and the variable conditions, so a count says what a click shows; the version totals stay
  in the version picker. While the panel refreshes the old counts stay and the group is
  `aria-busy`.
- **Variable conditions:** the funnel button ("Filter by variables", with conditions their
  count beside the icon and "…, 2 active" in its name) opens a modal `<dialog>` for one
  condition: name, _Compare as_ (Automatic, Text, Number, True or
  false, Date and time, Null), the operators that fit the type and the value. Opening
  it sends `suggestVariableNames`; the core reads `listVariableNames` once per version and
  republishes them as `DefinitionView.variableNames`, which the name field offers in a
  `datalist` while it still takes any text (no names, no list; a failed read suggests
  nothing). Value stays editable before a name is set: a disabled field would drop out of
  the tab order without saying why, and Apply names a missing name. Date and
  time takes a `datetime-local` field and offers _is after_ and _is before_, read in the
  local time zone; Null asks for no value and offers _is null_ and _is not null_; the
  dialog says that JSON and object variables cannot be searched. Apply adds it, or replaces the
  one whose chip was clicked; every chip (`amount > 100`, `route = "review"`, text in
  quotes) has its remove button and keeps its width up to 240 px, the bar wrapping into a
  second row instead; all conditions must hold, at most 5. Automatic reads
  `42` and `-4.5` as a number, `true` and `false` as true or false and anything else as
  text; _matches_ compares text and _is greater than_ and _is less than_ numbers.
  `VariableConditionRules` in the protocol holds these rules for the guard and the core,
  which also labels the chips (`DefinitionView.variableLabels`); the webview imports the
  protocol as types only, so the dialog keeps its operator table, number and date patterns and cap
  as constants a test holds equal to the rules. The conditions survive a scope change, the element filter,
  the business-key search and a version switch, which resets scope and element only; the
  cancel confirmation names them in its filter line.
- **Instance panel:** the History / Incidents / Waiting / Variables tablist on the left, the marker
  legend button on the right.
- **Engine overview:** the scopes _All_ and _With incident_ ("Show processes", the same
  radiogroup), a search by name or BPMN process id and, at the far end, the summary of the
  whole engine. The counts follow the search; the summary does not. A filter re-derives
  the view from the loaded snapshot, so it costs no engine call and shows no
  "Refreshing…"; after a failed refresh the list stays marked offline. Below 760 px the
  summary moves into the first row with the scopes. No column sorts: `DataTable` cannot,
  and header buttons with `aria-sort` and a sort intent would cost more bundle than the
  fixed order (incidents, then running, then name) is worth.
- **Legend:** always behind a `CircleQuestionMark` button with a native `popover`,
  anchored above the button over the diagram, never inline: what a reader needs once
  hides instead of taking room every time. Digit-free shapes; its first line
  (definition: "Badges count running instances of vN") replaces the version line. Below
  760 px the definition bar takes two rows: scopes and legend button, then element chip,
  variable chips and search. Container queries, no JavaScript.
- **Escape** clears the instance selection first and the element filter after it, only
  when no popover or dialog is open, focus is not in a field (a checkbox does not count)
  and no column drag is cancelled. In the variable dialog it closes the dialog only;
  Escape never clears a variable condition.
- **Columns** of the Processes, Instances, Waiting, Variables and History tables are resizable: a
  `separator` on the right edge of every header but the last (←/→ 8 px, Shift 32 px,
  Enter or a double-click fits the widest cell up to half the visible table, Home sets
  the minimum of label plus 24 px, Escape during a drag restores the start width). The
  first resize freezes every measured width into a `colgroup` with a fixed table
  layout; until then the tables fit their content. The last column takes the rest (at
  least 80 px), the table scrolls when it gets wider, and cut-off cells end in "…" with
  the full text in the tooltip. Widths are kept per panel and table in the webview
  state and checked when read. `Separator` holds the pointer and keyboard code; the
  split handle uses it too.

### Selecting instances and the bulk strip

Bulk cancel lives in the definition panel; who may and how it is confirmed is in
[writes.md](writes.md).

- **Checkbox column.** A fixed 32 px first column appears only on a writable engine,
  outside the _Ended_ scope and when a shown row can be cancelled. It has no resize grip
  and is neither measured nor saved with the column widths. Under _All_ an ended row has
  an empty cell. A click anywhere in the cell toggles the row without opening it. The
  header checkbox ("Select all shown instances") is tri-state over the shown rows that
  can be cancelled; unticking it while more is selected than is shown (after "Select
  all") clears the whole selection. Row checkboxes have no tab stop: the row keeps the
  focus, Space toggles it and Enter still opens it.
- **Selection bar** between the filter bar and the table, shown once something is
  selected: "12 selected" (or "All 117 running selected", announced politely),
  "Select all 117 running" while more run than are selected, "1234 match · narrow the
  filter to 1000 or fewer" above the cap instead, then _Cancel instances…_ and, when the
  process has another version, _Migrate to version…_ or, while a run of the process is
  active, "Wait until cancelling 44 instances ends", and _Clear_.
  The button is never greyed out. Below 760 px the bar wraps and the note takes a row of
  its own.
- **Bulk strip**, docked under the header above the notices, one per process and engine,
  shared by its panels. It names the run's version when another one is shown ("of v2").
  States, with their actions:

  | State                  | Strip                                                                          | Actions                                    |
  | ---------------------- | ------------------------------------------------------------------------------ | ------------------------------------------ |
  | submitting             | "Cancelling 44 instances…"                                                     | none                                       |
  | running                | "Cancelling instances: 20 of 44 done", the failed count only when some failed  | Stop                                       |
  | running, unread        | the same title, "Pulse can't read its progress: " and the problem (warning)    | Stop                                       |
  | stalled                | "No progress for 5 min: 20 of 44 done" with the action's hint (warning)        | Stop                                       |
  | stopping               | "Stopping… 20 of 44 cancelled so far"                                          | none                                       |
  | stopped                | "Stopped. 23 of 117 cancelled, 94 still running."                              | Select the 94 still running, Dismiss       |
  | stopped, halted        | the same, "The engine keeps the halted operation. Stop again to remove it."    | Stop, Select the 94 still running, Dismiss |
  | finished               | "Cancelled 44 instances.", and "3 instances already ended and were left alone" | Dismiss                                    |
  | finished, some running | "Cancelled 40 of 44. 4 still running." (danger)                                | Select the 4 still running, Dismiss        |
  | start failed           | "Could not start cancelling." with the engine's message (danger)               | Dismiss                                    |
  | outcome unknown        | "Unknown whether cancelling started." (warning)                                | Check instances, Dismiss                   |

  With one left the action reads "Select the one still running"; it appears only while
  the run's version is shown and uses the ClipboardList icon. Stop appears only while
  the connection can write. Running, stalled and stopping show a 3 px progress bar on a
  track (`role=progressbar`, done plus failed of the total, with `aria-valuetext`
  "20 of 44 done"), which is not live. One hidden live region announces the strip's
  title only when the state changes: politely, assertively for a danger strip. The
  strip itself has no `role=alert`. While the engine lane is blocked the problem reads
  "Paused until the engine accepts the login again."

### Migrating instances

_Migrate to version…_ hands the selection to a tab of its own; the flow, its texts and
its rules are in [migrations.md](migrations.md). The layout: the header holds the source
version, an arrow and the target picker ("Pick a version" until one is chosen); the
diagrams sit side by side from a container width of 900 px and stack below it, each at
least 300 px high (a smaller canvas cannot fit the diagram); the target diagram does not
store its zoom, so the two never share a viewport. A click on a source shape focuses its
mapping row and outlines it; the target diagram then outlines that row's candidates
dashed and its current target solid, and a click there maps it. Elements without a mapping
where selected instances wait get a danger dashed outline and a "no mapping" chip in the
table. Under the table one 36 px action row holds the summary and the Migrate button, or in its place the
reason it is blocked (with the whole text in its tooltip) and, where it applies, "Leave
the 3 out", after which the focus moves to the button. A hidden live region announces
politely what the row offers when it changes: the button's label or the reason; the
summary itself is not announced. The focused mapping row carries `aria-current` and an
outline that stays visible in every theme. The tab shows the
bulk strip of the process like the definition panel; "Show why" opens the reasons as a
read-only document.

### Jumps into call activities and sub-processes

- **Sub-processes** keep bpmn-js' own drill-down: the plane opens in place, breadcrumbs
  lead back. Inner elements carry their own badges and markers. The core rolls them up
  to each collapsed shape it reads from the XML (`BpmnStructure`): the badge shows the
  engine's running count of the sub-process and the incidents inside as a solid badge
  (a click filters by the sub-process), the instance marker is the strongest inside. A
  refresh keeps the plane, a version switch returns to the top. Only the top plane's
  view is stored for a rebuilt webview, so a sub-plane zoom never lands on the top.
- **Call activities** get our own 20 × 20 button where bpmn-js puts its drill-down
  (bottom −7, right −8, `bjs-drilldown` styles, scaling 0.7–1 like the badges) with
  Lucide `ArrowUpRight`: one click, Ctrl/Cmd+click opens to the side, the shape's own
  click keeps filtering. The core builds the label and target from
  `getCalledProcesses` and the called instances (`calledFromElementId`):
  - definition view: "Open called process Shipment" opens its definition panel at the
    version the binding starts;
  - instance view: one called instance opens it, several open a quick pick ("Choose one
    of 3 called instances", incidents first), none yet opens the called process (the
    button says that the process is not called yet and names it);
  - a process that is not deployed keeps an outlined button ("shipment isn't deployed
    on shop-dev"); a click shows the same text as an info strip;
  - a called process only an expression decides gets no button in the definition view;
    the instance view follows its called instances.
- A jump always opens another editor tab (or reveals it); back is VS Code's Go Back, and
  the one back button of a panel sits in its header, left of the title, never on the diagram.
- The header holds what concerns the whole process or instance: back, Open in Cockpit and,
  in the definition panel, Open model (the local file, centred on the filtered element).
  The instance panel opens the model from its incident card only. Every action appears
  once on screen, on the incident card it acts on. The shape holds what the
  element runs: the jump into a called process under a call activity, the jump into the
  code at the bottom left of a task. The diagram already is the model, so no shape gets a
  model button. When the instance header runs out of room, its button labels give way to
  their icon and tooltip.
- Every header keeps one order: title, what identifies the subject (product; version;
  id, definition, caller, time), the actions inside VS Code (Refresh, Open model, Copy
  handover), Open in Cockpit last; access and freshness on the right.
- Instance start and end and the History tab's times show seconds and milliseconds
  (`09:05:07.042`, the day before it when it is not today): runs a few milliseconds apart
  stay apart. Lists and waiting times stay at minutes.
- A called instance's header links to its caller ("from 63e79cda…", `CornerLeftUp`). It
  names the caller by its short id: the called instance's data has no business key of
  the caller, and reading it would cost a second detail read per load.
- Reading the called processes costs one more engine call per load, and only when the
  diagram has a call activity.

### Links into the engine's own web UI

- Where Pulse stops, the engine's web UI (Cockpit) goes on (history, modifications). A ghost
  button with Lucide `ExternalLink` (it leaves VS Code; `ArrowUpRight` stays for jumps
  inside the editor) follows "Copy handover" in the instance header and the version
  picker or Open model in the definition header: "Open in Cockpit" (the adapter names the web UI), icon only
  below 900 px, tooltip "Open ORD-10129 in Cockpit on shop-dev".
  The tooltip names the target, not the product, which the badge does not know.
- The engine overview's button follows Refresh and opens the web UI's start page:
  Cockpit's dashboard or the CIB seven webclient's start page
  ("Open Cockpit on shop-dev").
- It opens the shown instance (Cockpit on its incidents tab when it has one) or the
  shown version, not single incidents: Cockpit's instance page lists them.
- `cockpitUrl` per profile in `.pulse-cli.json` (an http or https URL
  without credentials, else the target is refused with a problem); without it there is
  no button at all, never a disabled one, and no guess from the REST endpoint: a link
  that 404s costs more trust than a missing one. The adapter knows the routes
  ([c7-adapter.md](c7-adapter.md)); the webview posts
  `openWebUi` without a URL and the extension calls `openExternal`.

### Scope

Built: connections, engines tree, engine overview, definition and instance panels, go to
instance, stack-trace documents with source links, copy ids, drift for the
open `.bpmn`, guarded retry and variable changes, bulk cancel with progress and Stop
([writes.md](writes.md)), migration of selected instances with a checked plan
([migrations.md](migrations.md)), instance counts
per scope (running, with incident, ended, all). Removed: the Health tree of incidents
grouped by masked message; the Engines tree, the engine overview and the incident cards
already lead to every open incident, and a second tree in the sidebar cost more attention
than it saved. Live updates of every view and their stamp, pause button and settings follow
[live-updates.md](live-updates.md). Deliberately not built: bulk retry, heatmap,
overdue jobs and topics without workers, variable history.

## Consequences

- The design guide's "no header bar" rule is broken on purpose: a tab title cannot hold
  version, access, freshness and the live updates button. Strips dock under it.
- The bpmn.io watermark stays visible (bpmn-js licence).
- Webview bundle: ~110.8 kB gzip; budget 200 000 B since 2026-10-22 (a maintainer's
  decision, see guardrails.md), may only shrink from there (`apps/vscode/test/__golden__/bundle-budget.json`).
- The engine overview reads one `listDefinitions` and one `describeEngine`: it knows
  running and with-incident counts per process, not ended ones, which would cost a count
  per process.
