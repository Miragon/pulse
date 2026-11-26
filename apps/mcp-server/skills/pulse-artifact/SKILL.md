---
name: pulse-artifact
description: Build a Claude artifact on Pulse, a live page in claude.ai (a dashboard, view or report on a Camunda 7, Operaton or CIB seven process engine) that reads the engine through the Pulse MCP server as the viewer's connector, from the Pulse template with the pulse-ui components, the data recipes and the publish checklist. Use it whenever such a page over an engine, its processes, incidents, instances or tasks is asked for.
---

# Claude artifacts on Pulse

A Claude artifact on Pulse is a page in claude.ai that reads a process engine through the
viewer's own Pulse connector (the Pulse MCP server) and shows it in the Pulse look: a process
dashboard, an engine status page, a report. It reads with the viewer's sign-in and toolset and
writes nothing.

**Use this skill** for such a page, built from the template, published as an artifact.
**Not for:** an answer in the chat (call the engine tools, or open the cockpit with
`engine_open_cockpit`), changing an engine (the chat or the Pulse CLI), a page unrelated to a
process engine, BPMN modelling, or a Camunda 8 cluster: the template reads Camunda 7 REST engines
(Operaton, CIB seven, Camunda 7) and a Camunda 8 engine refuses its calls.

## Start from the template

The template is `templates/claude-artifact` in the Pulse repository
(https://github.com/Miragon/pulse/tree/main/templates/claude-artifact). An installed plugin holds
no copy of it, so fetch it from the release this skill is of, whose libraries its pins name on npm
(`main` may build on pieces no release has yet):

<!-- x-release-please-start-version -->

```sh
git clone --depth 1 --branch v0.33.0 https://github.com/Miragon/pulse
cp -r pulse/templates/claude-artifact my-dashboard && cd my-dashboard
pnpm install
pnpm dev        # the example dashboard on the recorded fixtures, no server needed
```

<!-- x-release-please-end -->

Its example is a dashboard of the playground's `miraveloLeasing` process. A new dashboard changes
the one process key, `PROCESS_KEY` in `templates/claude-artifact/src/app.tsx` (and the title in
`templates/claude-artifact/src/page.html`), records new fixtures (`pnpm record -- --process <key>`
against a Pulse MCP server, `MCP_URL`, default `http://localhost:8400/mcp`; `pnpm play` in the
Pulse repository serves one) and edits the sections in `templates/claude-artifact/src/sections/`.
Paths below are from the repository root; in your copy, drop `templates/claude-artifact/`.

- `templates/claude-artifact/src/engine/`: the only door to the engine. `createEngine` over a
  `Connector` gives `call` with a 30 s cache that calls in flight share, and the error codes;
  `useSection` gives each section its read for pulse-ui's `SectionState`. `claude-connector.ts`
  is the one file that knows the artifact runtime (see "The connector call"); `tools.ts` lists
  `PAGE_TOOLS`, every tool the page calls.
- `templates/claude-artifact/src/data/process-dashboard.ts`: the three calls of a load and what
  each section shows of them, plain TypeScript without React, so the recorder runs the very same
  reads.
- `templates/claude-artifact/fixtures/`: one recording per process and the mock runtime that
  serves it to `pnpm dev`, the tests and the screenshots.

## Artifact rules

- **Three files.** `pnpm build` writes `dist/index.html`, `dist/app.js` and `dist/pulse-ui.css`.
  Publish `dist/index.html` as the page and the other two as its files, under exactly those
  names. The page has no `<html>`, `<head>` or `<body>`: the publish wraps it in its own skeleton.
- **One classic script.** `dist/app.js` is one bundle, loaded as `<script src="app.js">`. The
  artifact runs in a sandboxed frame whose origin is `null`, where a module script from the page's
  own files may fail on CORS: never add `type="module"` and never split the bundle.
- **One stylesheet, pulse-ui's.** `dist/pulse-ui.css` is the package's `dist/browser/pulse-ui.css`
  as it ships: the theme, every class the kit renders and its documented layout utilities. The
  page's own elements use only those (the template's brand test holds every class to it); a class
  beyond them renders nothing. It sets the body in the kit's font on the 13 px step, unlayered, so
  it beats the skeleton's reset.
- **Theme.** The viewer stamps `data-theme="light"` or `"dark"` on the root, or nothing for the
  system setting; pulse-ui's theme follows the attribute, else the OS, with no script of the page.
- **Content security policy.** Everything ships in the three files; the only outside resources are
  the Geist stylesheet from fonts.googleapis.com and, without a build, pulse-ui's modules from
  cdn.jsdelivr.net. No fetch, XHR or WebSocket to any host: the engine comes only through the
  connector.
- **Capabilities, after the first publish.** Declare the `mcp` capability for the connector named
  `CONNECTOR_NAME` with exactly the names of `PAGE_TOOLS`, no more: the runtime refuses a call to a
  tool the declaration leaves out. A declaration is the full set, so a new tool in `PAGE_TOOLS`
  means declaring again. The `artifact-capabilities` skill gives the declaration's shape: load it
  before you declare.
