# CLAUDE.md (apps/web)

Guidance for agents working on Pulse's web app (`@miragon/pulse-web`, private): the page a Pulse
server serves under `/app`, which shows the MCP server's views to a browser signed in through the
server's OAuth provider. It is an interface app of the Pulse monorepo; the root `CLAUDE.md` holds
(the package rules of invariant 8, the design section, invariant 6 for everything the page renders,
the ratchets, Verification), and this file adds what is the web app's own.

## Commands

Run them from the repository root.

```sh
pnpm --fail-if-no-match --filter @miragon/pulse-web build                 # the page into apps/web/dist
pnpm --fail-if-no-match --filter @miragon/pulse-web test                  # unit tests, build tests, coverage floors
pnpm --fail-if-no-match --filter @miragon/pulse-web third-party-licenses  # write THIRD_PARTY_LICENSES.txt again
pnpm --fail-if-no-match --filter @miragon/pulse-mcp-server test:web       # the built page on the real server, in Chromium
```

The page imports widget-shell, pulse-ui and the engine connector's widgets: after `pnpm install`,
build them once (`pnpm exec turbo run build --filter=@miragon/pulse-web^...`, or `pnpm build`).
`test:web` (`apps/mcp-server/test-host/web`, its scenarios in `apps/mcp-server/test-host/README.md`)
signs in through a fake identity provider and runs the page on the server's `createApp`; the
server image builds the page beside the server and serves it from `/app/web`.

## What it is

