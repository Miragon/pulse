# Claude artifact on Pulse

A template for a live page in claude.ai, a Claude artifact, that reads a process engine through
the Pulse MCP server: the viewer has added the server in claude.ai as a connector, and the page
calls its tools, signed in as the viewer. The page is React on `@miragon/pulse-ui`, in the Pulse
look, light and dark, English and German.

The example is a dashboard of the playground's `miraveloLeasing` process: its key figures, the
diagram with its badges, started and ended per day, the end events reached, open incidents by
activity and open tasks. Its numbers mean what the cockpit's process detail shows. The Claude
Code plugin `pulse-artifact` (`apps/mcp-server/skills/pulse-artifact/SKILL.md`) teaches Claude to
build pages from this template.

## Start in under 10 minutes

You need Node.js 22.22.2 or later and pnpm 10.32.1. Copy the folder out of a clone:

```sh
git clone --depth 1 https://github.com/Miragon/pulse
cp -r pulse/templates/claude-artifact my-dashboard
cd my-dashboard
pnpm install
pnpm dev
```

`pnpm dev` serves the page on the recorded answers in `templates/claude-artifact/fixtures/`,
through a stand-in for the artifact's connector (`templates/claude-artifact/fixtures/mock-claude.ts`),
so it needs no engine and no server. `?lang=de` shows it in German, `?fail=engine_status` lets
that tool fail with an engine error, `?fail=needs_reauth` refuses every call with that code of the
runtime's and `?fail=engine_status:server_unavailable` one tool, `?delay=800` slows every answer
down to show the loading states.

| Command                       | What it does                                                                     |
| ----------------------------- | -------------------------------------------------------------------------------- |
| `pnpm dev`                    | The page on the fixtures, reloading on every change                              |
| `pnpm record`                 | One load's calls against a Pulse MCP server, written to `fixtures/<key>.json`    |
| `pnpm shot`                   | Screenshots in light, dark and the OS's dark, at 1240 and 390 px, into `shots/`  |
| `pnpm build`                  | `dist/index.html`, `dist/app.js` and `dist/app.css`, the three files you publish |
| `pnpm typecheck`, `pnpm test` | Types, the data rules, the page on the fixtures, the bundle and the brand gates  |

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
   once, with the clock fixed at its start, and writes each call with its answer. Ids change with
   every start of an engine, so record the whole dashboard again rather than join two recordings.
   Once your process is recorded, delete the example's recording,
   `templates/claude-artifact/fixtures/miraveloLeasing.json`.

   A recording holds the engine's answers as they came: user ids, business keys, incident
   messages and the engine's cockpit URL. Record against a test engine, or leave the recording
   out of what you commit.

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
  30 seconds as `staleTime`; Refresh, and Try again after a failure, pass `refresh: true`, so the
  engine answers anew. A call the runtime refuses rejects with one of seven codes, each of which
  the page words as what the viewer can do (the table under Publish). One thing is not known: how
  a tool's own error answer arrives, as a result with `isError: true` or as a rejection with
  another code. The connector takes both as the server's error.
- `tools.ts` lists `PAGE_TOOLS`, every tool the page calls: model tools of the read-only floor, never
  a `*_data` feed or a view tool. A section that needs another tool adds it there first.
- `engine.ts` adds the engine to every call (`engine_list_engines`: its default, else its only
  engine), keeps each answer 30 seconds by tool and arguments, counts with `maxResults: 1` and
  reads lists in pages of 100 up to 1,000 rows, each row once by its id. A list the cap cuts, or
  one that changed while it was paged, keeps the engine's count as its total and comes back
  `complete: false`, and its section says its counts may be too low.
- `errors.ts` words each failure in English and German: what happened and what you can do, the
  server's errors classified by widget-shell's `describeError`, the raw text only under Details.
- `use-engine.tsx` gives each section `useSection`: loading, ready or error on its own, the last
  data kept when a refresh fails, so one failing section never blanks the page. Sections that fail
  alike say it once, with one Try again. A page the runtime refuses as a whole (the engine not
  resolved, no sign-in, no connector, no approval) shows one state in the sections' place
  (`templates/claude-artifact/src/sections/page-gate.tsx`). The bar's freshness stamp is the
  oldest read of the sections that show data.

One load of the example on the playground makes 24 calls:

| Section                             | Calls                                                                                                                                                                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Every call                          | `engine_list_engines` once, for the engine                                                                                                                                                                                     |
| Header, diagram, end events reached | `engine_list_process_definitions` and `engine_get_process_definition_xml` of the latest version, shared                                                                                                                        |
| Key figures                         | `engine_status` (running, jobs without retries, open root incidents), counts of `engine_list_process_instances` with incident, `engine_list_tasks` and `engine_query_historic_process_instances` started and ended in 24 hours |
| Diagram                             | `engine_list_incidents` paged (shared with the incidents table), `engine_query_historic_activity_instances` unfinished, paged per version                                                                                      |
| Started and ended per day           | `engine_query_historic_process_instances` paged, once by start and once by end, over 15 days                                                                                                                                   |
| End events reached                  | `engine_query_historic_activity_instances` of the plain end events reached, paged per version, since the chart's first day                                                                                                     |
| Open tasks                          | `engine_list_tasks` paged                                                                                                                                                                                                      |

