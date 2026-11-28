# UI foundation and shared building blocks

- Status: accepted
- Last reviewed: 2026-11-22 (executed, D2's point 2: the verdict counts open root incidents,
  `engine_status`, `pulse status`, the cockpit's health route and the web app's verdict feed alike
  by c7-core's `rootIncidentCounts`, the thresholds unchanged; the web app's engine screen shows it
  as its bar's badge and the start page as its column State, for Camunda 7 engines, a Camunda 8
  engine none; the verdict's tones are pulse-ui's `VERDICT_TONES` and `READ_FAILURE_TONES`);
  2026-11-21, last (executed, D2's point 1 in the contract: engine-core's
  `incidents` of `DefinitionSummary` and `VersionSummary`, the open root incidents of a process over
  every version and of a version, admitted by the rule with two laws and their saboteurs on both
  dialects, a lower bound where a Camunda 8 search stops counting; the web app's engine screen and
  this extension's engine tab show them as the column Incidents from one read, with a legend of the
  counts); 2026-11-21, at the end of the day (executed, D10's search across engines: the
  screens' `Finder`, the feed `engine_screen_find_data`, the blocks' `FindResults` and
  `FindHistoryNotice`, the web app's `/app/search`; a law holds a business key's match whole on
  both dialects; c7-core's and c8-core's recorded screens made anew with what the finder finds);
  2026-11-21, later the same day (executed, D2's point 1 per element as planned:
  c7-core's element statistics take the statistics' incident counts as root incidents wherever no
  copy can lie and read the incidents of a version's call activities alone whole, where copies lie,
  sorted by id, every incident of the version only where its call activities cannot be told or one
  read takes fewer requests and less than a page of rows beyond theirs; the same counts, held by a
  law; on the MCP server the diagram from its one XML cache; c7-core's recorded screens and board
  made anew); 2026-11-21 (executed, D2's amendment for the chat: the MCP server's cockpit, in the
  chat and in the operations views the web app embeds, counts open root incidents, the statistics
  with `rootIncidents=true` per process and a version's incidents read whole per element as the
  shared process screen reads them, a copy at a call activity no count and no row of a process, an
  activity or a cause, a diagram's incidents in called instances a quiet badge apart; "new in 24 h"
  went, as the owner decided on 2026-11-20, a window Camunda 7 cannot count root incidents in; the
  verdict keeps every open incident until its own step); 2026-11-20, after the process screen's
  blocks (executed, D10's process screen:
  the web app shows a process in one version on its own screen, a process's blocks of
  `@miragon/pulse-blocks` over the MCP server's app-only feeds `engine_screen_process_data`,
  `engine_screen_instances_data` and `engine_screen_variable_names_data`, which build the process
  screen and the instance list of `@miragon/pulse-screens` exactly as both adapters do, its reads
  that load an engine's database on a floor of 30 s per caller; the version, the list's scope,
  element, key and variable conditions in the address, a version a new entry; pages of 50 by cursor
  with Load more; the variable conditions a pair with this extension, Camunda 8's refused kinds
  offered disabled with their reason; the hint of a history that misses running instances,
  `MissingHistoryNotice` over the screens' `HistoryGaps`, with no fallback; the page claiming the
  cockpit's process view and its list of a process's instances, no write slot filled);
  2026-11-20, before it (executed, D8's blocks of the
  process screen and its instance list: `@miragon/pulse-blocks` holds a process's version picker,
  the notice that older versions run, its instance list's filter bar with the variable condition
  dialog, the instance table and its next page, the counts and call buttons on its diagram and
  their legend, over the process screen's and the instance list's JSON forms; this extension's
  definition view renders them with its own table, id, count badge and canvas, its selection and
  bulk actions in a write slot; the dialog offers the kinds of condition a dialect refuses
  disabled with their reason, the owner's decision that day; D9's point 7 amended the same day:
  the webview's script may grow to 500,000 B gzip, not wasteful, each ceiling its measurement plus
  2 %); 2026-11-20, after the instance screen (executed, D8's builder of the process
  screen and the instance list: `@miragon/pulse-screens/builder` builds a process's versions with
  their counts, the badges of a version's diagram, rolled up onto collapsed sub-processes with the
  board builder's `DiagramBadges`, root incidents at the element and the incidents in called
  instances apart, its call targets, read unless the board builder's `CallActivities` finds no call
  activity in a diagram it could read, the rule this extension's core applies too, and the notice
  that older versions still run, and an instance list's page of 50, its scopes' counts on the first
  page with their lower bounds and its query, the variable conditions included, a date an instant
  with its offset, with the condition kinds a dialect refuses, and the rule that puts a later page
  after the rows shown without a repeated row (`InstanceRows` of the main entry); this extension's
  definition view and its instance list word them in English, its core reading a date condition's
  wall clock in the host's time zone, its protocol and fixtures unchanged; both recordings made
  anew in one run each; the instance screen reads the processes a version calls by the same rule,
  as the editors do); 2026-11-20, the very last time that day before (executed, D10's instance screen: the
  web app shows an instance and an incident under it on its own screen, the instance blocks of
  `@miragon/pulse-blocks` over the MCP server's app-only feed `engine_screen_instance_data`, which
  builds the instance screen of `@miragon/pulse-screens` exactly as both adapters do, an incident's
  text read in place through `engine_screen_incident_text_data`, the page claiming the cockpit's
  instance view, its history and an incident, no write slot filled; a screen of the page fills the
  window's height from 64rem on); 2026-11-20, the last time that day before (executed, D8's blocks of the instance screen: `@miragon/pulse-blocks` holds an instance's facts, head strip, incident cards and their text read in place, its tables of waits, path and variables, the menu of the instances a call activity called and its markers' legend, over the instance screen's JSON form, worded in English and German in a catalog of their own, with the slots `InstanceSlots` and the write controls as slots of the block that shows them; this extension's instance view renders them with its own table, links and copy, its retry, variable editor, move and stacktrace document in those slots, its English words unchanged, and the protocol carries what the blocks word beside the core's words, additively; the webview's script grew from 244,680 to 249,465 B gzip, its ceiling at the 250,000 B of point 7); 2026-11-20, later again (executed, D8's builder of the instance screen: `@miragon/pulse-screens/builder` builds an instance's root incident cards, its wait rows, path, call links, head strip as a code and its diagram's markers, rolled up onto collapsed sub-processes with the board builder's `CollapsedShapes`, a model of no text in which a card's root incident and its root cause line stay apart; this extension's instance view words that screen in English, its protocol unchanged, and both adapters build the instance screens c7-core's and c8-core's recordings expect, D2 per screen); 2026-11-20, later the same day (executed, D10's first screen: the web app shows an engine's processes on its own engine screen, the blocks `ProcessTable` and `ListFilterBar` with its own table and id over the MCP server's app-only feed `engine_screen_processes_data`, which builds the engine screen of `@miragon/pulse-screens` over the engine contract in every dialect, exactly as both adapters build it of the same recorded answers; the page claims the cockpit's overview, which the chat keeps); 2026-11-20 (executed, D8's blocks of the screens: `@miragon/pulse-blocks` holds the first two, `ProcessTable` and `ListFilterBar`, an engine's process list over the engine screen's JSON form of `@miragon/pulse-screens`, whose main entry `blocks-are-building-blocks` admits, worded in English and German in a catalog of their own, with the slots a surface brings, its table, its id, where a target opens and, on a surface with addresses, its link; this extension's engine tab renders them with its own `DataTable` and `NamedId`, its intents the protocol's `filterProcesses`, `openProcess` and `copy`, its English words unchanged, and the protocol's engine view carries the screen's totals beside its own fields, additively); 2026-11-19, later the same day (executed, D10's point 7: widget-shell's BPMN canvas follows the theme in the chat's widgets and the web app, on dark the webview's dark canvas value by value, in high contrast its 3 px outlines and badges edged in the text, under forced colours its markers in Highlight and its badges in Canvas and CanvasText on a drawing in the system's palette, which the editors' drawing is not, an open row of `docs/vscode/parity.md`; its zoom bar a card in the theme; its heat screened into the dark paper, a ramp derived from point 7 that awaits the owner's confirmation); 2026-11-19 (decided, D10: the web app gets a frame of its own, a side navigation, its own router and an address per view, and screens of its own in the editors' style, which it composes from building blocks of `@miragon/pulse-blocks` over the builders of a new published package, @miragon/pulse-screens, that the runtime view's core runs too; the cockpit's operations views stay embedded in the frame, the chat keeps its cockpit, the web app writes to no engine, and the diagram's canvas follows the theme in the web app and in the chat's widgets as in the editors; D2 and E2 amended: "Incidents" are open root incidents on every surface, the chat included, and the verdict follows on root incidents with the same thresholds; D8 amended with the screens' home, D9's point 7 with the web page's budget); 2026-11-18 (decided, D9's point 8: one row convention on every surface, a row opens on a click or Enter and copies with Ctrl or Cmd+C, the cockpit's rows without a drill); 2026-11-17 (executed for the web app of #573: `apps/web` renders the MCP server's views, the cockpit and its boards, as pages of the server through widget-shell's `mountPage`, a third surface on React, pulse-ui and widget-shell beside the chat's widgets, whose board route renders `@miragon/pulse-blocks` there too; a page writes to no engine); 2026-11-16 (executed for boards in the MCP server: the cockpit's board route renders `@miragon/pulse-blocks` with its own table, id and diagram, over the board feed `engine_board_data`, which builds the board files of `ENGINE_BOARDS_DIR` with the board builder over `C7Runtime` and serializes them with `BoardJson.of`, so D8's blocks have their second renderer; D2 for boards is held by c7-core's recorded answers, `C7_BOARD_ENGINE`, from which the board feed and the C7 adapter build one board, and by the board cases of both engine suites; earlier that day, executed for building blocks, D8: the shared package exists, `@miragon/pulse-blocks` in `packages/core/blocks`, created from the webview's board cards, which the webview renders with its table, short id and canvas as slots, `blocks-are-building-blocks` and `blocks-consumers`; decided: the engine connector imports engine-core before it serves a second dialect, its server layers `src/lib/engine`, `src/lib/core-adapter` and `src/data` by the main entry, `engine-connector-contract-by-its-main-entry`; `runtimeOf` runs c7-core's `C7Runtime` as the connector's runtime, its failures read by `runtimeErrorOf`); 2026-11-15 (executed for boards, D8: the board file format moved into the published package `@miragon/pulse-board` with its dependency rules, and the board builder followed into its `./builder` entry, whose model the runtime view renders, D2 for boards); 2026-11-14 (executed: the switch of D9 landed, the webview renders with React 19 on `@miragon/pulse-ui`; every precondition of D7 is in place; its follow-up landed too: the webview and its tests follow `react-hooks`' `recommended-latest`, the React Compiler rules included, every rule of it an error; decided: "with incident" reads one way on every C7 surface, an open incident the runtime holds now, so the board's two readings are one); 2026-11-12, later the same day (decided, D9: the webview moves from Preact to React 19 on `@miragon/pulse-ui` in one switch, without a `preact/compat` bridge; one compact look for every surface, on density roles over the guide's `--cd-shell-*` tokens and pulse-ui's colour roles on the guide's `--cd-ui-*` roles, numbers neutral; replaces D4 and turns D7 into the switch's preconditions); 2026-11-12 (decided: the surfaces share a core up to building blocks, not everything: formats, the engine reads and their rules, the numbers and view models of a feature more than one surface shows, and building blocks on React's API; a feature more than one surface shows, boards first, shows the same numbers on every surface; replaces the two UI families of 2026-11-08)

## Context

Pulse shows an engine on three surfaces. The MCP server's widgets are React on `@miragon/pulse-ui`
and widget-shell, cards in an AI chat with a height budget, hand-offs to the chat and a view bundle
every view resource inlines. This extension's webview, which Pulse for Orca shows too, was Preact
with its own components and stylesheets until the switch of D9 (2026-11-14), tabs in the editor next to the models and the code. The
web app of #573 (`apps/web`, since 2026-11-17) is React on pulse-ui and widget-shell and renders the
cockpit through widget-shell's `mountPage`, until the steps of D10 give it a frame and screens of its
own.

On 2026-11-08 the product owner decided for two UI families: the webview and the MCP widgets share
pulse-ui's framework-free foundation and never a component (E1), the words align and the numbers
stay per tool (E2), and the foundation is pulse-ui's (E4). The basis was an inventory of both UIs
(2026-11-07: six of the cockpit's eleven views with a counterpart here, about 3,000 lines of
presentation written twice, 25 % of the fields and 14 % of the actions in those pairs the same), a
`preact/compat` spike that rendered pulse-ui in the webview at 198,006 B gzip against its ceiling
of 200,000 B, the finding that the MCP view bundle had no room for a shared UI, and the finding
that no feature had been built on both sides.

A review on 2026-11-12 checked those facts and found:

- The inventory's numbers and the spike's 198,006 B exist only as prose: no script, branch or
  report reproduces them.
- #595 lowered the MCP view bundle's JS ceiling to the bundle plus 1 % (326,800 to 310,450 B gzip).
  The 10 % rule did not force that step.
- "No feature was built on both sides" was outdated when the record merged: four pair features
  were built on both sides in 2026 Q4 (the running count per element on the diagram, the element of
  each incident, the link from an instance to its process, a count on each instance chip), which
  `docs/vscode/parity.md` logs.
- Measured package sizes (gzip): React 19.3.1 with `react-dom/client` 65,917 B, Preact 11.1.1 with
  its hooks 5,705 B, `preact/compat` 7,050 B.
- A design review of four target architectures (2026-11-12) found that the same numbers on two
  surfaces need a shared builder and shared reads, not shared components alone.
- Boards ([boards.md](boards.md)) were planned for the MCP server and the web apps; the MCP server
  shows them since 2026-11-16, its web app since 2026-11-17. The VS Code
  board read "with incident" two ways until 2026-11-14: its counter counted the history with
  `incidentStatus=open` (then the C7 adapter's instance search, now
  `packages/connectors/c7/c7-core/src/runtime/instance-search.ts`), its
  incident summary and its engine strip scanned the runtime incidents (then the C7 adapter's
  definition reader, now `packages/connectors/c7/c7-core/src/runtime/definition-reader.ts`). Both
  read the runtime now, c7-core's rule (`packages/connectors/c7/c7-core/src/with-incident.ts`).

Later the same day two studies looked at the look of the surfaces and at the webview's runtime:

- A spec of one look for every surface (four studies: the webview's patterns, pulse-ui's scale, the
  Miragon guide, the effects on the MCP widgets and the web apps; a designer; two judges, one for
  use and accessibility, one for the brand) found the webview's compact sizes on the guide's own
  shell ladder (`--cd-shell-zeile` 40 px, `--cd-shell-eintrag` 36, `--cd-shell-ziel` 32,
  `--cd-shell-rand` 12), which pulse-ui vendors and does not use; pulse-ui's neutral roles on
  lifts of its own where the webview reads the guide's `--cd-ui-*` roles (dark muted text about
  5:1 against 8.8:1); and counts the webview draws red or orange, against invariant 6.
