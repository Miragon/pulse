# Data recipes

Which tool of the Pulse MCP server answers what on a page, and what each number means, so it
means what the cockpit's process detail means. Every tool here is a model tool of the read-only
floor, so the unauthenticated server and every toolset under OAuth serve it. The template's
`templates/claude-artifact/src/data/process-dashboard.ts` runs the process dashboard's recipe.

## Calls and answers

- **The engine.** Every engine tool takes `engine`; without it the server reads its default engine
  (the one it names as default, else its only one), and each answer names the engine it read. A
  server with several engines and no default refuses a call without one (`ENGINE_NOT_SELECTED`):
  the page names its engine then (`createEngine`'s `engineId`). `engine_list_engines` lists them.
- **Strict input.** A key a tool does not know is an error that lists the valid keys, never a
  dropped filter. Send only the keys the recipe names.
- **The answer.** In the artifact, `callTool` resolves to the tool's JSON in `payload`. Over MCP
  itself (the recorder) the same data is `structuredContent`, and `content[0].text` the same data
  as JSON: read `structuredContent`, else parse the text.
- **Counts.** A count of the history is a `Count`: a number, `{ atLeast: n }` where the engine may
  have removed history (before `history.keptFrom`, the shortest `historyTimeToLive` of the
  versions), or `null` unknown (every history count where `history.recorded` is false: the engine
  writes no history). `formatCount` writes "1,234", "≥ 1,234" and "—"; `BarChart`, `MeterRows`
  and `KpiGrid` show each as it is. Never turn one into a 0.
- **Errors.** A tool's own error is MCP's `isError` with a text such as
  `[ENGINE_PROFILE_REFUSED] …` or `[404 InvalidRequestException] … (engine prod-a)`. Word it with
  widget-shell's `describeError` and keep the text for Details; `isPermanentError` says when Try
  again cannot help. A page without a build has no widget-shell (it has no browser bundle): it
  words every failure with pulse-ui's `describePageError`, a tool's own error as `tool_error`. Whether the artifact runtime resolves such an answer with `isError: true` or
  rejects it is not known, so the template takes both as `tool_error`. A call that gets no answer
  of the server rejects with one of the runtime's seven codes (`needs_reauth`,
  `server_not_connected`, `selection_required`, `not_in_manifest`, `blocked_by_policy`,
  `approval_required`, `server_unavailable`), which the page maps onto pulse-ui's `PageErrorCode`
  and words with `describePageError`.
- **Dates** come back as ISO 8601 (the buckets) or in the engine's format
  (`2026-10-09T13:40:02.112+0000`, the incidents and tasks), which the format helpers read.
- **The cache.** An answer is kept 30 s per tool and arguments, and the runtime gets the same
  30 s as its `staleTime`; the server keeps the expensive answers 30 s per caller as well.
  Refresh forgets them all and passes `refresh: true`, as Try again after a failure does. Calls in
  flight with the same arguments share one, so sections that show the same answer make one call.

## A process dashboard: three calls

| Call                                                                                            | What the page shows of it                                                      |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `engine_process_stats` with `processDefinitionKey`, `bucket: "day"` and the viewer's `timeZone` | The tiles, started and ended per day, the durations and the end events reached |
| `engine_activity_counts` with `processDefinitionKey`                                            | The badges on the diagram, open incidents by activity, open tasks              |
| `engine_get_process_definition_xml` with the `definitionId` `engine_activity_counts` names      | The diagram it draws the badges on                                             |

The first two run at once, the third after the second. The page pages nothing, counts nothing and
adds nothing up: the server reads with the cockpit's builders, so the numbers are the process
detail's.

### `engine_process_stats`: now and per day

Every version of the key. `from` and `to` are optional: without them the range is the last 14
days of the `timeZone` (default UTC), today up to now; `bucket: "hour"` gives the last 24 hours. A
bare date (`2026-11-20`) is that day of the `timeZone`, so `from` and `to` as dates are its days.

