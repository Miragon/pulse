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
no copy of it, so fetch it:

```sh
git clone --depth 1 https://github.com/Miragon/pulse
cp -r pulse/templates/claude-artifact my-dashboard && cd my-dashboard
pnpm install
pnpm dev        # the example dashboard on the recorded fixtures, no server needed
```

Its example is a dashboard of the playground's `miraveloLeasing` process. A new dashboard changes
the one process key, `PROCESS_KEY` in `templates/claude-artifact/src/app.tsx` (and the title in
`templates/claude-artifact/src/page.html`), records new fixtures (`pnpm record -- --process <key>`
against a Pulse MCP server, `MCP_URL`, default `http://localhost:8400/mcp`; `pnpm play` in the
Pulse repository serves one) and edits the sections in `templates/claude-artifact/src/sections/`.
Paths below are from the repository root; in your copy, drop `templates/claude-artifact/`.

- `templates/claude-artifact/src/engine/`: the only door to the engine. `createEngine` over a
  `Connector` gives `call`, `count` and `page` with a 30 s cache, the engine resolved once,
  paging with a cap and the error codes; `useEngine` and `useSection` give each section its own
  loading, error and ready state. `claude-connector.ts` is the one file that knows the artifact
  runtime (see "The connector call"); `tools.ts` lists `PAGE_TOOLS`, every tool the page calls.
- `templates/claude-artifact/src/data/process-dashboard.ts`: every read of the page, plain
  TypeScript without React, so the recorder runs the very same reads.
- `templates/claude-artifact/src/temporary/`: what the page carries until the epic's siblings
  land, each file naming its issue (see "What changes" below).
- `templates/claude-artifact/fixtures/`: one recording per process and the mock runtime that
  serves it to `pnpm dev`, the tests and the screenshots.

## Artifact rules

- **Three files.** `pnpm build` writes `dist/index.html`, `dist/app.js` and `dist/app.css`.
  Publish `dist/index.html` as the page and the other two as its files, under exactly those
  names. The page has no `<html>`, `<head>` or `<body>`: the publish wraps it in its own skeleton.
- **One classic script.** `dist/app.js` is one bundle, loaded as `<script src="app.js">`. The
  artifact runs in a sandboxed frame whose origin is `null`, where a module script from the page's
  own files may fail on CORS: never add `type="module"` and never split the bundle.
- **The skeleton's reset** sets `body` to a 14 px system font and `:root` to a light colour
  scheme, unlayered, so it beats Tailwind's base. The template's root element sets `font-sans`
  and a step of the type scale (`text-dense`) and the dark root `color-scheme: dark`; keep both.
- **Theme.** The viewer stamps `data-theme="light"` or `"dark"` on the root, or nothing for the
  system setting. The template's inline theme bridge follows the attribute, else the OS, by the
  `.dark` class; it never writes `data-theme` and never declares a `--cd-*` token.
- **Content security policy.** Everything ships in the three files; the only outside resource is
  the Geist stylesheet from fonts.googleapis.com. No fetch, XHR or WebSocket to any host: the
  engine comes only through the connector.
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
- **The answer** is the tool's JSON in `payload`, the data the recipes describe (a list's
  `{ items, totalCount, hasMore, nextOffset }`).
- **The runtime caches too.** A call passes `cache: { staleTime: 30000, gcTime: 600000 }`, the
  page's own 30 s (`ANSWER_TTL_MS` in `engine.ts`) as `staleTime`; Refresh, and Try again after a
  failure, pass `{ staleTime: 0, gcTime: 600000, refresh: true }`, so the engine answers anew.
- **A refusal** rejects with a `code` and a `message`; `RUNTIME_CODES` maps each code onto the
  page's `EngineError`, and `errors.ts` words it as what the viewer can do:
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
  `describeError`, so a page works either way.

## Design rules that matter on a page

Compose from pulse-ui and the shared blocks (`references/components.md` has every prop and every
type of the kit a prop names); the brand test of the template runs the kit's gates over your
sources.

- **Numbers stay neutral.** KPI tiles (`KpiGrid`) carry no tint; an alarming count is a
  `CountFigure` with `situation` and `label` (or a `CountBadge`), never a red number.
- **A status is a tone from `SITUATION_TONES`**, a state in a cell a `StateLabel`: running is
  `info`, never green; incidents and jobs without retries `danger`.
- **One badge scheme on a diagram**, the shared screens': `DiagramDecorations.of` gives each
  element its counts, `BadgeCluster` draws them and the template's `DiagramLegend` explains them
  (the blocks' `BadgeLegend` in the page's scope: its badges sum every version); only an element
  with an own open incident is outlined.