Incidents are open root incidents; a call activity's copies of the incidents in the instances it
called count in the called process (c7-core's `isRootIncident`). "With incident" reads the
runtime. The running badges come from the history, count a token an own root incident holds as
that incident and miss a token that waits before an asynchronous step. The end events reached are
counted as such, each share over all of them: an instance that runs on after a non-interrupting
branch has reached an end event without ending. Every number spans every version of the key, the
diagram is the latest version. The reads are Camunda 7's (CIB seven, Operaton, Camunda 7): a
Camunda 8 engine refuses them.

## Publish

1. Set `CONNECTOR_NAME` in `templates/claude-artifact/src/engine/claude-connector.ts` to the
   display name of the Pulse connector in claude.ai (Settings, Connectors).
2. `pnpm build`, then publish `dist/index.html` as the artifact's page with `dist/app.js` and
   `dist/app.css` as its files. The page holds no `<html>`, `<head>` or `<body>`: Claude wraps it
   in its own.
3. After the first publish, declare the `mcp` capability: the same connector name and exactly the
   tools of `PAGE_TOOLS` in `templates/claude-artifact/src/engine/tools.ts`. The runtime refuses a
   call to a tool it does not name.

An artifact loads scripts only from its own files and a few CDNs, stylesheets only from its own
files and Google Fonts, and fetches nothing else, so the build bundles everything the page runs and
`dist/index.html` links Geist from Google Fonts. `dist/app.js` is one classic script
(`<script src="app.js">`): the artifact runs in a sandboxed frame whose origin is `null`, where a
module script from its own files may fail on CORS. Claude sets `data-theme="dark"` or `"light"` on
the page's root, or nothing for the system setting: the theme bridge follows it, and the OS without
it.

What a viewer is told when the runtime refuses a call, by its code:

| Code                                         | What the viewer can do                                                                    |
| -------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `needs_reauth`                               | Reconnect the connector in claude.ai under Settings, Connectors                           |
| `server_not_connected`, `selection_required` | Add the connector in claude.ai under Settings, Connectors, or pick it when claude.ai asks |
| `not_in_manifest`, `blocked_by_policy`       | Ask whoever published the page: it may not read the connector for them                    |
| `approval_required`                          | Allow the access when claude.ai asks, then try again                                      |
| `server_unavailable`                         | Try again: the Pulse MCP server does not answer                                           |
| any other code, and a tool's own error       | Read the server's error, worded by widget-shell's `describeError`                         |

## The temporary parts

The template carries a few parts that Pulse will provide instead, under the epic
[#668](https://github.com/Miragon/pulse/issues/668). Each sits in
`templates/claude-artifact/src/temporary/`, its first line naming the issue that replaces it:

| File                                                                           | Replaced by                                                                          |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `theme-bridge.js` and the build itself                                         | [#661](https://github.com/Miragon/pulse/issues/661), pulse-ui as a browser bundle    |
| `process-diagram.tsx`, `canvas-badge.tsx`, `diagram-legend.tsx`, `diagram.css` | [#662](https://github.com/Miragon/pulse/issues/662), the BPMN diagram as a component |
| `bar-chart.tsx`, `meter-rows.tsx`                                              | [#663](https://github.com/Miragon/pulse/issues/663), charts in the Pulse look        |
| `section-state.tsx`, `panel.tsx`                                               | [#664](https://github.com/Miragon/pulse/issues/664), dashboard building blocks       |
| `count-terms.ts`                                                               | [#667](https://github.com/Miragon/pulse/issues/667), the glossary as browser data    |

The reads shrink too: [#665](https://github.com/Miragon/pulse/issues/665) brings a process's numbers
per day and per activity, and [#666](https://github.com/Miragon/pulse/issues/666) a screen's
numbers, each in one call, so a load will need a few calls and add up nothing itself. The freshness
stamp comes from `@miragon/pulse-ui` (#664).

## Rules the tests hold

ESLint does not reach a template, so `templates/claude-artifact/test/brand.test.ts` runs
pulse-ui's brand gates over `templates/claude-artifact/src/`: colours by role only, Lucide icons at
16 or 24 px, the type scale, the voice rules and the product's words in both catalogs, and every
role pair readable in light and dark. Keep the rest by hand: dates, durations, numbers and ids only
through pulse-ui's `format*` helpers and `shortId` (never `toFixed` or `toLocaleString`), a status
as a tone (`SITUATION_TONES`), never green for running, and an alarming count as a `CountFigure`
with its situation, its number neutral. `templates/claude-artifact/test/bundle.test.ts` keeps the
MCP client, ext-apps' runtime, React Query, the fixtures and the mock out of `dist/app.js`, by
strings each of them keeps after minification, and holds `dist/app.js` to one classic script: it
compiles it as one (no `import`, `export` or `import.meta`) and finds no `type="module"` in
`dist/index.html`.