- A plan to move the webview onto pulse-ui (four readers, a planner, two judges for feasibility
  and for use and accessibility) found 64 of the webview's 97 source files (5,873 lines) to
  rewrite on the kit, 26 framework-free files that stay, 7 files a plain hook port, and no part of
  widget-shell that fits a renderer of pushed view models (its query hooks, toasts and MCP host).
  Measured (gzip): the webview ships 127,837 B, Preact with its hooks about 5.7 KB of it; React
  with the part of the kit the webview maps onto and 33 Lucide icons 105,478 to 109,472 B; Orca
  builds readable, and without `NODE_ENV=production` React's development build ships (273 KB
  instead of 180 KB). Expected after the move: 210 to 235 KB.

On 2026-11-19, after the UI and UX review of the cockpit (#635, which also made the web app's address
follow the cockpit's navigation), three drafts of a web app in the editors' style were judged by two
juries, one for the architecture and one for the experience:

- "Frame first" (a frame of its own, then one screen after another, each pull request shippable
  alone) won the architecture jury, "blocks first" (screens composed of shared blocks, a frame with
  one bar) the experience jury; "operations first" brought the web app's own router, an incident's
  address under its instance, a search across engines and "Copy link". The plan takes frame first
  with those parts and every correction both juries made mandatory.
- The cockpit counts every open incident, copies included. Camunda 7 copies an incident of a called
  instance to each call activity above it, so a failure N calls deep counts N + 1 times there, once
  here: this extension counts root incidents, as the contract's reads give them. A screen two
  surfaces show cannot count both ways.
- The webview has more room than the drafts assumed: its ceiling of 247,500 B is its measurement
  plus about 5 %, so the limit of 250,000 B leaves about 14 kB, not 2.5 kB (on 2026-11-20 the
  owner raised that limit to 500,000 B, D9's point 7). The web page keeps the
  cockpit embedded until every section it shows is replaced (the cockpit's route switch is total),
  so it grows before it shrinks.

## Decision

The product owner decided on 2026-11-12. D1 replaces E1, D2 amends E2, D3 keeps E4. Later the same
day the owner decided D9, which replaces D4 and turns D7 into the switch's preconditions. On
2026-11-19 the owner decided D10 and amended D2 (and with it E2's words), D8 and D9; D1 stays, so
each surface keeps its screens and the web app's are its own. On 2026-11-24 the owner added D10's
point 10: the screens' JSON forms as data for any page.

- **D1, one core up to building blocks.** The surfaces (this extension and Pulse for Orca, which
  show one webview; the MCP server's widgets; the web app of #573) share a core up to building
  blocks, not everything. It has four layers:
  1. Formats, the board file first.
  2. The engine reads and their rules: the Camunda 7 rules live in `@miragon/pulse-c7-core`, which
     the MCP server and the C7 adapter already run over their `EnginePort`.
  3. The numbers and view models of a feature more than one surface shows, built once and
     framework-free over the read models of `@miragon/pulse-engine-core`.
  4. Building blocks: components on React that take props and callbacks only, with no host context
     inside (no `useToolQuery`, `ConfirmDialog`, `HandOffButton` or `HostBridge`), which every
     surface renders in React: the MCP widgets and the web app, and the webview from the switch of
     D9 on (D1 first had the webview render them through `preact/compat`).

  Each surface keeps its own screens and its host wiring (hand-offs to the chat, live updates and
  the push protocol, native confirmations, sign-in) and may build parts of its own. Where two
  surfaces show the same thing, a shared building block is the default; no surface is forced to
  replace a screen of its own.

- **D2, one builder over one read (amends E2).** A feature more than one surface shows, boards
  first, shows the same numbers on every surface: one builder over one read. Elsewhere E2's numbers
  per tool stayed until a view moved onto shared numbers: this extension counts instances and root
  incidents, over every version in the engine overview and the Engines tree and per version in a
  process panel, the MCP widgets counted every open incident over every version until they moved
  onto root incidents on 2026-11-21 (the amendment below). The words stay aligned (`COUNT_TERMS`):
  "Incidents" are the open incidents of the thing shown (its root incidents since the amendment),
  "With incident" the instances that have one, and a count's header names its version scope. Boards hold it since
  2026-11-16 on both surfaces: c7-core's recorded answers (`C7_BOARD_ENGINE`) give one board, which
  the MCP server's board feed and the C7 adapter build exactly, each over its own wire
  (`packages/connectors/engine/engine-connector/src/data/board-data.numbers.test.ts`,
  `packages/connectors/c7/c7-adapter/test/c7-board-numbers.test.ts`), the cockpit renders in
  English and German, and the board cases of both engine suites read on a live engine. Camunda 8
  holds it since 2026-11-17 the same way: c8-core's recorded answers (`C8_BOARD_ENGINE`) give one
  board, which the C8 adapter and the server's board feed over its Camunda 8 wire build exactly,
  and the board cases of both Camunda 8 engine suites read on a live cluster, locally only until
  #531.

  Amended on 2026-11-19, with E2's words. "Incidents" are the open root incidents of the thing
  shown, on every surface, the chat and the web app's embedded operations views included (the owner
  chose this reach over leaving the chat out). A copy Camunda 7 raises at a call activity never
  counts; a diagram shows it apart and quiet, as an incident in called instances, never part of the
  incident count. An instance counts the root incidents of its tree, its own and those of the
  instances it called, as this extension counts them, so an instance that waits on a failed called
  instance shows that instance's incident with where it lies; a copy is never a number and never a
  row. "With incident" keeps the reading of 2026-11-14, an open incident the runtime
  holds now, so a caller that waits on a failed called instance counts, and "With incident 9" may
  stand beside "Incidents 2"; a legend and the glossary say why, in English and German.
  1. **Read whole.** Per process from the statistics with `rootIncidents=true`, summed over its
     versions, an exact statistic. Per element from the element statistics, whose incidents are
     root incidents wherever no copy can lie, and from every incident at a version's call
     activities, where copies lie (since 2026-11-21; before, from every incident of one version), an
     exception to "never from a scan" recorded here, since the read is whole and never a capped
     page. In the contract a count of open root incidents
     per process and version enters by the admission rule, with a law and a saboteur; Camunda 8
     answers it from its cluster's incidents, which it never copies. Executed on 2026-11-21:
     `incidents` of `DefinitionSummary` and `VersionSummary` (`incidentsAtLeast` where a Camunda 8
     search stops counting), which the web app's engine screen and this extension's engine tab show
     as their column Incidents beside With incident, a legend of the counts beside the search.
  2. **The verdict follows** (`engineVerdict`: `engine_status`, `pulse status`, the cockpit's health
     route): it counts root incidents, its thresholds unchanged (`ENGINE_HEALTH_*`, the CLI's 50 and
     25), and the docs say what a threshold counts. Executed on 2026-11-22: c7-core's
     `rootIncidentCounts` gives every caller its input, the open root incidents of the processes
     from the statistics with `rootIncidents=true` and, of the newest open incidents read, those
     outside any process (a batch's or the history cleanup's failed job) and the largest cause over
     root incidents alone, lower bounds where the read stops; `engine_status` and `pulse status`
     name the verdict's basis `rootIncidentsTotal` beside `incidentsTotal`, every open incident.
     The web app shows it, read from the server and never decided in the page: the engine screen's
     bar as its badge and the start page as its column State, Camunda 7 engines alone, over the
     app-only feed `engine_screen_verdict_data`, which takes the engine screen's own statistics
     read (on its floor) and adds the overview's incident scan, so no engine is asked a second
     statistics read; its failure shows apart from the figures, in the engine module's words of a
     failed read, its mark of its own shape per state. An engine with nothing deployed is Empty
     only where its verdict is ok, in the chat as on the page. This extension shows no verdict.
  3. **Step by step.** The shared screens of D10 count root incidents from their first step; the
     chat and the embedded operations views follow in a breaking step right after the web app's
     instance screen, and the verdict in a breaking step of its own. Until each lands, a surface
     keeps the numbers above and `docs/vscode/parity.md` says the difference per row. "New in
     24 h", which Camunda 7 cannot count for root incidents in a window, goes with the chat's step
     (the owner, 2026-11-20): reading its window whole was the other way, and a capped read would
     be the one dishonest number.
  4. **The chat follows (executed on 2026-11-21).** The MCP server's cockpit, in the chat and in
     the operations views the web app embeds, counts open root incidents: the overview, the health
     route, the incidents route and its cards, the cross-engine landscape and the process route per
     process from the statistics with `rootIncidents=true`; per element the process route, where its
     scan cannot hold every incident of a key, and the process flow's "Running" from each version's
     element statistics of the engine contract, the rule the shared process screen reads by
     (c7-core's `ElementStatisticsReader`, never a second one), the incidents of the instances an
     element called a quiet badge apart on the flow and on a board's diagram. A copy is no row of
     a process, an activity or a cause (an activity's page at a call activity lists its root
     incidents alone, by its cursor since #690, and totals them as its group counts them); where an
     instance's incidents list one, it stands
     for its root, which its row opens, names and copies. The last hour's root incidents come from
     the newest open incidents read, where they hold the hour, else they are unknown; a cluster
     beyond its scan counts by `/incident/count` only where its element is no call activity. The
     version counts the cockpit reads whole stand on a floor of 30 s per caller and version, as the
     screens' reads do. The cockpit's facts for
     the model name root incidents (`openRootIncidents`, `rootIncidentCount`). The verdict followed
     in its own step (point 2); a test holds the cockpit's counts to the shared screens'
     over c7-core's recorded screen engine
     (`packages/connectors/engine/engine-connector/src/data/root-incidents.numbers.test.ts`).

- **D3, the foundation stays pulse-ui's (keeps E4).** Two framework-free subpaths,
  `@miragon/pulse-ui/tones` (the tone vocabulary, `SITUATION_TONES`, `countTone`, `severityTone`)
  and `@miragon/pulse-ui/format` (dates and times to the millisecond, relative times, durations,
  counts exact, at least or unknown, `shortId`), and `@miragon/pulse-ui/testing` (the glossary,
  `COUNT_TERMS`, the brand gates) in tests. In addition the webview may import pulse-ui's React kit
  and its stylesheet for shared building blocks, and from the switch of D9 on it builds its screens
  on them. The runtime view's core, ports, model reader and host kit stay framework-free: of
  pulse-ui only `./tones` and `./format`, as before.
- **D4, Preact stays the webview's runtime (replaced by D9).** Until the switch of D9 landed, the
  webview kept Preact as its runtime and for its own screens; the component API of a shared
  building block is React's.
- **D5, the owner decides.** Decisions about shared building blocks are the product owner's and go
  through normal review. No separate consent of a surface's author is required.
- **D6, #586 is answered.** Its first trigger fired: four pair features were built on both sides in
  2026 Q4, and boards are planned for the MCP server and the web. The triggers and the quarterly
  look drop. `docs/vscode/parity.md` keeps listing what still differs between the pairs; its log of
  the features built on both sides may stay as history.
- **D7, the switch's preconditions (since D9).** D7 first listed what had to land before a shared
  building block rendered through `preact/compat`. Since D9 it lists what lands before the switch,
  and all of it landed by the switch: a Tailwind step in the webview's esbuild build with
  Tailwind's preflight on (the vendored diagram styles stay unlayered above it; the entry,
  `packages/core/runtime-view/src/webview/styles/webview.css`, came with the switch);
  `process.env.NODE_ENV` defined as `"production"` in every build that ships, Orca's readable one
  included (a build without `production`, VS Code's watch, smoke and e2e builds and the runtime
  view's dev page while it serves, keeps React's development build for its warnings); one React
  instance, so one `react`, `react-dom`, `lucide-react` and pulse-ui in the bundle, checked on its
  metafile (`apps/vscode/test/architecture/bundle-budget.test.ts`); an accessibility and geometry
  baseline taken under Preact and kept through the switch (tests by role, label and `data-part`,
  a kit piece's part through the harness's map of its `data-slot`, an axe run without findings,
  focus kept through a live update, icon and target sizes measured in Chromium, at a narrow width
  and in a high-contrast theme too: `packages/core/runtime-view/test/webview/geometry.test.tsx`
  and `packages/core/runtime-view/test/architecture/webview-test-hooks.test.ts`); pulse-ui's
  stylesheet following the editor theme (`data-cd-theme`, `data-cd-kontrast="hoch"`,
  `forced-colors`, reduced motion); pulse-ui's density roles, compact by default. These were
  tasks, not a gate on the decision.
- **D8, homes.** The board format and the board builder go into a new published package,
  `@miragon/pulse-board` (`packages/core/board`); executed for boards on 2026-11-15: the format
  moved with its dependency rules (`board-format-is-a-leaf`, `board-consumers`), the builder
  followed into `@miragon/pulse-board/builder`, a model of no text over seven reads of the engine
  contract with the roll-up onto collapsed sub-processes, the package's one edge into a family
  (`board-builder-builds-on-the-engine-contract`, `board-builder-consumers`). Shared building blocks go
  into pulse-ui (primitives) or into a shared package created with the first engine block two
  surfaces render; executed for building blocks on 2026-11-16: `@miragon/pulse-blocks`
  (`packages/core/blocks`, published) was created from the webview's board cards, a board's tiles
  over the board's JSON form, worded in English and German, with no host and no React context of
  their own. The tiles own their columns, cells, words and notes; a surface brings its table, its id
  and its diagram as slots, each in the one row convention of D9's point 8 (`docs/vscode/parity.md`).
  The webview renders them first, and the same day the cockpit of the MCP server followed, its board
  route with widget-shell's `ListTable` and `IdText` and the cockpit's `BpmnDiagram` as the slots
  (`blocks-are-building-blocks`, `blocks-consumers`). Until a block moves
  there the cockpit side keeps its content of props and callbacks in the connector, as the build
  rule of a pair feature says.

  Extended on 2026-11-19 for the screens of D10. Their builders go into a new published package,
  @miragon/pulse-screens under packages/core, MIT, with three entries: a leaf format as its main
  entry (the screens' JSON forms and their codes, the targets a screen opens, the pure rules a
  surface applies in the browser: a process list's filter, the sums across engines, the diagram's
  decorations); a builder (an engine, a process in one version, its instance list, an instance with
  its incident cards, wait rows, path, call links and headline, the search), of no text, over
  engine-core's main entry as an optional peer and the board builder's roll-up onto collapsed
  sub-processes (`@miragon/pulse-board/builder`), so no third copy of the XML tag reader; and a
  testing entry, the screens the conformance kit's fixed world gives. It keeps this extension's
  house rules, as the board package does. The runtime view's core delegates its numbers to it, the
  engine connector's server layers run it behind new app-only feeds over the contract.
  1. **Blocks.** The screens' building blocks go into `@miragon/pulse-blocks`: tables, cards, filter
     bars, the diagram's badge clusters and call buttons, worded in English and German, with the
     slots a surface brings (its table, id, diagram, link, what it remembers) and write slots only
     the webview fills. Executed for the engine screen on 2026-11-20: `ProcessTable` and
     `ListFilterBar` over its JSON form, which the blocks filter in the browser through the
     format's `ProcessFilter` (`useProcessList`) where a surface holds the whole list, and which
     this extension's engine tab renders first with its own table and id, its filter applied by
     its core with the same rule. Their slot set is `ScreenSlots`: the surface's table (the block
     owns the columns, the cells and the words; a column says the width under which a table that
     fits its region drops it), its id, where a target opens and, where the surface has
     addresses, a target's link, which the rows carry. The words of the screens' blocks keep a
     catalog apart from the tiles', so a surface bundles only the words of the blocks it renders;
     the webview's script grew from 243,517 to 244,673 B gzip with them. Executed for the instance on
     2026-11-20: `InstanceFacts`, `HeadlineStrip`, `IncidentCard` (the surface's facts, its way to
     the text and its actions as slots), `IncidentText` (read only when opened, the root cause
     line marked, copy and wrap), `WaitingTable` (a move from a wait a slot), `HistoryTable`,
     `VariablesTable` (read only, an editor a slot), `CalledInstanceMenu` and `MarkerLegend` over
     the instance screen's JSON form, with the slots `InstanceSlots` (the surface's plain table,
     its link per target, which it draws in its own look by what the target is to the instance,
     and its copy). This extension's instance view renders all but the text and the menu, which
     the web app's instance screen takes: the editors open the text as a document through the
     card's slot and pick a called instance natively. Its English words are held to those before
     the switch, a job without retries now with the danger icon and "No retries left", as D9's
     point 4 asks of an alarming count; the webview's script grew from 244,680 to 249,465 B gzip
     with them, mostly the instance's words in both languages, so the next blocks need the
     catalogs injected per language or the owner's word on the limit of point 7, which the owner
     gave on 2026-11-20: 500,000 B, not wasteful. Executed for the process screen and its
     instance list on 2026-11-20: `VersionPicker`, `OlderVersionsNotice`, `InstanceFilterBar` (the
     scopes with their counts and lower bounds, the element's chip, the exact business key, the
     variable chips and the condition dialog, which offers the kinds a dialect refuses, Camunda
     8's dates and greater or less than, disabled with their reason, the owner's decision of
     2026-11-20 that brings the conditions to the web app's process screen as a pair),
     `InstanceTable` (the row convention of D9's point 8; the surface's selection a write slot of
     its own, `InstanceSelectSlot`), `LoadMore`, `BadgeCluster` (root incidents, incidents in
     called instances and running instances apart, each a filter; the badge the surface's, as its
     canvas draws one), `CallButton` and `BadgeLegend`, over the process screen's and the instance
     list's JSON forms, with their rules `InstanceFilters` and `VariableDraft`. This extension's
     definition view renders all of them, its diagram's through its `DecorationLayer`, with its
     own table, id, count badge and canvas, its selection and bulk actions in the table's write
     slot, and the protocol carries the older versions' notice as data
     (`DefinitionView.olderVersions`), additively; its English words are held to those before the
     switch but two: the notice counts the instances with incident on older versions, and the
     variable filter's button counts its conditions instead of calling them "active", a word the
     product keeps for running instances. The webview's script grew from 249,604 to 251,996 B
     gzip, its ceiling to 257,000 B (its measurement plus 2 %).
  2. **D2 per screen**, as for boards: c7-core's and c8-core's recorded answers give one engine, one
     process, one instance list and one instance screen, which the server's feeds and both adapters
     build exactly, the blocks render in English and German, and both engine suites read live,
     Camunda 8 locally only until #531; a test over every form keeps text out of the model.
     Executed for the instance screen's builder on 2026-11-20: `InstanceScreen` reads an instance's
     detail (primary), its version's diagram, the processes it calls and its caller (each an
     enrichment its screen names when its read fails or finds nothing; a surface that does not read
     the caller, as the editors, names nothing), and builds its root incident cards
     (`rootIncident`, the open root incident a card shows and where it lies, kept apart from
     `rootCauseLine`, the line `RootCauses` names in its stack trace or error message), its wait
     rows, path, call links, head strip as a code and its markers. This extension's instance view
     takes them and words them in English, its protocol and fixtures unchanged. Both recordings hold
     the engine screen and the instance screens of DSP-3001 and of the instance it called, each
     recording one run of its own on a seeded engine (an instance screen reads more than a board,
     and answers joined from two runs would name two engines' ids), which both adapters build
     exactly, the server's feed with the web app's instance screen; the figures
     `ScreenFigures.instance` compares leave out a path's open runs, since Camunda 7 enters an
     element it waits before only once the wait is over.
     Executed for the process screen's and the instance list's builder the same day:
     `ProcessScreen` reads a process's versions (primary), its selected version's diagram, element
     statistics and, only where the diagram has a call activity or could not be read, the
     processes it calls (each an enrichment its screen names when its read fails); `InstanceList`
     reads a page of 50 by cursor (primary) and, on the first page only, the three scopes' counts,
     a lower bound kept as `atLeast`. This extension's definition view and instance list take them
     and word them in English, their protocol and fixtures unchanged; the protocol's copy of the
     condition's type rule is held to the format's `VariableConditionTypes`. Both recordings hold
     the process screens of pulse-order at its latest version and at its version 1 and of
     pulse-dispatch and the list of pulse-order's version 1 beside the engine and instance screens,
     each recording one run anew on a seeded engine (Operaton 2.1.5 at history level full,
     camunda/camunda:8.10.9 on H2), which both adapters and the server's two wires build exactly;
     the server's feeds give them exactly since the web app's process screen
     (`process-screen-data.numbers.test.ts` in the engine connector).
  3. **Mutation tests.** The builder joins them, since it decides the numbers of two surfaces, the
     board package's criterion.
  4. **Release.** Its first npm publish is by hand, with its trusted publisher, before the release
     that first carries it, or that release names a version npm lacks.

- **D9, the webview moves to React on pulse-ui; one compact look for every surface** (later on
  2026-11-12; replaces D4, turns D7 into the switch's preconditions; executed 2026-11-14).
  1. **One switch.** The webview, which both editor hosts show, moves from Preact to React 19 on
     `@miragon/pulse-ui` in one commit of the pull request that records D9, with no
     `preact/compat` bridge: Preact, its Lucide glyph copy and the webview's own stylesheets go,
     except the overlay part of `diagram.css`, which stays unlayered so that its high-contrast and
     `forced-colors` rules keep winning; `react`, `react-dom` and `lucide-react` at the
     repository's one pin come, in one instance. The
     webview stays a renderer of the view models the core pushes, so widget-shell stays outside
     the editor hosts' world. The commits before the switch land in pulse-ui and the cockpit and
     prepare the webview under Preact, each green on its own.
  2. **Compact for every surface.** pulse-ui's look follows today's webview, on density roles in
     `rem` in pulse-ui's `theme.css` that a test holds to the guide's shell tokens at a 16 px root:
     a 40 px bar, 36 px toolbars and menu entries, 28 px controls and table rows, 24 px small
     buttons, a 12 px gutter. Compact is the default of every surface (the MCP widgets, the web
     apps, the webview); a comfortable step (36 px controls, 40 px rows and toolbars, a 48 px bar)
     applies under `any-pointer: coarse` and `[data-density=comfortable]`. Density never scales
     type: only inputs take 16 px text, on a coarse pointer, so that iOS does not zoom into a
     focused field, and `[data-density=comfortable]` alone leaves them at 13 px.
     `[data-density=compact]` pins the compact step on a coarse pointer too, so the editors stay
     compact on a touch laptop as VS Code itself does: the webview sets it on its `<html>` with
     the switch. The pin reaches the fields too: their text is a role of its own
     (`--field-text`), which stays 13 px under `[data-density=compact]`.
     Controls and bars take a minimum height, never a fixed one, so text at 200 % does not clip.
     A view's bar (`ViewBar`) keeps one line while its parts fit: its title gives way first, cut
     with an ellipsis, keeping a 20rem subject (about 10rem of title beside its state) before the
     facts move and 6ch alone on a line, and a toolbar button's label hides under 36rem; a group that
     still has no room (the facts with their ids and links, the actions, the host's meta) moves
     onto a further line instead of being cut or hidden (WCAG 1.4.10), two lines under 30rem. So
     the webview's bar row takes the bar's height from the switch on, 40 px at least instead of a
     fixed row, and its screens keep the bar to one line at editor widths with toolbar buttons,
     where the webview hides the key and the times under 900 px today.
     Dense text is 13 px. The view title is chrome, 13 px at weight 600 in the 40 px bar; 28 px at
     weight 700 stays for the app level (landing, fleet). pulse-ui gets no entry for the editors
     alone.
  3. **The guide's colour roles.** pulse-ui's neutral roles map onto the guide's `--cd-ui-*` roles,
     which the webview reads today: background and muted on grund, card on flaeche, popover on
     flaeche-hoch, accent on hover, border on linie, muted-foreground on text-leise, scrim on
     backdrop; the new roles `--raised`, `--interaction` and `--<tone>-surface` join them. The
     `color-mix` lifts of the chat widgets' dark theme go, which is breaking for starters and
     brands. pulse-ui follows the editor theme on `data-cd-theme`, high contrast on
     `data-cd-kontrast="hoch"` and `forced-colors`. VS Code sets the contrast already
     (modeler-shell's appearance wiring). Orca's theme event reports only light or dark
     (`apps/orca/types/orca/index.d.ts`), so in Orca high contrast reaches the webview through
     `forced-colors` alone: its bridge sets no `data-cd-kontrast`.
  4. **Numbers stay neutral** (invariant 6) on every surface: an alarming count gets a tone icon
     of its own shape and its meaning as screen-reader text, never a coloured number, a tinted
     tile or a dot alone (`CountFigure`, `CountBadge` as a pill; owner's delegate, 2026-11-13).
     The webview's red and orange counts turn neutral.
  5. **Building blocks in pulse-ui's root.** What the webview draws and the cockpit can use moves
     into pulse-ui's root, and the cockpit uses it: `ViewBar` (back, title, facts, actions,
     access, freshness), `StatusStrip`, `Facts`, `StateLabel` (a tone icon and text, no pill),
     `CountBadge`, `CountFigure`, segments with counts (the cockpit's instance scope and a form's
     yes or no too, owner's delegate, 2026-11-13), `SearchField`, the condition chip, an id with
     its copy button, `LoadingState`, `DataTable` (a sticky head, column sizing, row focus) and form
     primitives (checkbox, textarea, label and field, progress). Only the split pane and the
     widths it and the tables store stay the editor's. The variable condition dialog becomes a
     native `<dialog>` on the kit's roles; the diagram's overlays stay the webview's own.
  6. **Named deviations from the guide**, listed in the design section of the root `CLAUDE.md`:
     28 px controls (buttons, inputs, selects) and clickable 28 px rows, radius sm on labelled
     buttons, 24 px small buttons (in notice strips, to copy, and a table row's actions, so every
     row stays 28 px as in the webview; owner's delegate, 2026-11-13), weight 400 on toolbar
     labels, pill count badges, the docked strip without the 4 px edge; 12 px icons at stroke 2.5
     in a listed set of pulse-ui's files; the diagram's count badges stay solid 20 px pills; the
     labels bpmn-js draws on the canvas are bpmn-js's own Arial at its sizes on both surfaces, the
     cockpit and the webview, where the guide asks for Geist on SVG text (the owner, 2026-11-14):
     Pulse mostly shows diagrams drawn in Camunda Modeler or bpmn.io, whose label boxes are sized
     for Arial, and Geist, up to 8 % wider, wrapped labels that fit there. Both hand bpmn-js
     pulse-ui's `BPMN_LABEL_STYLE`; the chrome, tooltips, popups, count badges and overlays stay
     in Geist.
  7. **Budgets and release notes.** Each growth of a shrink-only ceiling the move needs (the
     webview's, the MCP view bundle's, the char budgets) updates the ceiling with a
     `Ratchet-Exception:` trailer that says what it buys; no checker is weakened. The webview's
     ceiling goes to its measured size plus about 5 %, at most 250,000 B gzip (amended below on
     2026-11-20: plus about 2 %, at most 500,000 B); the MCP view
     bundle's JS may grow by about 10 % over 310,450 B. pulse-ui's new look and neutrals are a
     `feat(ui)!` with a `BREAKING CHANGE:` footer; the new look of Pulse for VS Code and Pulse for
     Orca is a `feat` with a clear note. Amended on 2026-11-19 for the web app's page, which keeps
     the cockpit embedded until D10's screens replace its sections and so grows before it shrinks:
     its gzip ceilings may grow to at most 340,000 B for its script and 18,000 B for its stylesheet,
     each ceiling its measurement plus 2 %, behind a `Ratchet-Exception:` trailer on each commit
     that grows one. The webview stayed at most 250,000 B: its ceiling of 247,500 B was its
     measurement plus about 5 %, so the measurement sat about 14 kB below the limit, not the
     2.5 kB the drafts assumed. Amended on 2026-11-20, when a process's blocks first needed more
     (the owner: "nur nicht verschwenderisch", not wasteful): the webview's script may grow to
     at most 500,000 B gzip, each ceiling its measurement plus 2 % behind a `Ratchet-Exception:`
     trailer that says what the growth buys, and what the webview bundles stays lean. Amended on
     2026-11-21, when the page's script reached its ceiling with the search across engines (the
     owner: "wir machen ja schließlich auch mehr", we do more after all): the page's script may
     grow to at most 400,000 B gzip and its stylesheet to at most 20,000 B, each ceiling still its
     measurement plus 2 % behind a `Ratchet-Exception:` trailer on each commit that grows one.
  8. **One row convention** (the owner, 2026-11-18). On every surface, the MCP widgets, the web
     app and the webview, a table row opens what it names on a click or Enter and copies its id
     with Ctrl or Cmd+C, as the webview's rows did from the start; the cockpit's rows lose their
     drill. Text selected in a row copies as selected; a copy that is no id (a board's incident
     row copies its message) says so in the row's hint and its toast. A row's further actions (a write, a hand-off, the menu) stay at its end and open
     nothing. The kit holds it once: `DataTable`'s row target for drawn rows (`onActivate`,
     `rowLabel`) and `DataTableRow` for rows composed by hand, which widget-shell's `ListRow`
     wraps with the copy's toast. A target row is named by what it opens, tells a screen reader
     that Enter opens it, shows its focus inside its box and takes the table's one tab stop, the
     arrows moving between the rows that open. A board's tiles follow through their table slot,
     a drill stays for what is no table row (a card's way into its view).
- **D10, the web app's own frame and screens: variant B, "frame first"** (2026-11-19). The web app
  moves from the cockpit under `mountPage` (2026-11-17) to a frame and screens of its own, one step
  at a time, each pull request shippable alone: first the router with an address per view, then the
  frame, then per screen its builder (the extension moves onto it, its tests proving that nothing
  changes), its blocks (the webview renders them first) and the web app's screen.
  1. **A frame of its own.** A side navigation (the engines grouped by environment, the current one
     open with the sections its dialect has in the web app, the boards, a search, who is signed in
     and the sign-out; a drawer under 64rem), a router of its own and one address per view. Each
     view has one bar, its `ViewBar`, and no app bar sits above it. The navigation carries no
     counts, so every number has one place and a page costs no read per engine.
  2. **Screens of its own, in the editors' style:** an engine, a process in one version, an instance
     with the focus on one of its incidents, a search across engines and a start page over all
     engines. The web app composes each from the building blocks of D8 (D1's grain: tables, cards,
     filter bars and the diagram's decorations, never a whole screen) and brings its states by
     invariant 6. The numbers come from the screens' builders behind new read-only app-only feeds of
     the MCP server, which read the engine contract in every dialect. A screen of the page is never
     a second view, and new engine UI of the chat stays a cockpit route. Executed for the engine on
     2026-11-20: at the engine's own address the page shows its processes with the blocks this
     extension's engine tab renders, over the feed `engine_screen_processes_data`, which the server
     and both adapters build exactly from the recorded engines of c7-core and c8-core; the page
     claims the place of the cockpit's overview (widget-shell's `ViewLocation.claims`), and an
     engine shown on boards only or a refused profile keeps the cockpit's one state there.
     Executed for the instance on 2026-11-20, the same day: at an instance's own address, and with
     one of its root incidents in focus at the address of that incident under it, the page shows
     the instance with the blocks this extension's instance view renders, over the feed
     `engine_screen_instance_data`, which the server builds exactly as both adapters do from the
     recorded engines, beside it each card's text read in place through
     `engine_screen_incident_text_data`; its diagram on the canvas that follows the theme, its tabs
     in this extension's order, the split between them movable by mouse and keyboard; the page
     claims the cockpit's instance view, its history and an incident, leads an incident known by its
     id alone to the instance that holds its root, and fills none of the blocks' write slots. A
     screen of the page fills the window's height from 64rem on, which the frame, widget-shell's
     `WidgetShell` and `ListTable` and pulse-ui's `NavigationFocus` learnt to do for a page alone.
     Executed for the process on 2026-11-20, the same day: at a process's own address the page
     shows it in one version with the blocks this extension's definition view renders (the version
     picker, the notice of older versions, the instance list's filter bar with the variable
     condition dialog, the instance table and Load more, the badges and call buttons on its
     diagram and their legend), over the feeds `engine_screen_process_data`,
     `engine_screen_instances_data` and `engine_screen_variable_names_data`, which the server builds
     exactly as both adapters do from the recorded engines; the version and the list's filter in
     the address (point 6), its badges on the canvas that follows the theme, a count's click
     filtering the list, Escape clearing it; from 64rem on the split movable by mouse and keyboard,
     under it the diagram at 240 to 560 px above three rows; the page claims the cockpit's process
     view and its list of a process's instances, and fills none of the blocks' write slots.
     Executed for the search on 2026-11-21: at `/app/search?q=…`, which the navigation's field opens,
     the page asks every engine apart and at once for the instance with the text as its id and up
     to 20 with it as their exact business key, running and ended (the screens' `Finder` behind the
     feed `engine_screen_find_data`, which the server builds exactly as both adapters do from the
     recorded engines), and lists the hits with the blocks' `FindResults`; an engine it could not
     search is a row of a strip beside the hits of the others, a refused profile read nothing of;
     an engine whose history misses running instances says so (`FindHistoryNotice`; at history
     level NONE the search finds none); it never calls missing what an engine it could not search
     or that has not answered may hold; exactly one hit, with every engine searched and none
     missing history, takes the search's entry once, so Back leads to where it started. The
     extension has no search, so its bundle leaves the blocks out. Executed for the start page on
     2026-11-21, last that day: at `/app`, in the place of the cockpit's landing and of its
     cross-engine overview (whose address, `/app/fleet`, gives way to `/app` for the transition of
     point 6), every engine side by side, each row the figures its engine screen shows (its product,
     processes, running instances, instances with incident and open root incidents: one read per
     engine of `engine_screen_processes_data`, all at once, summed in the browser with the screens'
     `FleetSums`, counts only, never a rate), Camunda 8's clusters among them, then what runs where
     and the server's boards, through two blocks of `@miragon/pulse-blocks` a second surface could
     render (`EngineTable`, `ProcessesByEngine`); an engine it could not read keeps its row and says
     why, a refused profile in the server's words; a server of one engine and no board shows that
     engine there. The cockpit's words only the web app's landing and cross-engine view used for a
     Camunda 8 engine went, so the chat's bundle shrank; the extension bundles neither block.
  3. **The operations views stay the cockpit's.** Its incidents, a cause, its jobs and the boards run
     unchanged inside the frame, without their head. Once a screen replaces a section, the page
     takes every drill into it, from the embedded routes and a board's tiles too.
  4. **The chat keeps its cockpit**, in behaviour, not in every line: `engine_open_cockpit` keeps its
     input, its views and its structured content, every feed its payload, test:host its scenarios.
     The cockpit learns two things only a page uses (to leave its head to a page with chrome of its
     own, and to leave a place the page shows itself), and each pull request that touches it names
     its delta of `mcp-app.js`. The chat changes only where the owner decided it: root incidents
     (D2) and the diagram's theme (point 7).
  5. **Camunda 8.** The screens serve every dialect: the web app shows a Camunda 8 engine whole once
     its screens open to Camunda 8, its operations views stay Camunda 7's, and the chat's cockpit
     keeps showing a Camunda 8 engine on boards only (`BoardsOnlyEngineGate`). Executed on 2026-11-21: the page's
     navigation opens a Camunda 8 engine's processes (its engine, process and instance screens, an
     incident at its instance) and no incidents or jobs; where the page shows its place itself the
     cockpit names the place whole, so a board's tiles and chip and the landing's row open the
     page's screens, an incident the instance that holds it; a cluster below 8.9 or without
     secondary storage is said with its fix. A chat claims no place: its gate, landing rows and
     tiles stay as they were, and only the kit's words changed there too (a Camunda 8 token
     endpoint's refusal reads as a refused login); a page's words of a failure are its host's alone
     (`PAGE_HINTS`), so the chat's bundle did not grow.
  6. **The web's conventions.** An address is public and stable from the first release that carries
     it. A new subject (an engine, a process, a version, an instance, an incident) adds a history
     entry; a filter, a scope, an element, a business key or a tab replaces it, so Back goes from
     subject to subject. Every entry is a link, so Ctrl or Cmd+click and a middle click open a new
     tab. A version is its number in the address, an incident's address hangs under the instance
     that holds it. The split's share and the column widths stay in the browser, and no single key
     is a shortcut (WCAG 2.1.4). Today's addresses (`/app/cockpit?view=…`, `/app/fleet`) stay
     readable one minor version beyond the step that makes the start page replace the landing and
     the fleet.
  7. **The diagram follows the theme**, in the web app and in the chat's widgets, as the webview's
     canvas does in the editors (dark, high contrast), instead of light paper in every theme. The
     labels stay bpmn-js's Arial (D9's point 6), and the badges and markers keep their contrast on
     the paper the theme gives. It revises the deviation for embedded chat widgets in the root
     `CLAUDE.md` that the BPMN paper and its zoom bar stay light, which changes with the step that
     implements it: one change of widget-shell's canvas to the theme for the chat's widgets and the
     web app alike, before the web app's instance screen. The zoom bar keeps its place top right,
     where bpmn.io's link takes the bottom right.
  8. **Versions, pages and freshness of the shared screens.** A process screen shows one version,
     with a picker and a notice about older versions still running; the engine screen's rows span
     every version and say so. The root `CLAUDE.md`'s rule that a process view spans every version
     of its key keeps holding for the cockpit. A list pages by a cursor with "Load more" and counts
     its scopes with "≥" where an engine stops counting; the chat keeps offset pages with an honest
     total. In the web app each bar has Refresh and the time its data are from, a query older than
     60 s reads again when the window has focus again, and nothing polls. Where history level NONE
     leaves a list without what the history holds, the screen says so, with no fallback; variable
     conditions come with the process screen, a pair feature with this extension.
  9. **No writes in the web app.** They stay out of this plan: a block carries a write control only
     as a slot, which the web app leaves empty and the webview fills. Writing in a browser is a
     decision of its own, since the forward admits reads alone and a write would need the page's
     view host to write, a confirmation, an identity per user and an audit.
  10. **The screens' JSON for any page** (added 2026-11-24, #666). A page outside the web app (a
      Claude artifact) reads a screen's or a board's JSON form through read-only model tools of
      the engine module, `engine_get_screen` (the engine, process and instance screens) and
      `engine_get_board`, data only and never a view, each with the form's version
      (`ScreenFormat.JSON_VERSION` of `@miragon/pulse-screens`, `BoardVocabulary.JSON_VERSION` of
      `@miragon/pulse-board`) so a page refuses a form it does not know, built by the builders and
      on the floors of the feeds the web app reads, in every dialect as they are. The screens as UI
      stay as above: the web app's pages read the app-only feeds, and new engine UI of the chat is
      a cockpit route.

The small form questions settled on 2026-11-08 stay for both tools: no green "healthy" (running
info, suspended and ended neutral, an engine whose verdict is ok too), 12 px icons beside dense
text and on the diagram's overlays as a named deviation (D9 names them for pulse-ui's listed files
too), one duration form (`3m 7s`, `1d 3h`), short ids of numbers by their tail, `≥ 2,000` exact
and `10k+` compact (`1.5M` for a million), English with a 24-hour clock here, one em dash for a
missing value ([user-interface.md](user-interface.md)).

## Consequences

- The runtime view's closed world follows D3, changed with this record. The ports, the core, the
  model reader and the host kit stay framework-free: the core imports `./tones` and, in its label
  helper (`core/views/labels.ts`), `./format`; the ports, the model reader and the host kit import
  nothing of pulse-ui; `pulse-ui-only-its-foundation` keeps pulse-ui's React kit, its stylesheets
  and `./testing` out of them. The webview answers to `webview-pulse-ui-by-its-entries`: it imports
  `./tones`, `./format` from its `format/` folder and, for shared building blocks, pulse-ui's root
  (the React kit) and `@miragon/pulse-ui/theme.css`; never `./testing`, `globals.css` (an app
  entry without a Tailwind entry of its own; the webview has its own, `src/webview/styles/webview.css`) or
  `fonts.css`, never another subpath. No layer reaches a file of pulse-ui by path, and the
  repository's `ui-foundation-entries-import-nothing` keeps `./tones` and `./format` free of React,
  Radix and every other import ([guardrails.md](guardrails.md) lists the gates: the word scan, the
  tone table, the brand gates, the date and number gates, the token drift test). Since the switch
  the webview's rendering libraries are `react`, `react-dom` and `lucide-react` instead of
  `preact`; Radix reaches it only through pulse-ui, widget-shell never.
- The preconditions of D7 have a home each: the Tailwind step and the `NODE_ENV` define in the
  webview's esbuild options, which both hosts build with
  (`packages/core/runtime-view/scripts/webview-build-options.mjs`: the step,
  `packages/core/runtime-view/scripts/tailwind-entries.mjs`, compiles the one entry the options
  name, and the licence lists read what it inlines through `inlinedStylesheets` of
  `scripts/third-party-licenses.mjs`); the single-instance check beside the bundle ceilings of the
  script and the stylesheet (`apps/vscode/test/architecture/bundle-budget.test.ts`,
  `apps/vscode/test/__golden__/bundle-budget.json`); the baseline in the webview's tests
  (`packages/core/runtime-view/test/webview`); the editor theme and the density roles in pulse-ui's
  stylesheet (`packages/core/ui/src/theme.css`).
- With the switch, too: `prettier-plugin-tailwindcss` sorts the webview's classes; the webview's
  second vendored copy of the Miragon token stylesheet, `cd-tokens.generated.css`, went (its
  manifest entry, checksums and drift test followed); `cd-tokens.generated.json`, which the
  renderer's paint test reads, `cd-canvas.css` and the overlay part of `diagram.css` stay for the
  diagram; the licence lists of the .vsix and of the Orca plugin were written again and
  `docs/vscode/parity.md` followed. The screenshots of `apps/vscode/docs/screenshots` are shot
  again after the switch, with the product images.
- After the switch, in a commit of its own, the webview and its tests took `react-hooks`'
  `recommended-latest`, the React Compiler rules included, as the plugin version the workspace
  pins defines them, every rule of it an error, its three warnings included; the rest of the
  editor trees renders nothing with React and keeps the set off. Its findings were fixed the way the rules intend, without a suppression: the diagram and
  the live hold read the latest props through `useEffectEvent` instead of a ref written during
  render, a write's phase is derived while rendering and closes through an effect event, the bulk
  strip's live region gets its text from an effect (the region is on the page, empty, before it
  speaks), the split pane's hook owns its refs, the focus a closed panel returns to is written
  by the hook that holds it, and the migration's diagram decorations take the rows as their
  dependency (the decoration layer skips equal decorations).
- Per surface stays: the webview's host wiring (the push protocol and live updates, English, the
  native confirmation), its diagram runtime and overlays, the split pane and the widths it stores;
  the MCP widgets' hand-offs to the chat, their height budget, the host contexts and
  `ConfirmDialog`; each surface's sign-in. A shared building block takes these in as props and
  callbacks.
- Until the switch landed, a pair feature was built on each side, each with its own tests; on
  the MCP side its content takes props and callbacks without host context and stays in the
  connector (D8). Since the switch both sides compose pulse-ui's blocks.
- The look changes on every surface: starters and customer modules see compact controls, 13 px
  dense text and the guide's neutrals; an inline card shows more rows in the same height budget;
  users of Pulse for VS Code and Pulse for Orca see the webview on pulse-ui. Under an MCP host's
  theme the host's colour sets background, card and popover alike (`HOST_TOKEN_MAP` stays), so
  1 px lines part the regions there.
- Boards move first. Before they move onto one builder over one read, the board's two readings of
  "with incident" (the counter's history count and the incident summary's runtime scan) settle to
  one: the owner chose the runtime's on 2026-11-14 (an open incident now, on every history level,
  on every C7 surface). Two owner decisions fell due then too: the board package's home, settled
  on 2026-11-15 under `packages/core` with an exception like the runtime view's (its builder alone
  reads engine-core, `board-builder-builds-on-the-engine-contract`), and whether the engine
  connector may import engine-core before it serves a second dialect, settled on 2026-11-16 with
  boards in the MCP server: its server layers `src/lib/engine`, `src/lib/core-adapter` and
  `src/data` import its main entry (`engine-connector-contract-by-its-main-entry`), and
  `runtimeOf` runs c7-core's `C7Runtime` over the connector's port.
