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

- One page, `index.html`, for every route of the server that serves it: `/app` (the cockpit's
  landing, `view: "landing"`: the engines and the server's boards, with one engine and no board
  that engine), `/app/boards/<id>` (a board, `view: "board"`, the tool refusing an id the server
  shows no board for), `/app/cockpit?view=…&engine=…&<ids>` (the start the query names, one
  argument of `engine_open_cockpit` per parameter, so the tool refuses one it does not take and
  the page shows why) and the server's own `/app/signed-out?reason=…`. `src/routes.ts` reads the
  route. Every page has one main landmark and one `h1` (a view's, the view frame's failure in its
  place, a state page's reason), which titles the document, `<h1> · Pulse` in the page's language,
  and the title follows it as the user moves on inside the page (`src/bar.tsx`, WCAG 2.4.2);
  before a view shows its heading the route's title stands (a board's page names the board's id
  from the URL, its title arriving with the view's heading; any other Pulse). The product's name
  in the bar of a page with a session leads to `/app`, the start page the words of a refused start
  name and its state links to (`mountPage`'s `startPage`). `src/pages.ts` lists the page routes;
  the build writes them into `dist/pages.json`, which the server reads at boot, and
  `test/pages-manifest.test.ts` boots a server over the build to hold both to each other. Navigation inside the cockpit stays in the
  page: a URL names where it starts.
- `src/start.ts` starts a page: the signed-out page needs no session; any other reads the session
  (`readWebSession`) and mounts the view with widget-shell's `mountPage`, its caller
  `webToolCaller` (every call a POST to `/app/api/call` with the session's CSRF token; no token
  ever reaches the page), its `frame` the app's own (`src/frame.tsx`: the 40 px bar with the
  product, who is signed in and the sign-out, and the session's notices under it). A page writes
  to no engine and posts to no chat (`followUp: "none"`), so no write control and no hand-off show.
- No silent redirect: a call that finds the session gone shows a notice whose sign-in comes back
  to the page; a page whose session ended before it read one, or whose session could not be read,
  says so (`src/page-states.tsx`), neither handing `mountPage` a caller. The sign-out is a fetch to
  the logout route, then the place its answer names (`src/sign-out.ts`, never a script URL). The
  signed-out page says per reason what happened and what to do (`src/signed-out.tsx`). The notice
  is the one place that says the session ended: a view's read that meets it is a refusal no retry
  changes (widget-shell's `isPermanentError`), asked once, with no Try again and no "Updating…";
  a view's state shows a quiet line that its content is missing, a list keeps its rows with no
  footer alert, and an engine's row on the landing keeps what it last read (`isSessionEnded`).
- `src/routes.ts`'s `COCKPIT_FLAGS` copies the cockpit tool's boolean arguments, which
  `test/cockpit-flags.test.ts` holds to the tool's input schema as the engine module registers it.
- Geist comes from the server's own font route (`publicBase`), the theme follows the OS or a
  `data-cd-theme` on `<html>`, the language the browser (German or English), the density is
  compact, comfortable on touch: all of it the view runtime's, which the frame shares.

## Rules

- What `src` imports is `web-is-a-page` in `.dependency-cruiser.cjs`: its own modules, `react`,
  `react-dom`, `lucide-react`, pulse-ui's root and `theme.css`, `@miragon/pulse-widget-shell/widgets`
  and `@miragon/pulse-engine-connector/widgets`. Never a server half, the transport, the MCP Apps
  runtime (ESLint's gate too) or a `./testing` entry; tests and `vite.config.ts` may import more.
- The page's words live in `src/messages` (`en.ts`, `de.ts`, the same keys, brand tone in both;
  `test/messages.test.ts`), its UI on the kit with the brand gates of `@miragon/pulse-ui/testing`
  (`test/brand-gates.test.ts`), dates and numbers through the kit's formatters (the date and number
  gates hold `src`).
- Only files under the build's `assets/` are served: anything the page loads is imported, so Vite
  emits it there under a hashed name; nothing is inlined (`assetsInlineLimit: 0`), no script runs
  inline (the server's Content Security Policy allows the page's own scripts only), and `public/`
  stays empty.
- `vite.config.ts` spreads widget-shell's `VIEW_BUNDLE_DEDUPE` whole (invariant 4);
  `test/bundle-graph.test.ts` holds the page to one copy of each, to the page root without the
  chat's, and to no MCP Apps runtime, no server half of widget-shell and no transport.
- The page's gzip ceilings are `test/__golden__/bundle-budget.json` (`test/bundle-budget.test.ts`,
  shrink-only; growth needs a `Ratchet-Exception:` trailer), its licence list
  `THIRD_PARTY_LICENSES.txt` (`test/third-party-licenses.test.ts`, written by the
  `third-party-licenses` script), its coverage floors `vitest.config.ts`.
