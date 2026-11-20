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
  of a view (`src/pages.ts`): `/app` (the cockpit's landing, `view: "landing"`: the engines and the
  server's boards, with one engine and no board that engine), `/app/fleet` (the cross-engine
  overview: the landing's start, then the cockpit opens it, no view of the tool), `/app/boards/<id>`
  (a board, the tool refusing an id the server shows no board for), an engine's views under
  `/app/engines/<engine>`: its processes at the engine's own address, the page's own engine screen
  (below; `?scope=incident&q=…`: its list's filter; an engine shown on boards only or a refused
  profile shows its one state there instead,
  the cockpit's, started on the landing, which every server's tool takes, and an engine the server
  does not configure the page's refused start: `src/unknown-engine.tsx` says it in the view's place
  where the landing's start data does not name the engine, the engine connector's
  `cockpitNamesEngine`, so the cockpit never falls back from it and the address stays),
  `processes/<key>` (`?scope=incident`: its incidents in
  focus), `instances` (`?process=<key>`), `instances/<id>` (`?tab=history`: its history),
  `instances/<id>/incidents/<id>` (an incident under its instance, opened by its id), `incidents`,
  `incidents/cause` (`?activity=…&type=…&signature=…`) and `jobs` (`?process=<key>&failed=true`),
  and the server's own `/app/signed-out?reason=…`. Ids are path segments (`encodeURIComponent`), the
  query carries a view's state alone, its defaults left out. The addresses are public and stay
  stable from the first release that ships them: a change keeps the old address readable and
  replaces it by the new one in its entry for the transition period (owner decision of 2026-11-19).
  A place no address names whole keeps the cockpit's query under `/app/cockpit` (one argument of
  `engine_open_cockpit` per parameter, so the tool refuses one it does not take and the page shows
  why): an id that can be no segment (empty, `.`, `..`) for good, and an incident, which the cockpit
  names without its instance, until the instance screen finds it. `/app/cockpit?view=…`, every
  view's address before, still opens its view and is replaced by the view's own address in its entry
  before the session is read; that old use and `/app/fleet` stay readable until one minor version
  after the start page replaces the cross-engine overview (owner decision of 2026-11-19), and
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
  a screen (a filter, a tab; the router's `refine`) leaves it where it is. Every page has one main
  landmark and one `h1` (a view's, the view frame's failure in its place, a state page's reason),
  which titles the document, `<h1> · Pulse` in the page's language, and the title follows it as
  the user moves on inside the page (`src/frame/layout.tsx`, WCAG 2.4.2); before a view shows its
  heading the route's title stands (a board's page names the board's id from the URL, its title
  arriving with the view's heading; any other Pulse). The build writes `src/pages.ts` into
  `dist/pages.json`, which the server reads at boot, and `test/pages-manifest.test.ts` boots a
  server over the build to hold both to each other.
  A page with a session starts with a skip link to the content's heading, seen only while it has
  focus, which writes no fragment into the address: the tab order is the skip link, the
  navigation, the content.
- The frame of a page with a session (`src/frame`) is the editors' look, one bar per view and no
  app bar above it: a side navigation (`src/frame/navigation.tsx`, pulse-ui's `SideNav` in a
  `nav` landmark named Pulse, 15rem beside the view from 64rem on) with the start page, the view
  across engines where the cockpit offers it (two engines or more it reads whole), the engines by
  environment (where the server names environments) with the open one's sections, the boards, and
  at its foot who is signed in and the sign-out. The sections an engine opens are its dialect's on
  the web (`src/frame/nav-sections.ts`: Camunda 7's processes, the page's engine screen at the
  engine's own address where the cockpit's head had its overview, then its incidents and jobs; none
  of Camunda 8's, which says it shows on boards only; `test/nav-sections.test.tsx` holds the table
  to the routes `engine_open_cockpit` offers each dialect alone, to the engine screen's feed the
  server registers for it and to the sections the cockpit's head shows an engine of each dialect,
  rendered); a refused profile shows the landing's warning mark
  and says refused, and opens its one state. Either one's state stands under a bar of its own on
  the page, the engine's name its h1 and the cockpit's Refresh its action. An engine's entry opens
  its processes, its address the same wherever the page is: the chat's engine switch, which keeps
  the open section and a process the other engine deploys (N7), is the head's, which the page
  hides. Every entry is a real `<a href>` of the router (`src/router/page-link.tsx`), the current
  place `aria-current="page"` with the 2 px edge in `--interaction`. The navigation carries no counts: it
  reads the engine list once (`engine_list_engines` under the cockpit's own cache key, so the page
  and its cockpit share one read per page view) and no engine. Under 64rem a drawer holds it
  (`src/frame/drawer.tsx`, pulse-ui's `Dialog` from the left: its scrim, its focus trap, Escape)
  behind a menu button, the first element of every view bar (the page's chrome, `PageView`'s
  `chrome`, which makes the cockpit leave its head to the frame: the sections, the engine switch
  and the view across engines are the navigation's, the Refresh the view bar's) and of the page's
  own row where a view shows no bar (its frame's states, a refused start); an entry closes it and
  the focus goes to the new view's heading, never back to the menu, and a sign-out from it that
  did not go through closes it with the focus back on the menu, so its notice shows. The view takes the width
  beside the navigation on a sheet 16 px off its edges (edge to edge under 40rem), as high as the
  window; the session's notice stands once above the view's bar.
- The page's own screens (`src/screens`, owner decision D10 of 2026-11-19), its first the engine
  screen (`src/screens/engine`): at an engine's own address an engine's processes, each with its
  latest version, its running instances and its instances with incident over every version, the
  blocks the editors' engine tab renders (`ListFilterBar`, `ProcessTable` and `useProcessList` of
  `@miragon/pulse-blocks`, worded by their own catalog) over the engine screen's feed
  (`engine_screen_processes_data`, an app-only read of the engine contract in every dialect, the
  numbers the editors' adapters build of the same answers), with the page's slots
  (`src/screens/slots.tsx`: widget-shell's `ListTable` with a `ListRow` per row, which links to
  what it opens, `NamedId`, the router's address of a target). The scopes and the search derive
  the rows in the browser and read nothing, and ride in the address (`?scope=incident&q=…`, the
  defaults left out): each pick names the entry anew through the router's `refine`, which keeps the
  screen and the focus where they are, and Back, Forward and a reload show the list as it was left
  (a move between two entries of the screen keeps it, with the entry's filter). A row opens its
  process (the cockpit's process view, a new entry), Ctrl or Cmd with a click or Enter and a
  middle click open it in a new tab, Ctrl or Cmd with C copies its BPMN process ID. Its bar names
  the engine (its h1) and its product (an em dash where the engine did not say it), the page's menu
  first, the Refresh and the engine's own web app where the profile or the provider knows its
  address, and when the numbers were read; a
  read older than 60 s runs again when the reader comes back to the page, its window focused or its
  tab shown again (`src/screens/read-on-return.ts`, since TanStack's own refetch on focus follows
  the tab alone), once for both, never for a refusal no retry changes, and nothing polls. It shows
  no verdict and writes nothing. Its states are its own: a first load's skeleton after 400 ms, a
  failure in the kit's words (`describeError`) with Try again unless no retry changes it
  (`isPermanentError`: a refused profile, an engine whose dialect the server does not read), a
  failed refresh over the numbers on screen a strip under the bar.
  `src/screens/engine/engine-route.tsx` decides on the frame's one read of the engine list: the
  screen for an engine of a dialect that has it on the web (Camunda 7's), else the cockpit's view
  the page starts there, which shows an engine shown on boards only or a refused profile its one
  state, as before the screen. A screen is never a view of the `ViewMap`: the router names it
  beside the route (`PageRoute`'s `screen`, `screenOf`) and claims its place for the page
  (`ViewLocation.claims`), so the cockpit, wherever it is embedded on the page, reports a move to
  an engine's overview and renders nothing there, and the page shows the screen; Back or Forward
  to it from another place starts the screen anew, never the cockpit. The page names the place by
  its navigation's word (`ViewLocation.nameOf`), so a cockpit's trail back to it says Processes,
  never Overview.
- `src/start.ts` starts a page: the signed-out page needs no session; any other names its view
  canonically, reads the session (`readWebSession`) and mounts the page's app with widget-shell's
  `mountApp` (`src/app.tsx`: the frame around the view, which `PageView` shows at the router's
  start), its caller `webToolCaller` (every call a POST to `/app/api/call` with the session's CSRF
  token; no token ever reaches the page), its frame the app's own (`src/frame/session-frame.tsx`,
  above). A page without a session (the signed-out page, a session that ended before its first
  read or could not be read) shows the product's name in a 40 px bar above its sheet
  (`src/frame/layout.tsx`). A page writes to no engine and posts to no chat (`followUp: "none"`),
  so no write control and no hand-off show. A start that failed
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
  footer alert, and an engine's row on the landing keeps what it last read (`isSessionEnded`).
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
  screen reads a screen feed of the engine module (`SCREEN_FEEDS`), never a write.
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
