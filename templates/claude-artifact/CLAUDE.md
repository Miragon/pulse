# CLAUDE.md

Guidance for AI agents working on this page: a Claude artifact on Pulse, a page in claude.ai that
reads a process engine through the viewer's connector to the Pulse MCP server and writes nothing.
`README.md` is the tour for people; this file holds the rules the code does not say itself.

## What a copy sets

`src/page.config.ts` holds what a copy sets: `PROCESS_KEY`, the process the dashboard shows,
which `pnpm record` records; `CONNECTOR_NAME`, the name the artifact runtime knows the viewer's
Pulse connector by (as in claude.ai's Settings, Connectors, for example `Miragon-ai-cloud`),
which the `mcp` declaration names too; and `PAGE_TOOLS`, every tool the page calls. Ask for the
connector's name when you do not know it. The page's title is in `src/page.html`.

## The artifact runtime

- **Three files.** `pnpm build` writes `dist/index.html`, `dist/app.js` and `dist/pulse-ui.css`.
  Publish the first as the page and the other two as its files, under exactly those names. The
  page has no `<html>`, `<head>` or `<body>`: the publish wraps it in its own skeleton, which
  `index.html` stands in for under `pnpm dev`.
- **One classic script.** The artifact runs in a sandboxed frame whose origin is `null`, where a
  module script from the page's own files may fail on CORS: never add `type="module"` and never
  split the bundle (`test/bundle.test.ts`).
- **Content security policy.** Stylesheets load only from the page's files and Google Fonts
  (Geist), and no fetch, XHR or WebSocket reaches any host: everything ships in the three files,
  and the engine comes only through the connector.
- **One door to the runtime.** `src/artifact.tsx` mounts the page with widget-shell's
  `mountClaudeArtifact`, whose caller alone speaks to `window.claude`: never call the runtime from
  the page. Its contract, as a probe verified it, with its date, is in
  `node_modules/@miragon/pulse-widget-shell/src/ui/claude-artifact/claude-tool-caller.ts` (the
  package ships its sources), and widget-shell's README holds the page reads and the codes.
- **Capabilities.** After the first publish, declare
  `{ "mcp": { "servers": [{ "server": CONNECTOR_NAME, "tools": PAGE_TOOLS }] } }` from
  `src/page.config.ts`, with exactly the names of `PAGE_TOOLS`: the runtime refuses a call to a
  tool the declaration leaves out (`not_in_manifest`). A declaration is always the full set, so a
  new tool in `PAGE_TOOLS` means declaring again, every tool included. Load the
  `artifact-capabilities` skill before you declare where it is available.

## Data

- **Only model tools of the read-only floor**, which the server serves without OAuth and on every
  toolset. Never a `*_data` feed (app-only, for the server's own views) and never
  `engine_open_cockpit` (a view tool whose answer a host renders). A section that needs another
  tool adds it to `PAGE_TOOLS` first. Input is strict: a key a tool does not know fails the call.
- **Three calls a load** (`test/app.test.tsx`). The server counts with the cockpit's builders, so
  its numbers are the process detail's: the page never adds them up, averages, pages or derives one
  from another.
- **A count is a `Count`:** exact, `{ atLeast: n }` where the engine may have removed history
  (before `history.keptFrom`), or `null`, unknown (where `history.recorded` is false). The
  `format*` helpers and the charts show each as it is; never show one as 0.
- **Incidents are open root incidents.** A call activity's copy counts in the called process
  (`incidentsInCalledInstances`), never in the process's own count; "With incident" reads the
  runtime.
- **Scope.** Every number spans every version of the key, and its label says so (`COUNT_TERMS`);
  the diagram is the latest version, its badges every version's counts. An instance can reach two
  end events and counts at both, so an end event's share is of `totals.ended`, never of the sum.
- **Never aggregate a rate or a duration across engines:** engines host different processes, so a
  sum or mean measures their mix. Show absolute counts per engine; compare with the process fixed.

| Call                                | Arguments                                                        | Sections                              |
| ----------------------------------- | ---------------------------------------------------------------- | ------------------------------------- |
| `engine_process_stats`              | `processDefinitionKey`, `bucket: "day"`, the viewer's `timeZone` | Key figures, per day, end events      |
| `engine_activity_counts`            | `processDefinitionKey`                                           | Bar, diagram badges, incidents, tasks |
| `engine_get_process_definition_xml` | `processDefinitionId`, the `definitionId` of the counts          | Diagram                               |

`src/data/process-dashboard.ts` runs these reads, typed with the fields the page reads, and the
recorder runs the same reads: record again after you change one. A recording keeps those fields
and nothing else (`src/data/recorded-reads.ts`, whose type check fails until a field a section
starts to read joins it), and the recorder refuses a tool the server does not mark read-only.

## The look

- **pulse-ui only.** Compose from `@miragon/pulse-ui` and its entries `./bpmn`, `./format`,
  `./tones` and `./glossary`. No stylesheet of the page's own and no class `pulse-ui.css` lacks:
  it holds the kit's classes and the layout utilities its README lists, and any other class renders
  nothing (`test/brand.test.ts`, which runs the kit's brand gates over `src/`). Light and dark
  follow the viewer's `data-theme`, else the OS, through that stylesheet alone.
- **Sections.** Each reads through widget-shell's `useSectionRead` and renders through
  `SectionState` in a `Panel`, behind the page's one `PageGate`, so one failing section never
  blanks the page: copy one of `src/sections/` for a new one. Its key names everything its read
  depends on besides the reader (`["stats", processKey]`): sections with one key share one read,
  so two different reads never share a key.
- **Dates, durations, numbers and ids** only through the `format*` helpers and `shortId`, never
  `toFixed`, `toLocaleString` or a hand-built `Intl` formatter: the helpers follow the viewer's
  locale and the zone `mountClaudeArtifact` sets, and write a `Count` as it is. A relative time
  counts from `usePageReads().now()`, the page's clock (the recording's on the fixtures).
- **A status is a tone from `SITUATION_TONES`, never a colour:** running is `info`, never green;
  open incidents and jobs without retries `danger`. A state in a cell is a `StateLabel`.
- **Numbers stay neutral.** Tiles carry no tint; an alarming count is a `CountFigure` with its
  `situation` and `label`. Charts draw at most two series on the blue ramp, red only for
  incidents, never green.
- **Words** in English and German after `navigator.language`, the same keys in both catalogs of
  `src/messages.ts`, the product's terms from `PRODUCT_GLOSSARY` (the brand test holds both).
  German says du, AI and „CIB seven“; neither language uses a dash as a connector; English is
  sentence case.

The components, their props and how a dashboard page composes them: pulse-ui's README,
`node_modules/@miragon/pulse-ui/README.md` (its sections "A dashboard page", "Charts" and "The BPMN
diagram"), typed in `node_modules/@miragon/pulse-ui/dist/index.d.ts` and each entry's
`dist/<entry>/index.d.ts`. Both are the version this copy pins, and `pnpm typecheck` is the gate.
A search from the copy's root skips pnpm's symlink: search `node_modules/@miragon/pulse-ui/`.

## Checklist

1. Set the values of `src/page.config.ts`, then `pnpm record` against a Pulse MCP server with a
   test engine (a recording keeps the ids, names and numbers the page reads as they came, an
   incident's message only with `--keep-text`, which it then says as `keepText`) and delete
   `fixtures/miraveloLeasing.json`.
2. Edit the sections in `src/sections/` on `pnpm dev`.
3. `pnpm shot` and `pnpm shot -- --locale de`, then look at every screenshot in `shots/`: overflow,
   collisions, contrast and a failure where data belongs.
4. `pnpm build`, `pnpm typecheck` and `pnpm test` pass.
5. Publish `dist/index.html` with `dist/app.js` and `dist/pulse-ui.css`, then declare `mcp` from
   `src/page.config.ts`.
6. Open it in claude.ai, allow the access when claude.ai asks, and hold its numbers to the
   cockpit's process detail (`engine_open_cockpit` in the chat).