- **Only model tools of the read-only floor.** Every tool the page calls is one the
  unauthenticated server serves too. Never a `*_data` feed (app-only, for the server's own views)
  and never `engine_open_cockpit` (a view tool a host would render).

## The connector call

`templates/claude-artifact/src/engine/claude-connector.ts` is the one file that speaks to the
artifact runtime, and the one call it makes is this:

```ts
const mcp = await window.claude?.use("mcp") // null or undefined: the page declares no mcp
const { payload } = await mcp.callTool(CONNECTOR_NAME, tool, args, { cache })
```

- **Positional arguments, the connector first.** The first is the display name of the viewer's
  connector to the Pulse MCP server, as claude.ai shows it under Settings, Connectors.
  `CONNECTOR_NAME` holds it, a constant you set to that name; the `mcp` declaration names the
  same. Then the tool, its arguments and the cache options.
- **The answer** is the tool's JSON in `payload`, the data the recipes describe.
- **The runtime caches too.** A call passes `cache: { staleTime: 30000, gcTime: 600000 }`, the
  page's own 30 s (`ANSWER_TTL_MS` in `engine.ts`) as `staleTime`; Refresh, and Try again after a
  failure, pass `{ staleTime: 0, gcTime: 600000, refresh: true }` past the runtime's cache. The
  server keeps its own 30 s floor per caller, so a Refresh inside it gets the same read back: date
  the numbers by each answer's `asOf` (the bar's `FreshnessStamp`), never by when it arrived.
- **A refusal** rejects with a `code` and a `message`; `RUNTIME_CODES` maps each code onto the
  page's `EngineError`, whose codes are pulse-ui's page errors (`PageErrorCode`), and
  `describePageError` words it with the connector's name and claude.ai's place:
  - `needs_reauth`: reconnect the connector in claude.ai under Settings, Connectors.
  - `server_not_connected`, `selection_required` (the page's `not_connected`): add the connector
    in claude.ai under Settings, Connectors, or pick it when claude.ai asks for one.
  - `not_in_manifest`, `blocked_by_policy` (`not_allowed`): the page may not read the connector
    for the viewer, and no retry changes that; declaring exactly `PAGE_TOOLS` keeps the first away.
  - `approval_required`: allow the access when claude.ai asks, then try again.
  - `server_unavailable` (`unavailable`): the Pulse MCP server does not answer; try again.
  - any other code, or none: `tool_error`, its `message` read as the server's error.
- **The one unknown** is how a tool's own error answer (MCP's `isError`, a text such as
  `[ENGINE_PROFILE_REFUSED] …`) arrives: as a result with `isError: true` or as a rejection with a
  code not listed above. The template takes both as `tool_error`, its text classified by
  widget-shell's `describeError`, so a page works either way.

## Without a build