- Outside boards and the views that move onto shared numbers, users of both tools still see
  different numbers for the same process, under the same words, where the version scope differs:
  since 2026-11-21 "Incidents" counts open root incidents on every surface (the verdict since
  2026-11-22), while the version scope stays per tool (D10's point 8), where each header names
  it.
- D10 and the amendments of 2026-11-19 change the texts that say what the code does with the steps
  that change the code, not with this record: the root `CLAUDE.md` (the surfaces, the package
  table, invariants 1, 3, 5, 6 and 7, the count words, the BPMN paper of the embedded widgets, the
  releases and mutation sections), `apps/web/CLAUDE.md`, `docs/web` and `docs/mcp`.
  `docs/vscode/parity.md` marks each row this record decided with the step that lands it.
- Open after 2026-11-21: whether an inbox of root incidents across engines replaces the embedded
  incidents and cause views, now that the numbers agree (the owner decides it after the chat's
  step). "New in 24 h" was decided on 2026-11-20: it went with the chat's step.

## Decision log

2026-11-07: an inventory of both UIs, three designs (one UI, content building blocks, the
foundation only) and a review that corrected them. 2026-11-08: the product owner chose the
foundation only, with the words aligned and the numbers left per tool (E1, E2, E4); built in five
steps: the words, the tones, the formatters, the gates over the webview, and this record with the
parity list. That record planned a review of its pull request by a second author of the webview;
the owner dropped that requirement on 2026-11-12. 2026-11-12: a review of the 2026-11-08 record's
facts and a design review of four target architectures; the product owner decided D1 to D8: a core
shared up to building blocks, the same numbers for a feature more than one surface shows, building
blocks on React's API that the webview renders through `preact/compat`, and #586 answered. Later on
2026-11-12: a spec of one compact look for every surface and a plan to move the webview onto
pulse-ui, each judged twice; the product owner decided D9: the webview moves to React 19 on
pulse-ui in one switch without `preact/compat`, compact is every surface's default, pulse-ui's
colour roles map onto the guide's `--cd-ui-*` roles, numbers stay neutral, the webview's building
blocks move into pulse-ui's root, and the deviations from the guide are named. D9 replaces D4, and
D7 lists the switch's preconditions. 2026-11-14: the switch landed in one commit; a part a kit
piece plays is found through the test harness's map of its `data-slot`, so pulse-ui carries no
webview-only hook, the webview's stylesheet has a ceiling of its own beside its script's, and the
screenshots are shot again with the product images after the switch (the owner's delegate); in a
commit after the switch, the webview and its tests took `react-hooks`' `recommended-latest` with
the React Compiler rules, every rule of it an error, every finding fixed and none suppressed. Later
on 2026-11-14 the owner chose bpmn-js's Arial for the labels on the canvas of both surfaces, a
deviation D9 names, since the label boxes of diagrams drawn in the modelers are sized for it.
2026-11-16: with boards in the MCP server the owner admitted engine-core's main entry to the engine
connector's server layers (the case #488 names), and the connector runs `C7Runtime` as its
runtime. The same day `@miragon/pulse-blocks` was created from the webview's board cards and the
cockpit's board route became their second renderer, and c7-core's recorded answers hold both wires
to one board. 2026-11-17: the MCP server shows Camunda 8 clusters on boards, and c8-core's recorded
answers (`C8_BOARD_ENGINE`) hold the C8 adapter's wire and the server's to one board the same way.
2026-11-19: three drafts of a web app in the editors' style, judged for architecture and for
experience, and a plan from the winner, frame first; the product owner decided D10 as planned, with
no writes in the web app, root incidents on every surface with the chat (D2, E2), the verdict on root
incidents with the same thresholds, "with incident" as on 2026-11-14, the diagram following the
theme in the web app and in the chat, the screens' builders in a published package of their own with
mutation tests (D8), the web page's budget (D9's point 7), today's addresses one minor version
beyond the start page, a hint at history level NONE and variable conditions with the process screen
as a pair feature. 2026-11-20: the owner answered the plan's open questions: variable conditions with the process
screen as a pair, "new in 24 h" goes with the chat's step, the verdict counts root incidents with the
same thresholds in a step of its own, an inbox across engines is decided after the chat's step, and
the webview's script may grow to 500,000 B gzip. 2026-11-21: the chat and the operations views the
web app embeds count open root incidents (D2's point 4), "new in 24 h" gone. Later that day, after a
measurement on the playground, c7-core's element statistics read the incidents of a version's call
activities alone (D2's point 1), with the same counts. Later that day the web app read a Camunda 8
engine whole (D10's point 5), and then it searched for an instance across engines (D10's point 2).
Last that day the contract counted the open root incidents of a process and a version (D2's point
1), which the engine screen and the engine tab show as their column Incidents, and the web app's
start page replaced the cockpit's landing and its cross-engine overview there (D10's point 2).
2026-11-22: the verdict counts open root incidents with the same thresholds (D2's point 2, the
owner's answer of 2026-11-20), a breaking change of `engine_status`, `pulse status` and the chat's
health; the web app shows a Camunda 7 engine's verdict on its engine screen and start page.
