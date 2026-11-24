# Claude artifact on Pulse

A template for a live page in claude.ai, a Claude artifact, that reads a process engine through
the Pulse MCP server: the viewer has added the server in claude.ai as a connector, and the page
calls its tools, signed in as the viewer. The page is React on `@miragon/pulse-ui`, in the Pulse
look, light and dark, English and German.

The example is a dashboard of the playground's `miraveloLeasing` process: its key figures, the
diagram with its badges, started and ended per day, the end events reached, open incidents by
activity and open tasks. Its numbers are the cockpit's process detail's, read in three calls. The
Claude Code plugin `pulse-artifact` (`apps/mcp-server/skills/pulse-artifact/SKILL.md`) teaches
Claude to build pages from this template.

## Start in under 10 minutes

You need Node.js 22.22.2 or later and pnpm 10.32.1. Copy the folder out of a clone of the release
its pins name: the template builds on that release's libraries from npm, which `main` may already
have moved past.

<!-- x-release-please-start-version -->

```sh
git clone --depth 1 --branch v0.32.0 https://github.com/Miragon/pulse
cp -r pulse/templates/claude-artifact my-dashboard
cd my-dashboard
pnpm install
pnpm dev
```

<!-- x-release-please-end -->

`pnpm dev` serves the page on the recorded answers in `templates/claude-artifact/fixtures/`,
through a stand-in for the artifact's connector (`templates/claude-artifact/fixtures/mock-claude.ts`),
so it needs no engine and no server. `?lang=de` shows it in German,
`?fail=engine_process_stats` lets that tool fail with an engine error, `?fail=needs_reauth`
refuses every call with that code of the runtime's and
`?fail=engine_process_stats:server_unavailable` one tool, `?delay=800` slows every answer down to
show the loading states.

| Command                       | What it does                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| `pnpm dev`                    | The page on the fixtures, reloading on every change                                   |
| `pnpm record`                 | One load's three calls against a Pulse MCP server, written to `fixtures/<key>.json`   |
| `pnpm shot`                   | Screenshots in light, dark and the OS's dark, at 1240 and 390 px, into `shots/`       |
| `pnpm build`                  | `dist/index.html`, `dist/app.js` and `dist/pulse-ui.css`, the three files you publish |
| `pnpm typecheck`, `pnpm test` | Types, the data rules, the page on the fixtures, the bundle and the brand gates       |

## Your own process

1. Change the one process key, `PROCESS_KEY` in `templates/claude-artifact/src/app.tsx`, and the
   page's title in `templates/claude-artifact/src/page.html`.
2. Record your engine's answers. In a clone of the Pulse repository, `pnpm play` starts the
   playground's engine and serves the Pulse MCP server at `http://localhost:8400/mcp`; for another
   server set `MCP_URL`, and `MCP_TOKEN` when it asks for a bearer token:

   ```sh
   pnpm record                      # the key of src/app.tsx
   pnpm record -- --process orders  # another key
   ```

   The recorder (`templates/claude-artifact/scripts/record.ts`) runs every read of the dashboard
   once, with the clock fixed at its start and the days counted in this machine's time zone
   (`--time-zone Europe/Berlin` names another), and writes the zone and each call with its
   answer. Ids change with every start of an engine, so record the whole dashboard again rather
   than join two recordings. Once your process is recorded, delete the example's recording,
   `templates/claude-artifact/fixtures/miraveloLeasing.json`.

   A recording holds the engine's answers as they came: incident messages, activity names and
   the engine's id. Record against a test engine, or leave the recording out of what you commit.

3. Edit the sections in `templates/claude-artifact/src/sections/`. Their reads live in
   `templates/claude-artifact/src/data/process-dashboard.ts`, which the recorder runs too: a read
   you add there is in the next recording. Record again after you change a read.
4. Look at the page: `pnpm exec playwright install --with-deps chromium` once, then `pnpm shot`
   (and `pnpm shot -- --locale de`), and check every screenshot in `shots/` for overflow,
   collisions, contrast and a failure where data belongs.
5. `pnpm build`, `pnpm typecheck` and `pnpm test`.

## How the page reads

`templates/claude-artifact/src/engine/` is the page's one way to the engine:

- `claude-connector.ts` is the only file that knows the artifact runtime: a `Connector` over
  `await window.claude.use("mcp")`, whose `callTool(CONNECTOR_NAME, tool, args, { cache })` calls
  a tool on the viewer's connector of that display name, with positional arguments, and answers
  with the tool's JSON in `payload`. `CONNECTOR_NAME` ("Pulse") is a constant you set to the
  connector's name in claude.ai. Every call passes the runtime's cache options, the page's own
  30 seconds as `staleTime`; Refresh, and Try again after a failure, pass `refresh: true` past the
  runtime's cache, though the server still answers a call inside its own 30-second floor with its
  first read. A call the runtime refuses rejects with one of seven codes, each of which
  the page words as what the viewer can do (the table under Publish). One thing is not known: how
  a tool's own error answer arrives, as a result with `isError: true` or as a rejection with
  another code. The connector takes both as the server's error.
- `tools.ts` lists `PAGE_TOOLS`, every tool the page calls: model tools of the read-only floor,
  never a `*_data` feed or a view tool. A section that needs another tool adds it there first.
- `engine.ts` keeps each answer 30 seconds by tool and arguments, and calls in flight with the
  same arguments share one, so sections that show the same answer make one call. It names no
  engine, so the server reads its default one; `engineId` names one for a server with several.