| Field                                             | What it is                                                                                   |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `now.running`                                     | Running instances                                                                            |
| `now.incidents`                                   | Open root incidents (a call activity's copies count in the called process)                   |
| `now.withIncident`                                | Instances with an open incident, from the runtime on every history level                     |
| `now.failedJobs`                                  | Jobs without retries                                                                         |
| `now.openTasks`                                   | Open tasks                                                                                   |
| `now.startedLast24h`, `now.endedLast24h`          | Instances started and ended in the last 24 hours (`Count`)                                   |
| `buckets[]`: `start`, `end`, `started`, `ended`   | Per day of the zone (23 or 25 hours where the clocks change), the oldest first (`Count`)     |
| `buckets[].endedAt`                               | Per end event's activity id, the instances that ended that day and reached it                |
| `endEvents[]`: `activityId`, `name`, `ended`      | Each end event directly in the process, the instances that ended in the range and reached it |
| `totals.started`, `totals.ended`                  | The range's started and ended instances                                                      |
| `durations`: `ended`, `medianMs`, `p90Ms`         | Median and P90 duration of the instances that ended since `durations.from`, by nearest rank  |
| `history.keptFrom`                                | Before it the engine may have removed history: a count of an earlier day is `{ atLeast }`    |
| `history.recorded`                                | `false`: the engine writes no history, every history count and duration is `null`            |
| `versions.latestVersion`, `processDefinitionName` | The latest version and the process's name                                                    |

An instance can reach more than one end event (a non-interrupting branch ends at its own), so it
counts at each: show each end event's share of `totals.ended`, never of the sum of `endEvents`.

### `engine_activity_counts`: per activity

Every deployed version summed onto the latest version's diagram (`version` names one version on
its own diagram instead). `definitionId` and `version` name the diagram counted on.

- `decorations` is the shared screens' diagram form: per element its counts (`running`,
  `incidents`, `incidentsInCalledInstances`) and whether an own root incident outlines it, an
  incident inside a collapsed subprocess rolled up to its shape. Pass it to pulse-ui's
  `BpmnDiagram` as it is.
- `activities[]` holds every element that holds anything: `name` from the diagram, `running` (the
  tokens as the cockpit counts them: a token an own root incident holds counts as that incident,
  a token waiting before an asynchronous step counts as running), `openTasks` and
  `oldestOpenTask`, `incidents` (own open root incidents), `incidentsInCalledInstances` (copies,
  counted in the called process), `failedJobs`, and the latest incident of each kind
  (`latestIncident`, `latestIncidentInCalledInstances`, its `message` and `at`; a copy's message
  is its root incident's).
- Open incidents by activity are the rows with `incidents`; what a call activity waits on in the
  instances it called goes apart, never as a row of the activity. Open tasks are the rows with
  `openTasks`.

### `engine_get_process_definition_xml`

With `processDefinitionId` (the `definitionId` above) it answers `{ id, bpmn20Xml }`. No answer of
the other tools carries XML. `readBpmnNames` and `parseBpmnNames` of `@miragon/pulse-ui/bpmn` name
its elements; `BpmnDiagram` names them by itself.

## A page of the shared blocks: one call

The web app's screens and the boards of the cockpit are data in the forms
`@miragon/pulse-blocks` renders:

- `engine_get_screen` with `screen: "engine"` (the processes with their counts),
  `"process"` with `processDefinitionKey` (each version's counts, one version's badges per element)
  or `"instance"` with `processInstanceId` (its incidents, waits, path and variables) answers
  `{ screen, formatVersion, data }`.
- `engine_get_board` with `board` (an id `engine_list_engines` lists under `boards`) answers
  `{ board, formatVersion, asOf, data }`, the board's tiles over the engines it names.

Check `formatVersion` before you read `data`: a new version renames or drops a key. The blocks
(`BoardGrid`, `ProcessTable`, `EngineTable`, …) render with classes `pulse-ui.css` does not hold,
so such a page compiles its stylesheet with Tailwind 4: pulse-ui's `theme.css` after
`@import "tailwindcss"`, `@source` over pulse-ui's and the blocks' `dist` and
`@source not` over pulse-ui's `dist/browser`.

## An engine status page

`engine_status` without arguments judges one engine: `status` (`ok`, `warning` or `critical`,
its tone from `VERDICT_TONES`), the `findings` by severity, root incident groups (`incidents`, each
with `count`, `message`, `firstAt` and `lastAt`), `rootIncidentsTotal`, `externalTasks` by topic,
`jobs`, `tasks.open` and `batches`. A page over several engines calls it per engine and shows each
engine's absolute counts side by side: never add up or average a rate or a duration across
engines, which differ in their processes; compare like with like by holding the process fixed.

## Not on a page

- The `*_data` feeds are app-only: hosts hide them from the model, and they serve the server's own
  views. A page calls model tools only.
- `engine_open_cockpit` is a view tool: a host renders its answer. Use it in the chat to hold a
  page's numbers to the cockpit's.
- Writes: a page reads. Retries, migrations and the like belong in the chat, the cockpit or the
  Pulse CLI.
- A Camunda 8 engine: `engine_process_stats`, `engine_activity_counts` and
  `engine_get_process_definition_xml` read Camunda 7 REST engines (CIB seven, Operaton, Camunda 7);
  `engine_get_screen` and `engine_get_board` serve a Camunda 8 engine too.