- **One word per thing.** Count words from `COUNT_TERMS`: "Incidents" are open root incidents,
  "With incident" the instances that have one, and a count names its version scope ("all
  versions"). Terms from `PRODUCT_GLOSSARY` (cancelled, suspended, "Incident" in German too). Both
  live in `packages/core/ui/src/testing/count-terms.ts` and
  `packages/core/ui/src/testing/glossary.ts`, Node only for now, so the template copies the count
  words (`templates/claude-artifact/src/temporary/count-terms.ts`) and its brand test holds the
  copy and your catalogs to them.
- **Dates, durations, numbers and ids** only through the `format*` helpers and `shortId` after
  `setFormatLocale`; never `toFixed`, `toLocaleString` or a hand-built `Intl` formatter.
- **Words** in English and German after `navigator.language`, through `LocaleProvider` and
  `createUseT`. German says du, AI and „CIB seven“ and uses no dash as a connector; English is
  sentence case without an em dash.
- **States.** Every section reads through `useSection`: a skeleton after 400 ms, the error in
  words with the engine's text under Details, the last good data kept when a refresh fails. One
  failing section never blanks the page. A page the runtime refuses as a whole (the engine not
  resolved, no sign-in, no connector, no approval) shows one state in the sections' place
  (`PageGate`); sections that fail alike say it once, with one Try again; the bar's freshness
  stamp is the oldest read of the sections that show data.
- **Light, dark and 390 px.** Look at the screenshots of all three before you publish.

## Data recipes

`references/data-recipes.md` says which tool answers what and how each number of the cockpit's
process detail is read. The rules that make the numbers right:

- A count is `maxResults: 1` and the list's `totalCount`, never `maxResults: 0` (refused) and
  never the length of a page.
- A list pages by 100 with `firstResult` while `hasMore`, up to a cap (`engine.page`). A cut list
  keeps the engine's exact `totalCount` as its `total` and comes back `complete: false`; every sum
  over its rows is then a lower bound, shown as `{ atLeast: sum }` (`formatCount` renders ≥) or
  under the section's note that its counts may be too low. Never read a cut from `total`.
- Rows shift between pages when the list changes during the read (an instance starts, an
  incident is resolved), whatever the order: `engine.page` keeps each row once by its `id`, and a
  list whose pages disagree with each other or with the engine's count comes back
  `complete: false` too.
- An incident is the process's own when `isRootIncident` says so; a copy on a call activity
  counts as an incident in called instances there, never in the process's own count.
- "With incident" comes from the runtime (`engine_list_process_instances` with
  `withIncidents: true`), never from the history.
- Key-wide numbers span every version; the diagram is the latest version, and its badges sum
  every version's counts per element. A running badge counts tokens as the cockpit does: one an
  own root incident at its element holds counts as that incident, not as running; a scope's own
  row (a multi-instance body, a subprocess, a transaction) counts nowhere; an incident at a
  multi-instance body (`<id>#multiInstanceBody`) counts on its activity.
- The end events reached (the template's outcomes section) count since the chart's first day,
  each share over every end event reached, never over instances: an end event after a
  non-interrupting branch is reached while the instance runs on.
- Never aggregate a rate or a duration across engines; show absolute counts per engine.
- Today the page aggregates (badges per element, buckets per day) from 24 calls per load;
  [#665](https://github.com/Miragon/pulse/issues/665) and
  [#666](https://github.com/Miragon/pulse/issues/666) move that onto the server.

## Checklist

1. Record the fixtures from a Pulse MCP server: `pnpm record -- --process <key>`, then delete the
   example's recording, `templates/claude-artifact/fixtures/miraveloLeasing.json`. A recording
   holds the engine's answers as they came (user ids, business keys, incident messages, the cockpit
   URL): record against a test engine, or leave the recording out of what you commit.
2. Build the page on them with `pnpm dev`; `pnpm typecheck` and `pnpm test` pass.
3. `pnpm shot`, then look at every PNG in `shots/`: light, dark, the OS in dark without
   `data-theme`, at 1240 and 390 px. Fix overflow, collisions and any error state.
4. Set `CONNECTOR_NAME` in `templates/claude-artifact/src/engine/claude-connector.ts` to the
   connector's display name in claude.ai (Settings, Connectors); ask for it when you do not know it.
5. `pnpm build`: exactly `dist/index.html`, `dist/app.js` (one classic script) and `dist/app.css`.
6. Publish the page with its two files.
7. Declare `mcp`: the connector's display name, the same as `CONNECTOR_NAME`, and exactly
   `PAGE_TOOLS`.
8. Open it in claude.ai, allow the access when claude.ai asks, and hold its numbers to the
   cockpit's process detail (`engine_open_cockpit` in the chat).

## What changes

The template carries stand-ins in `templates/claude-artifact/src/temporary/` until the siblings of
epic [#668](https://github.com/Miragon/pulse/issues/668) land; follow this skill's version:

- [#661](https://github.com/Miragon/pulse/issues/661) pulse-ui as a browser bundle that follows
  the OS: the build step and the theme bridge go.
- [#662](https://github.com/Miragon/pulse/issues/662) the BPMN diagram as a public component: the
  diagram, its legend and its badge CSS go.
- [#663](https://github.com/Miragon/pulse/issues/663) charts in the Pulse look: the bar chart and
  the meter rows go.
- [#664](https://github.com/Miragon/pulse/issues/664) section state, panel grid and freshness
  stamp in pulse-ui: the section state and the panels go; the freshness stamp
  (`FreshnessStamp`) comes from pulse-ui already.
- [#665](https://github.com/Miragon/pulse/issues/665) a process's numbers per day and per
  activity, and [#666](https://github.com/Miragon/pulse/issues/666) a screen's JSON form: the
  reads shrink to a few calls, and the running badges count the tokens waiting before an
  asynchronous step too.
- [#667](https://github.com/Miragon/pulse/issues/667) the glossary as browser data: the copied
  count words go.