- `errors.ts` words each failure in English and German through pulse-ui: the runtime's refusals
  by `describePageError` with the connector's name and claude.ai's place, the server's errors
  classified by widget-shell's `describeError`, the raw text only under Details.
- `use-engine.tsx` gives each section `useSection`, its read as pulse-ui's `SectionState` shows
  it: loading, ready or failed on its own, the last data kept when a refresh fails, so one failing
  section never blanks the page. The page's `SectionStateGroup` says a failure that sections share
  once, with one Try again. A page the runtime refuses as a whole (no sign-in, no connector, no
  approval) shows one state in the sections' place
  (`templates/claude-artifact/src/sections/page-gate.tsx`). The bar's freshness stamp is when the
  server read the numbers: the oldest `asOf` of the answers the sections show.

One load of the example makes three calls, whatever the process holds:

| Call                                | Sections                                                                                 |
| ----------------------------------- | ---------------------------------------------------------------------------------------- |
| `engine_process_stats`              | Key figures, started and ended per day with the durations, end events reached            |
| `engine_activity_counts`            | The bar's name and version, the diagram's badges, open incidents by activity, open tasks |
| `engine_get_process_definition_xml` | The diagram of the version `engine_activity_counts` counts on                            |

`engine_process_stats` reads the last 14 days of the viewer's time zone, a bucket a day.
The server reads with the cockpit's builders and keeps each answer 30 seconds per caller:
incidents are open root incidents, a call activity's copies count in the called process, "With
incident" reads the runtime, and the running badges count the tokens as the cockpit's element
counts do. Every number spans every version of the key, the diagram is the latest version. The
end events reached count the instances that ended and reached each, each share of every instance
that ended: an instance that reached two end events counts at both. Where the engine may have
removed history inside the 14 days, those days count at least what it kept and the chart says from
when. The reads are Camunda 7's (CIB seven, Operaton, Camunda 7): a Camunda 8 engine refuses them.

## Publish

1. Set `CONNECTOR_NAME` in `templates/claude-artifact/src/engine/claude-connector.ts` to the
   display name of the Pulse connector in claude.ai (Settings, Connectors).
2. `pnpm build`, then publish `dist/index.html` as the artifact's page with `dist/app.js` and
   `dist/pulse-ui.css` as its files. The page holds no `<html>`, `<head>` or `<body>`: Claude
   wraps it in its own.
3. After the first publish, declare the `mcp` capability: the same connector name and exactly the
   tools of `PAGE_TOOLS` in `templates/claude-artifact/src/engine/tools.ts`. The runtime refuses a
   call to a tool it does not name.

An artifact loads scripts only from its own files and a few CDNs, stylesheets only from its own
files and Google Fonts, and fetches nothing else, so the build bundles everything the page runs and
`dist/index.html` links Geist from Google Fonts. `dist/app.js` is one classic script
(`<script src="app.js">`): the artifact runs in a sandboxed frame whose origin is `null`, where a
module script from its own files may fail on CORS. `dist/pulse-ui.css` is pulse-ui's stylesheet for
a page without a build as the package ships it (`dist/browser/pulse-ui.css`): the theme, every
class the kit renders and its documented layout utilities. Claude sets `data-theme="dark"` or
`"light"` on the page's root, or nothing for the system setting: the theme follows it, and the OS
without it, with no script of the page.

What a viewer is told when the runtime refuses a call, by its code:

| Code                                         | What the viewer can do                                                                    |
| -------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `needs_reauth`                               | Reconnect the connector in claude.ai under Settings, Connectors                           |
| `server_not_connected`, `selection_required` | Add the connector in claude.ai under Settings, Connectors, or pick it when claude.ai asks |
| `not_in_manifest`, `blocked_by_policy`       | Ask whoever published the page: it may not read the connector for them                    |
| `approval_required`                          | Allow the access when claude.ai asks, then try again                                      |
| `server_unavailable`                         | Try again: the Pulse MCP server does not answer                                           |
| any other code, and a tool's own error       | Read the server's error, worded by widget-shell's `describeError`                         |

## Rules the tests hold

ESLint does not reach a template, so `templates/claude-artifact/test/brand.test.ts` runs
pulse-ui's brand gates over `templates/claude-artifact/src/`: colours by role only, Lucide icons at
16 or 24 px, the type scale, the voice rules and the product's words (pulse-ui's glossary) in both
catalogs, every role pair readable in light and dark, no stylesheet of the page's own, and every
class the page's elements name one `pulse-ui.css` holds (a class beyond the kit's and its layout
utilities would render nothing). Keep the rest by hand: dates, durations, numbers and ids only
through pulse-ui's `format*` helpers and `shortId` (never `toFixed` or `toLocaleString`), a status
as a tone (`SITUATION_TONES`), never green for running, and an alarming count as a `CountFigure`
with its situation, its number neutral. `templates/claude-artifact/test/app.test.tsx` holds a load
to three calls, each tool of `PAGE_TOOLS` once. `templates/claude-artifact/test/bundle.test.ts`
keeps the MCP client, ext-apps' runtime, React Query, the fixtures and the mock out of
`dist/app.js`, by strings each of them keeps after minification, holds `dist/app.js` to one classic
script (no `import`, `export` or `import.meta`, no `type="module"` in `dist/index.html`) and
`dist/pulse-ui.css` to the package's own.