A page of a few panels needs no template: one module script loads pulse-ui's browser bundle from
jsDelivr, and the artifact's one file is `pulse-ui.css`, copied from the same package version
(`node_modules/@miragon/pulse-ui/dist/browser/pulse-ui.css`, or the URL beside the bundle's). The
version is the release's; take this skill's version, never `latest`:

<!-- x-release-please-start-version -->

```html
<link rel="stylesheet" href="pulse-ui.css" />
<div id="root"></div>
<script type="module">
  import * as ui from "https://cdn.jsdelivr.net/npm/@miragon/pulse-ui@0.33.0/dist/browser/pulse-ui.js"
  const h = ui.createElement
  const mcp = await window.claude.use("mcp")
  const cache = { staleTime: 30000, gcTime: 600000 }
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const args = { processDefinitionKey: "miraveloLeasing", bucket: "day", timeZone }
  const { payload: stats } = await mcp.callTool("Pulse", "engine_process_stats", args, { cache })
  const tile = (label, count) => ({ label, value: h(ui.CountFigure, null, ui.formatCount(count)) })
  const page = h(
    "main",
    { className: "flex flex-col gap-section p-gutter" },
    h(ui.WidgetHeader, { title: stats.processDefinitionName ?? stats.processDefinitionKey }),
    h(ui.KpiGrid, {
      boxed: true,
      cells: [
        tile("Running", stats.now.running),
        tile("Ended in 24 hours", stats.now.endedLast24h),
      ],
    }),
  )
  const root = ui.createRoot(document.getElementById("root"))
  root.render(h(ui.LocaleProvider, { locale: "en" }, page))
</script>
```

<!-- x-release-please-end -->

`pulse-ui.js` holds React, ReactDOM and the kit, React once: take every hook and `createRoot`
from it. `pulse-ui-bpmn.js` beside it holds the BPMN diagram on the same React, and
`dist/glossary/index.js` the product's words with no bundle. The rules below hold here too: a
refused call worded by `describePageError`, each section through `SectionState`, no class beyond
the stylesheet's. A page that grows past a few panels, or needs its numbers held by tests, starts
from the template instead.

## Design rules that matter on a page

Compose from pulse-ui (`references/components.md` has every prop and every type of the kit a prop
names); the brand test of the template runs the kit's gates over your sources.

- **Numbers stay neutral.** KPI tiles (`KpiGrid`) carry no tint; an alarming count is a
  `CountFigure` with `situation` and `label` (or a `CountBadge`), never a red number.
- **A status is a tone from `SITUATION_TONES`**, a state in a cell a `StateLabel`: running is
  `info`, never green; incidents and jobs without retries `danger`.
- **Charts** are pulse-ui's: `BarChart` and `LineChart` over days, `MeterRows` for shares,
  `Sparkline` in a tile. At most two series on the blue ramp, told apart by lightness; red only
  for a series of `kind: "incident"`; never green. A lower bound (`{ atLeast }`) draws to its
  bound and says so, an unknown count draws nothing.
- **One badge scheme on a diagram**, the shared screens': `BpmnDiagram` of
  `@miragon/pulse-ui/bpmn` draws the `decorations` `engine_activity_counts` answers (each
  element's counts apart, only an own open incident outlined), and `DiagramLegend` explains them
  with the page's scope (its badges sum every version on the latest diagram).
- **One word per thing.** Count words from `COUNT_TERMS` of `@miragon/pulse-ui/glossary`:
  "Incidents" are open root incidents, "With incident" the instances that have one, and a count
  names its version scope ("all versions"). Terms from `PRODUCT_GLOSSARY` (cancelled, suspended,
  "Incident" in German too); `glossaryFindings` holds a catalog to them. Every term is in
  `docs/glossary.md` (https://miragon.github.io/pulse/glossary).
- **Dates, durations, numbers and ids** only through the `format*` helpers and `shortId` after
  `setFormatLocale`; never `toFixed`, `toLocaleString` or a hand-built `Intl` formatter.
- **Words** in English and German after `navigator.language`, through `LocaleProvider` and
  `createUseT`. German says du, AI and „CIB seven“ and uses no dash as a connector; English is
  sentence case without an em dash.
- **States.** Every section renders its read through `SectionState`: a skeleton after 400 ms, the
  failure in words with the engine's text under Details, the last good data kept when a refresh
  fails. One failing section never blanks the page; under one `SectionStateGroup` sections that
  fail alike say it once, with one Try again. A page the runtime refuses as a whole (no sign-in,
  no connector, no approval) shows one state in the sections' place (`PageGate`). The sections
  sit in `Panel`s on a `PanelGrid`, and the bar's `FreshnessStamp` is the oldest `asOf` of the
  answers the sections show.
- **Light, dark and 390 px.** Look at the screenshots of all three before you publish.

## Data recipes

`references/data-recipes.md` says which tool answers what. The rules that make the numbers right:

- **Three calls a load.** `engine_process_stats` (bucket `"day"`, the viewer's `timeZone`) for the
  numbers now and per day, `engine_activity_counts` for the counts per activity and the diagram's
  decorations, `engine_get_process_definition_xml` of the `definitionId` it names. The server
  counts with the cockpit's builders; the page adds nothing up, pages nothing and counts nothing.
- A count is a `Count`: exact, `{ atLeast }` where the engine may have removed history, `null`
  unknown; `formatCount` writes each, the charts draw each, and none is ever a 0.
- An incident is the process's own when it is a root incident; a copy on a call activity counts
  as an incident in called instances there, never in the process's own count.
- "With incident" comes from the runtime, never from the history.
- Key-wide numbers span every version; the diagram is the latest version, its badges every
  version's counts per element, the running tokens as the cockpit counts them.
- The end events reached count the instances that ended and reached each, so an instance that
  reached two counts at both: each share is of the instances that ended, never of the sum.
- Never aggregate a rate or a duration across engines; show absolute counts per engine.
- A page of the shared blocks (`@miragon/pulse-blocks`) reads a screen's or a board's JSON in one
  call: `engine_get_screen` or `engine_get_board`.

## Checklist

1. Record the fixtures from a Pulse MCP server: `pnpm record -- --process <key>`, then delete the
   example's recording, `templates/claude-artifact/fixtures/miraveloLeasing.json`. A recording
   holds the engine's answers as they came (incident messages, the process model): record
   against a test engine, or leave the recording out of what you commit.
2. Build the page on them with `pnpm dev`; `pnpm typecheck` and `pnpm test` pass.
3. `pnpm shot`, then look at every PNG in `shots/`: light, dark, the OS in dark without
   `data-theme`, at 1240 and 390 px. Fix overflow, collisions and any error state.
4. Set `CONNECTOR_NAME` in `templates/claude-artifact/src/engine/claude-connector.ts` to the
   connector's display name in claude.ai (Settings, Connectors); ask for it when you do not know it.
5. `pnpm build`: exactly `dist/index.html`, `dist/app.js` (one classic script) and
   `dist/pulse-ui.css`.
6. Publish the page with its two files.
7. Declare `mcp`: the connector's display name, the same as `CONNECTOR_NAME`, and exactly
   `PAGE_TOOLS`.
8. Open it in claude.ai, allow the access when claude.ai asks, and hold its numbers to the
   cockpit's process detail (`engine_open_cockpit` in the chat).