- One page, `index.html`, for every route of the server that serves it, each the canonical address
  of a view (`src/pages.ts`): `/app` (the page's start page below, every engine side by side and the
  server's boards, at the place of the cockpit's landing, `view: "landing"`, which it claims; with
  one engine and no board that engine), `/app/search?q=…` (the page's search
  across engines below, `q` what it searches, trimmed; a place of the page's alone, no view of the
  cockpit's, `src/router/search-address.ts`), `/app/fleet` (the cross-engine overview's old address,
  which the start page replaced: it reads as `/app` and gives way to it in its entry, and the page
  claims the overview's place `view: "fleet"` too), `/app/boards/<id>`
  (a board, the tool refusing an id the server shows no board for), an engine's views under
  `/app/engines/<engine>`: its processes at the engine's own address, the page's own engine screen
  (below; `?scope=incident&q=…`: its list's filter; a Camunda 8 engine's too; a refused profile
  shows its one state there instead,
  the cockpit's, started on the landing, which every server's tool takes, and an engine the server
  does not configure the page's refused start: `src/unknown-engine.tsx` says it in the view's place
  where the landing's start data does not name the engine, the engine connector's
  `cockpitNamesEngine`, so the cockpit never falls back from it and the address stays),
  `processes/<key>` (the page's process screen below;
  `?version=<n>&scope=incident|ended|all&element=<id>&key=<key>&var=<name~operator~value>`: the
  version, the instance list's scope, element, exact business key and variable conditions (a date
  as its instant with its offset),
  `scope=incident` the old address of its incidents in focus too), `instances` (the engine's
  instances; `?process=<key>`, the old address of a process's instances, gives way to the process's
  own), `instances/<id>` (the page's instance screen below;
  `?tab=history|incidents|waiting|variables`: its tab, `?tab=history` the cockpit's history),
  `instances/<id>/incidents/<id>` (the instance screen with that root incident in focus), `incidents`,
  `incidents/cause` (`?activity=…&type=…&signature=…`) and `jobs` (`?process=<key>&failed=true`),
  and the server's own `/app/signed-out?reason=…`. Ids are path segments (`encodeURIComponent`), the
  query carries a view's state alone, its defaults left out. The addresses are public and stay
  stable from the first release that ships them: a change keeps the old address readable and
  replaces it by the new one in its entry for the transition period (owner decision of 2026-11-19).
  A place no address names whole keeps the cockpit's query under `/app/cockpit` (one argument of
  `engine_open_cockpit` per parameter, so the tool refuses one it does not take and the page shows
  why): an id that can be no segment (empty, `.`, `..`) for good, and an incident the cockpit names
  without its instance, which the page then leads on to the instance that holds its root, the entry
  named anew (`src/screens/instance/incident-resolve.tsx`, through `engine_incident_detail_data`,
  Camunda 7's, a copy at a call activity to its root in the instance it called). `/app/cockpit?view=…`, every
  view's address before, still opens its view and is replaced by the view's own address in its entry
  before the session is read; that old use and `/app/fleet` stay readable until one minor version
  after the start page replaced the cross-engine overview on 2026-11-21 (owner decision of
  2026-11-19), and
  `/app/cockpit` leaves `src/pages.ts` only once the places it still names have another address.
  `src/router/routes.ts` reads a route and writes a place's address (`urlOf`); `test/routes.test.ts`
  leads every place of the cockpit's routes through its address and back.
- The page navigates itself (`src/router/router.ts`): the view reports each place it reaches, a
  drill or a section a new entry of the browser's history, its first place and a move inside a view
  the current one, the cockpit's memo of its trail kept in the entry's state, the same place keeping
  the address the reader is on; Back, Forward and a link of the page (`src/router/page-link.tsx`:
  a real `<a href>`, which Ctrl or Cmd, Shift, Alt and the middle button leave to the browser) hand
  the view the entry's place, and an entry it does not go to itself starts the view anew there
  (`PageView` under a new key), never a reload. Each of the page's own moves (a link of its
  navigation, Back, Forward) hands focus to the new view's `h1` (the router's `moves`, pulse-ui's
  `NavigationFocus`), as does a drill the view reports to a place the page claims (its engine
  screen), which the page shows anew; never another move the view reports. A move inside a view or
  a screen (a filter, a tab, a version the process's picker picks; the router's `refine`, in the
  entry or a new one) leaves it where it is. Every page has one main
  landmark and one `h1` (a view's, the view frame's failure in its place, a state page's reason),
  which titles the document, `<h1> · Pulse` in the page's language, and the title follows it as
  the user moves on inside the page (`src/frame/layout.tsx`, WCAG 2.4.2); before a view shows its
  heading the route's title stands (a board's page names the board's id from the URL, its title
  arriving with the view's heading; any other Pulse). The build writes `src/pages.ts` into
  `dist/pages.json`, which the server reads at boot, and `test/pages-manifest.test.ts` boots a
  server over the build to hold both to each other.
  A page with a session starts with a skip link to the content's heading, seen only while it has
  focus, which writes no fragment into the address: the tab order is the skip link, the side
  (its search, then the navigation), the content.
- The frame of a page with a session (`src/frame`) is the editors' look, one bar per view and no
  app bar above it: a side navigation (`src/frame/navigation.tsx`, pulse-ui's `SideNav` in a
  `nav` landmark named Pulse, 15rem beside the view from 64rem on), above it the search for an
  instance across engines (`src/frame/search-form.tsx`: a `search` landmark with one field, its
  hint that the search is exact; Enter goes to the search's address, nothing searches while typing
  and no single key starts it, WCAG 2.1.4; a text longer than the search's feed takes,
  `SEARCH_TEXT_MOST`, which `test/search-limits.test.ts` holds to the feed's schema, is said next to
  the field it marks invalid and searches nothing, never cut; on the search's page it shows what was
  searched), with
  the start page (every engine side by side: no entry for a view across engines beside it), the
  engines by environment (where the server names environments) with the open one's sections, the
  boards, and
  at its foot who is signed in and the sign-out. The sections an engine opens are its dialect's on
  the web (`src/frame/nav-sections.ts`: Camunda 7's processes, the page's engine screen at the
  engine's own address where the cockpit's head had its overview, then its incidents and jobs;
  Camunda 8's processes alone since 2026-11-21, since the page's screens read the engine contract in
  every dialect and the cockpit's routes it embeds the Camunda 7 REST API alone;
  `test/nav-sections.test.tsx` holds the table to the routes `engine_open_cockpit` offers each
  dialect alone, to the screen feeds the server registers for it, both ways, and to the sections the
  cockpit's head shows an engine of each dialect, rendered; a dialect the page knows no screen of
  says it shows on boards only); a refused profile
  shows the warning mark of a refused profile and says refused, and opens its one state, which stands under a
  bar of its own on the page, the engine's name its h1 and the cockpit's Refresh its action. An engine's entry opens
  its processes, its address the same wherever the page is: the chat's engine switch, which keeps
  the open section and a process the other engine deploys (N7), is the head's, which the page
  hides. Every entry is a real `<a href>` of the router (`src/router/page-link.tsx`), the current
  place `aria-current="page"` with the 2 px edge in `--interaction`. The navigation carries no counts: it
  reads the engine list once (`engine_list_engines` under the cockpit's own cache key, so the page
  and its cockpit share one read per page view) and no engine. Under 64rem a drawer holds it
  (`src/frame/drawer.tsx`, pulse-ui's `Dialog` from the left: its scrim, its focus trap, Escape)
  behind a menu button, the first element of every view bar (the page's chrome, `PageView`'s
  `chrome`, which makes the cockpit leave its head to the frame: the sections and the engine switch
  are the navigation's, the way across engines the start page's, the Refresh the view bar's) and of
  the page's
  own row where a view shows no bar (its frame's states, a refused start); an entry closes it and
  the focus goes to the new view's heading, never back to the menu, and a sign-out from it that
  did not go through closes it with the focus back on the menu, so its notice shows. The view takes the width
  beside the navigation on a sheet 16 px off its edges (edge to edge under 40rem), as high as the
  window; the session's notice stands once above the view's bar.
- The page's start page (`src/screens/start`, D10 of 2026-11-19, since 2026-11-21) at `/app`, in
  the place of the cockpit's landing and of its cross-engine overview, which it claims
  (`ViewLocation.claims`: the cockpit, where a drill or its trail leads to either, reports the place
  and renders nothing, and the page shows its start page): every engine of the frame's one read of
  the engine list side by side, a row each from that engine's engine screen
  (`engine_screen_processes_data`, the engine screen's own read under its own cache key, so the
  start page and an engine's screen show one read; one call per engine, all at once, as the search
  reads each engine, each engine's failure its own), summed in the browser with the blocks'
  `useFleetSums` (the screens' `FleetSums`, which a page names by type alone: counts only, never a
  rate): the blocks' `EngineTable` (the engine, its state, its product, its
  processes, running instances, instances with incident and open root incidents, each the figure
  its engine screen shows, the incidents its rows' summed, a lower bound where a cluster stopped
  counting; under 40rem the engine, its state, with incident and incidents), Camunda 8's clusters
  among them. The column State (`withVerdict`) is a Camunda 7 engine's live verdict as the server
  decides it (c7-core's `engineVerdict` over its open root incidents by `ENGINE_HEALTH_*`, the
  chat's overview's), read per Camunda 7 engine through the app-only feed
  `engine_screen_verdict_data` (`src/screens/engine/verdict-feed.ts`: `hasVerdict` names the
  dialects the server decides one for, which `test/nav-sections.test.tsx` holds to the feeds it
  registers per dialect), beside the engine screen's read, which the server reads it beside too,
  so no engine is asked twice: its mark of its own shape in the kit's verdict tone (an ok
  engine's dot, a degraded one's triangle, a critical one's crossed circle, the mark alone under
  28rem of the table) and its word (Stable, Degraded, Critical, Empty for an ok engine with nothing
  deployed, as the chat's overview badge says it), a failed read's icon and word in the
  engine module's words and tones of a failed read (`healthFailureOf`, pulse-ui's
  `READ_FAILURE_TONES`), never the verdict read before it, its figures kept; a Camunda 8 cluster's a
  dash that says Pulse judges no state for it, since the server decides none; a page's ended session
  a quiet dash. The page never decides a verdict;
  what runs where on the engines read where the server has more than one, once every engine settled
  (the blocks' `ProcessesByEngine`: each process's running instances per engine, its instances with
  incident over all of them, the note that engines run different processes so the view shows
  counts, never rates, the engines not read named under it); the server's boards
  (`start-boards.tsx`: a row per board, its title and engines, opening its page; the files that give
  no board with their count of problems). Its bar: All engines as the h1, how many engines the
  server configures and refused, the Refresh (the engine list and every engine again), when the
  numbers were read (the oldest answer). An engine whose read failed keeps its row (not read, a dash
  per figure) and a strip under the bar says why in the kit's words (`src/screens/engine-failure.tsx`,
  which the search's strips take too), from its first failed attempt while the query client retries
  behind it; a refused profile is read nothing of, its row says so and its strip the server's
  refusal in the server's words (`refusalOf` in `src/engine-list.ts`, the engine module's
  `ENGINE_PROFILE_REFUSED` text from the list's reason, which the search says too). A row opens its
  engine's screen (a refused profile's one state), a board row its page, by the one row convention.
  A server of one engine (or one refused profile) and no board shows that engine in its place
  (`onlyEngineOf`, the router's `refine` with `replace`, so the focus stays where the page starts
  and the skip link the first stop), reading nothing itself, as the cockpit's landing did. A read
  older than 60 s runs again when the reader comes back (once for both of a return's events), and
  nothing polls; the frame's list is read again by a screen that mounts only where it went stale,
  never where a read met a refusal no retry changes (`useEngineList`). What runs where says it reads
  while an engine still reads, its skeleton after 400 ms (widget-shell's `QueryFallback`). It writes
  nothing and hands nothing to a chat; the page scrolls (no `fill`).
- The page's own screens (`src/screens`, owner decision D10 of 2026-11-19), its first the engine
  screen (`src/screens/engine`): at an engine's own address an engine's processes, each with its
  latest version, its running instances, its instances with incident and its open root incidents
  over every version (the column Incidents, the contract's `incidents`, a lower bound as one where a
  cluster stopped counting; the legend of the counts beside the search), the blocks the editors'
  engine tab renders (`ListFilterBar`, `ProcessTable` and `useProcessList` of
  `@miragon/pulse-blocks`, worded by their own catalog) over the engine screen's feed
  (`engine_screen_processes_data`, an app-only read of the engine contract in every dialect, the
  numbers the editors' adapters build of the same answers), with the page's slots
  (`src/screens/slots.tsx`: widget-shell's `ListTable` with a `ListRow` per row, which links to
  what it opens, `NamedId`, the router's address of a target). The scopes and the search derive
  the rows in the browser and read nothing, and ride in the address (`?scope=incident&q=…`, the
  defaults left out): each pick names the entry anew through the router's `refine`, which keeps the
  screen and the focus where they are, and Back, Forward and a reload show the list as it was left
  (a move between two entries of the screen keeps it, with the entry's filter). A row opens its
  process (the page's process screen, a new entry), Ctrl or Cmd with a click or Enter and a
  middle click open it in a new tab, Ctrl or Cmd with C copies its BPMN process ID. Its bar names
  the engine (its h1) and its product (an em dash where the engine did not say it), the page's menu
  first, the Refresh and the engine's own web app where the profile or the provider knows its
  address, and when the numbers were read; a
  read older than 60 s runs again when the reader comes back to the page, its window focused or its
  tab shown again (`src/screens/read-on-return.ts`, since TanStack's own refetch on focus follows
  the tab alone), once for both, never for a refusal no retry changes, and nothing polls. Its feed
  stands on the server's floor of 30 s per caller (a Camunda 8 cluster's incident searches among
  its reads), so a Refresh within it shows the same read. A Camunda 7 engine's bar shows its live
  state as the header's badge (the blocks' `EngineVerdictBadge` over the verdict feed, the start
  page's column State in a badge: its read apart once the numbers show, so its failure never hides
  them and a first load that fails says so once, in the screen's state, read again with the
  screen's Refresh and on the reader's return); a Camunda 8 engine's shows none. It
  writes nothing. Its states are its own: a first load's skeleton after 400 ms, a
  failure in the kit's words (`describeError`) with Try again unless no retry changes it
  (`isPermanentError`: a refused profile, an engine whose dialect the server does not read), a
  failed refresh over the numbers on screen a strip under the bar; a Camunda 8 cluster the screen
  cannot read as it is set up (below 8.9, without secondary storage: c8-core's words after the
  contract's `[misconfigured]`) in the page's own words with its fix, on a first load and in a
  refresh's strip alike, the server's under Details (`src/screens/cluster-problem.tsx`,
  `ScreenState`, which the process and instance screens take too, and `RefreshNotice`), and a token
  endpoint's refusal as a refused login, as Camunda 7's (the kit reads the contract's
  `[unauthorized]`). A Camunda 8 engine's screen says under its bar, in one line a laptop's width
  holds, that its incidents and jobs show at their instances and how to get there, since the page
  offers it no incidents and jobs. An instance whose engine cut some of its lists (its
  `truncated`, the strip "Some lists are cut off") counts every tab as a lower bound (`≥ n`), since
  the read names no list it cut, as Pulse for VS Code's tabs do.
  `src/screens/engine/engine-route.tsx` decides on the frame's one read of the engine list: the
  screen for an engine of a dialect that has it on the web (Camunda 7's and Camunda 8's), else the
  cockpit's view the page starts there, which shows a refused profile its one state, as before the
  screen. A screen is never a view of the `ViewMap`: the router names it
  beside the route (`PageRoute`'s `screen`, `screenOf`) and claims its place for the page
  (`ViewLocation.claims`), so the cockpit, wherever it is embedded on the page, reports a move to
  an engine's overview and renders nothing there, and the page shows the screen; Back or Forward
  to it from another place starts the screen anew, never the cockpit. The page names the place by
  its navigation's word (`ViewLocation.nameOf`), so a cockpit's trail back to it says Processes,
  never Overview.
- The instance screen (`src/screens/instance`), at an instance's own address and, with one of its
  root incidents in focus, at the address of that incident under it: the instance from the instance
  screen's feed (`engine_screen_instance_data`, an app-only read of the engine contract in every
  dialect, the instance screen of `@miragon/pulse-screens` the editors' adapters build of the same
  answers, beside it the instance in the engine's web app and on Camunda 7 each card's cause),
  rendered with the instance's blocks of `@miragon/pulse-blocks` the webview renders. Its bar: the
  business key as the h1 (else the short id, the whole id to copy beside it), its state, its facts
  (`InstanceFacts`: the version as a link, the caller, when it started or ended) and the engine, the
  Refresh, the instance in the engine's web app, when it was read. Under it the strips: who called
  it and as what (`src/screens/instance/instance-head.tsx`, an em dash where the caller's read
  failed) with Open caller, where it stands (`HeadlineStrip`), an incident in focus the instance does
  not hold (with a link to the instance), a cut list. Then its diagram (`instance-diagram.tsx`:
  widget-shell's `useBpmnViewer` on the canvas that follows the theme, the screen's markers, the kit's
  for an element that waits and an incident, the page's own for an incident in a called instance and
  an element already done and the focus's glow, `src/styles.css`; each call activity's way to what it
  called, one instance a link, several the blocks' `CalledInstanceMenu`, a version it starts a link;
  a failed read of it read again by the Refresh and on the reader's return) and its details in the
  editors' tabs and order (`instance-details.tsx`: History, Incidents, Waiting, Variables with their
  counts, the markers' legend at the bar's end), the tab in the address (the
  router's `refine`), none there the screen's pick: its incidents where it has some, else where it
  waits while it runs, else its history. From 64rem on the diagram and the details split the window's
  height (`split-pane.tsx`: a `separator` the reader moves by mouse, touch, the arrows, Home and End,
  the share kept in this browser's guarded storage, its one column as wide as the screen, so a stack
  trace opened scrolls in its own box), under it the diagram takes the viewer's height
  above the details and the page scrolls (`src/screens/use-wide.ts`). Its incident cards
  (`incident-cards.tsx`, `IncidentCard` over the root incidents of the tree, its own and those of the
  instances it called) lead to their incident in focus at the address under the instance that holds
  it ("Located in" and Open incident); the card in focus opens its text at once, its element selected
  and in the middle of the diagram (the call activity it lies under where it lies in a called
  instance), and on Camunda 7 leads to every incident with its cause (the cockpit's cause view). A
  card's text (`IncidentText`) is read only when it opens, through `engine_screen_incident_text_data`,
  once, its root cause's line marked by the index the contract gives (`RootCauses.lineOf`), a stack
  trace offered wherever an incident has a job; a text the engine no longer has (the feed's
  `UNKNOWN_INCIDENT`, `isUnknownIncident`) or another refusal no retry changes is said in the card
  without Try again (the blocks' `refused` read), an ended session there only as a quiet line. The
  slots (`instance-slots.tsx`): widget-shell's `ListTable` at the height its tab leaves it with
  plain rows, the router's link, the clipboard with a toast. An instance the engine does not know is
  a refusal no retry changes (the feed's `UNKNOWN_INSTANCE`, `isUnknownInstance`): asked once, said
  in the view's place with the way to the engine's processes, no Try again, not read again on
  return. It writes nothing (every write slot of the blocks empty) and hands nothing to a chat.
  `src/screens/instance/instance-route.tsx` decides on
  the frame's one read of the engine list as the engine screen does (`src/screens/screen-shown.ts`:
  Camunda 7's and Camunda 8's engines, the cockpit's view of any other; an incident known by its id
  alone Camunda 7's only, which the cockpit's incident feed finds, so a Camunda 8 engine's is the
  cockpit's refusal); the page claims the cockpit's instance view,
  its history and an incident (`ViewLocation.claims`), so a drill of the embedded cockpit to one of
  them shows the screen.
- The process screen (`src/screens/process`), at a process's own address: the process in one version
  (the address's `version`, else the latest) from the process screen's feed
  (`engine_screen_process_data`, an app-only read of the engine contract in every dialect, the
  process screen of `@miragon/pulse-screens` the editors' adapters build of the same answers, beside
  it the version in the engine's web app), rendered with a process's blocks of
  `@miragon/pulse-blocks` the webview's definition view renders (D10, a pair with Pulse for VS Code
  since 2026-11-20). Its bar: the process's name as the h1, the engine its fact, its actions in the
  webview's order, the version picker with each version's running instances and those with incident
  (`VersionPicker`) first, the Refresh, the version in the engine's web app, then when it was read.
  Under it the strips: a version the address names that the engine lacks (the latest shown), older
  versions that still run with the way to the newest of them (`OlderVersionsNotice`), a history that
  misses running instances (`MissingHistoryNotice` over the screens' `HistoryGaps`: the version's
  running instances, which the runtime counts, against the list's count over every lifecycle, which
  the history answers, read in that order: the list's first page is sent only once the versions
  answered, and its counts count only where read no earlier than the versions (`asOf`), never a
  floor's answer of an earlier read; the owner's decision of 2026-11-19, no fallback to the
  runtime), and what it could not read beside its versions (the counts on its diagram, the processes
  it calls; never a 0). Its diagram (`process-diagram.tsx`: widget-shell's `useBpmnViewer` on the
  canvas that follows the theme) draws the blocks' decorations (`useDiagramDecorations`): each
  element's counts apart, its root incidents, the incidents in the instances it called (quiet, never
  part of the incident count) and its running instances (`BadgeCluster` with the page's badge,
  `canvas-badge.tsx` over the canvas's `bpmn-overlay-badge`), the outline of an element with a root
  incident, each call activity's link to the version it calls (`CallButton` with its address, worded
  by `useCallLabel`: a plain click in place, Ctrl or Cmd, Shift, Alt and the middle button the
  browser's; a process the engine lacks a button that opens nothing), and the element the list is
  filtered to ringed; a count's click filters the list to its element and scope, Escape clears the
  element (not from a field, nor with a dialog open), and a ring, a count or a call target changes
  in place (each overlay reads its data at each render), so the reader's zoom stays. Its instance
  list (`instance-list.tsx`, `instance-pages.ts`): the blocks' `InstanceFilterBar` (the scopes with
  their counts, a lower bound where the engine stopped counting, the element's chip, the exact
  business key, the variable conditions with their dialog, the kinds the engine refuses offered
  disabled with their reason, the variable names read through `engine_screen_variable_names_data`
  once the dialog opens, a date the dialog writes as this browser's wall clock sent as its instant;
  the badges' legend at its end) and `InstanceTable` over `engine_screen_instances_data` (under
  40rem its id and state, the business key and the start dropped, so its region never scrolls
  sideways on a phone), pages of
  50 by cursor with `LoadMore` under the rows (`InstanceTable`'s `more`: it waits `aria-disabled`
  and keeps the focus, which goes on to the first new row once the page shows; a further page that
  failed said beside it, its Try again putting the focus back on Load more, an ended session left to
  the frame's notice), each later page after the rows shown without a row shown already
  (`useInstanceRows`), the scopes' counts from the first page, which a Refresh, a filter or the
  reader's return reads anew, after the versions, and so starts the list over; a failed read of it
  over the rows on screen is the strip under the bar; a row opens its instance. A condition the
  engine refuses (the feed's `REFUSED_CONDITION`) is said in the list's place with the way to clear
  the conditions, no Try again. The version, the scope, the element, the key and the conditions ride
  in the address (a date as the instant it names, read on this browser's clock, so a shared link
  lists the same instances in another time zone): another version is a new entry, the variable
  conditions kept as in the editors, the screen kept (the router's same subject), a pick in the
  picker leaving the focus there (`refine` with `push`, WCAG 3.2.2) and the notice's way moving it
  to the h1, the bar keeping the version before while the next one reads; a filter names the entry
  anew (the router's `refine`). From 64rem on the diagram and the list split the window's height
  (`split-pane.tsx`, its share in this browser's guarded storage per screen), under it the diagram
  takes 240 to 560 px with three rows of the list under it in the window, beside the strips under
  the bar as measured (`--process-strips`), and the page scrolls. A process the engine has no
  version of (the feed's `UNKNOWN_PROCESS`) is asked once and said in the view's place with the way
  to the engine's processes, no Try again. It writes nothing, selects nothing (every write slot of
  the blocks empty) and hands nothing to a chat. The page claims the cockpit's process view and its
  list of a process's instances (`ViewLocation.claims`), so a drill of the embedded cockpit to one
  shows the screen. The process screen's feeds stand on the server's floor of 30 s per caller and
  arguments (the list's first page, never a later one), so a Refresh within it shows the same read.
- The search across engines (`src/screens/search`), at `/app/search?q=…`: the instance with the
  text as its id and those with it as their exact business key, running and ended, up to 20 per
  engine, from the search's feed (`engine_screen_find_data`, an app-only read of the engine contract
  in every dialect, the screens' `Finder`), one call per engine of the frame's one read of the
  engine list, all at once, as the start page reads each engine, so each engine's failure is its
  own; a refused profile is read nothing of, its refusal the list's reason in the server's words
  (`search-reads.ts`, `refusalOf`). Its bar: what was searched as the h1 (none: "Find an instance" and how to
  search, nothing read), once every engine settled how many instances were found on how many
  engines and that the search is exact, the Refresh (every engine again), when the hits were read
  (the oldest answer). Under it a strip per engine that could not be searched, refused or failing,
  in the kit's words with its hint (`src/screens/engine-failure.tsx`, a Camunda 8 cluster's problem with its
  fix, an ended session left to the frame's notice), and the blocks' `FindHistoryNotice` of an
  engine whose history misses running instances (Camunda 7 at history level NONE, where the search
  finds none), beside the hits of the others: the blocks' `FindResults` with the page's slots, a
  row opening its instance screen by the one row convention, shown as they arrive, under the rows
  the engines that hold more instances with the business key than they list. While no hit is on
  screen it says it searches until every engine settled, so it never calls missing what a slower
  engine may hold; an empty table says what was searched and that the search is exact, of the
  engines that could be searched alone where one was refused or failed (`FindResults`' `partial`);
  a search no engine answered says no engine could be searched (a page's ended session only the
  quiet line), never that no instance exists. A text longer than `SEARCH_TEXT_MOST` reads nothing
  and says so. Exactly one hit on every engine that could be searched (a refused profile counts as
  searched; an engine that failed for a reason a retry may change keeps the search, and so does one
  whose history misses running instances, whose notice stays to be read) replaces the address by
  its instance's (the router's `navigate` with `replace`), so Back leads to where the search
  started; it is decided once per entry, when every engine first settled, and the router marks the
  entry (`seen`, `markSeen`, in the entry's state), so neither a Refresh nor a return to the entry
  (Back, Forward, a reload) leaves it. Another search is a new entry and starts the screen anew. It
  writes nothing and hands nothing to a chat.
- A screen of the page's fills the window's height from 64rem on (`SessionLayout`'s `fill`, which
  bounds the sheet; widget-shell's `WidgetShell` and `ListTable` `fill`; pulse-ui's
  `NavigationFocus` `className`): the engine screen's list and the process and instance screens'
  splits scroll in their own regions; under 64rem, and for every view of the cockpit, the page
  scrolls.
- `src/start.ts` starts a page: the signed-out page needs no session; any other names its view
  canonically, reads the session (`readWebSession`) and mounts the page's app with widget-shell's
  `mountApp` (`src/app.tsx`: the frame around the view, which `PageView` shows at the router's
  start), its caller `webToolCaller` (every call a POST to `/app/api/call` with the session's CSRF
  token; no token ever reaches the page), its frame the app's own (`src/frame/session-frame.tsx`,
  above). A page without a session (the signed-out page, a session that ended before its first
  read or could not be read) shows the product's name in a 40 px bar above its sheet
  (`src/frame/layout.tsx`). A page writes to no engine and posts to no chat (`followUp: "none"`),
  so no write control and no hand-off show, and the kit's words of a failure are a page's
  (`BrowserViewHost` brings widget-shell's `PAGE_HINTS`, which the chat's bundle never carries; the
  screens take them through `useErrorWords`). A start that failed
  for its engine (an unreachable one, say) keeps the cockpit on that engine over the route that
  says so, and the navigation keeps the engine open with its sections: `PageView`'s `failedStart`
  takes the engine connector's `cockpitAfterFailedStart`, and a refusal no retry changes stays the
  frame's.
- No silent redirect: a call that finds the session gone shows a notice whose sign-in comes back
  to the page; a page whose session ended before it read one, or whose session could not be read,
  says so (`src/page-states.tsx`), neither handing `mountApp` a caller. The sign-out is a fetch to
  the logout route, then the place its answer names (`src/sign-out.ts`, never a script URL). The
  signed-out page says per reason what happened and what to do (`src/signed-out.tsx`). The notice
  is the one place that says the session ended: a view's read that meets it is a refusal no retry
  changes (widget-shell's `isPermanentError`), asked once, with no Try again and no "Updating…";
  a view's state shows a quiet line that its content is missing, a list keeps its rows with no
  footer alert, and an engine's row on the start page says it read nothing, a quiet row without a
  tone (the blocks' `EngineTable` state `unread`), no strip beside it (`isSessionEnded`).
- `src/router/routes.ts`'s `COCKPIT_FLAGS` copies the cockpit tool's boolean arguments, which
  `test/cockpit-flags.test.ts` holds to the tool's input schema as the engine module registers it.
- Geist comes from the server's own font route (`publicBase`), the theme follows the OS or a
  `data-cd-theme` on `<html>`, the language the browser (German or English), the density is
  compact, comfortable on touch: all of it the view runtime's, which the frame shares.

## Rules

- What `src` imports is `web-is-a-page` in `.dependency-cruiser.cjs`: its own modules, `react`,
  `react-dom`, `lucide-react`, pulse-ui's root and `theme.css`, `@miragon/pulse-widget-shell/widgets`,
  `@miragon/pulse-engine-connector/widgets`, `@miragon/pulse-blocks` and `@miragon/pulse-screens`,
  the screens by type alone (`web-names-screens-by-type`: a rule of a screen comes through the block
  that applies it). Never a server half, the transport, the MCP Apps runtime (ESLint's gate too), a
  screen's builder, the engine contract or a `./testing` entry; tests and `vite.config.ts` may
  import more.
- Every tool the page names is a read its server's forward admits a page's call to:
  `test/page-reads.test.ts` holds each tool name in `src` to a view tool, an app-only feed or a
  `forViews` tool of the admin golden of the tools/list payload, each with `readOnlyHint`. A new
  screen reads a screen feed of the engine module (`SCREEN_FEEDS`), never a write; a screen's
  diagram reads `engine_bpmn_xml_data`, and an incident the page knows by its id alone is found
  through the cockpit's `engine_incident_detail_data`, both reads of every view.
- The page's words live in `src/messages` (`en.ts`, `de.ts`, the same keys, brand tone in both;
  `test/messages.test.ts`), its UI on the kit with the brand gates of `@miragon/pulse-ui/testing`
  (`test/brand-gates.test.ts`), dates and numbers through the kit's formatters (the date and number
  gates hold `src`).
- Only files under the build's `assets/` are served: anything the page loads is imported, so Vite
  emits it there under a hashed name; nothing is inlined (`assetsInlineLimit: 0`), no script runs
  inline (the server's Content Security Policy allows the page's own scripts only), and `public/`
  stays empty.
- `vite.config.ts` spreads widget-shell's `VIEW_BUNDLE_DEDUPE` whole (invariant 4);
  `test/bundle-graph.test.ts` holds the page to one copy of each, to the app root and its page view
  without the chat's root, to the screens' blocks and format without a screen's builder or the
  engine contract, and to no MCP Apps runtime, no server half of widget-shell and no transport.
- The page's gzip ceilings are `test/__golden__/bundle-budget.json` (`test/bundle-budget.test.ts`,
  shrink-only; growth needs a `Ratchet-Exception:` trailer), its licence list
  `THIRD_PARTY_LICENSES.txt` (`test/third-party-licenses.test.ts`, written by the
  `third-party-licenses` script), its coverage floors `vitest.config.ts`.
