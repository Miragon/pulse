# Data recipes

Which tool of the Pulse MCP server answers what on a page, and how to read each number so it
means what the cockpit's process detail means. Every tool here is a model tool of the read-only
floor (Camunda 7 dialect), so the unauthenticated server and every toolset under OAuth serve it.
The template's `templates/claude-artifact/src/data/process-dashboard.ts` runs these recipes.

## Calls and answers

- **The engine.** Every tool takes `engine` except `engine_list_engines`, which lists them:
  `{ engines: [{ id, environment, dialect, flavor, engineName, cockpitUrl? }], defaultEngineId }`.
  Read it once; take `defaultEngineId`, else the only engine. With several and no default, the page
  names its engine (`createEngine`'s `engineId`) instead of guessing.
- **Strict input.** A key a tool does not know is an error that lists the valid keys, never a
  dropped filter. Send only the keys the recipe names.
- **The answer.** In the artifact, `callTool` resolves to the tool's JSON in `payload`. Over MCP
  itself (the recorder) the same data is `structuredContent`, and `content[0].text` the same data
  as JSON: read `structuredContent`, else parse the text. An answer that is an array comes wrapped
  as `{ data: [...] }`.
- **Lists** answer `{ items, totalCount, hasMore, nextOffset }`. `totalCount` is the engine's own
  count of every match, not the length of `items`. `maxResults` is 1 to 100 (default 20, 50 for
  the historic activity instances), `firstResult` the offset.
- **Errors.** A tool's own error is MCP's `isError` with a text such as
  `[ENGINE_PROFILE_REFUSED] …` or `[404 InvalidRequestException] … (engine prod-a)`. Word it with
  `describeError` and keep the text for Details; `isPermanentError` says when Try again cannot
  help. Whether the artifact runtime resolves such an answer with `isError: true` or rejects it is
  not known, so the template takes both as `tool_error`. A call that gets no answer of the server
  rejects with one of the runtime's seven codes (`needs_reauth`, `server_not_connected`,
  `selection_required`, `not_in_manifest`, `blocked_by_policy`, `approval_required`,
  `server_unavailable`; the skill's "The connector call" says what each means for the viewer).
- **Dates** come back in the engine's format (`2026-10-09T13:40:02.112+0000`), which the format
  helpers read; date arguments take ISO 8601. Compute a window from `engine.now()` by instant
  arithmetic (`now - 15 * 86_400_000`), never from a local midnight, so the recorded arguments
  match on replay in every time zone, and keep the rows of the viewer's local days in the page.

## Counting and paging

- **A count** is a list call with `maxResults: 1`; read `totalCount` (`engine.count`). Never
  `maxResults: 0`, which the server refuses, and never the rows of a page.
- **A whole list** pages by 100 with `firstResult = nextOffset` while `hasMore` (`engine.page`),
  up to a cap (1,000 by default), in a fixed order (`sortBy` an id, `sortOrder: "asc"`). The order
  keeps rows with equal sort keys from trading places; it does not keep rows still. A row that
  comes or goes while later pages are read (an instance starts, an incident is resolved) shifts
  every row after it by one, so a row comes twice or is missed. `engine.page` keeps each row once
  by its `id` and marks the list cut (`cut: "changed"`) when a row came twice, the pages' counts
  differ or the rows kept differ from the engine's count.
- **A cut list** (`complete: false`: the cap stopped it, `cut: "cap"`, or it changed while it was
  paged) keeps the engine's exact `totalCount` as its `total`, so never read a cut from `total`.
  Every sum over its rows is then a lower bound: show it as one, `{ atLeast: sum }` (`formatCount`
  renders "≥ 1,000"), or under the section's note that its counts may be too low. `total` is
  `{ atLeast: n }` only for a cut list of a server that gives no count.
- **Per version.** A read per version of a key runs at most 4 versions at once (c7-core's
  `mapLimit`), as the cockpit's element counts do, never one burst for every version. The
  versions are a paged list too: when it is cut, every sum over the versions is a lower bound.
- **The cache.** An answer is kept 30 s per tool and arguments, and the runtime gets the same
  30 s as its `staleTime`. Refresh forgets them all and passes `refresh: true`, as Try again after
  a failure does, so the engine answers anew. Calls in flight with the same arguments share one.

## The numbers of a process (one key, every version)

| Number                        | Call                                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Running instances             | `engine_status` with `processDefinitionKeyIn: [key]`: the key's row of `definitions`, its `instances`               |
| Open incidents (root)         | the same row's `incidents`                                                                                          |
| Failed jobs (no retries left) | the same row's `failedJobs`                                                                                         |
| With incident                 | count of `engine_list_process_instances` with `processDefinitionKey` and `withIncidents: true`                      |
| Open tasks                    | count of `engine_list_tasks` with `processDefinitionKey`                                                            |
| Started, ended in 24 h        | counts of `engine_query_historic_process_instances` with `processDefinitionKey` and `startedAfter`, `finishedAfter` |
| Versions, latest version      | `engine_list_process_definitions` with `processDefinitionKey` (`latestVersion: true` for the latest only)           |

`engine_status` sums every version of a key and counts root incidents only; it returns at most
10 definitions, so ask for the keys you show. "With incident" is the runtime's answer on every
history level: the historic query's `withIncidents` also counts resolved incidents and finds
nothing below the FULL history level.

## The diagram

- **The XML.** `engine_get_process_definition_xml` with the latest version's
  `processDefinitionId` answers `{ id, bpmn20Xml }`. Name the process with `parseBpmnNames`: the
  engine names a process from `<process>` only, the Modeler names the pool.
- **Incident badges.** Page `engine_list_incidents` with `processDefinitionKey` whole. An
  incident for which `isRootIncident` holds is the process's own and counts at its `activityId`;
  any other is a copy Camunda 7 keeps on the call activity of a failed called instance and counts
  there as an incident in called instances, never in the own count. Never compare an incident's
  ids yourself: `isRootIncident` is the one rule.
- **Running badges.** Page `engine_query_historic_activity_instances` with each version's
  `processDefinitionId` and `unfinished: true` and count the tokens by `activityId` onto the latest
  diagram, by the rule of the cockpit's element counts, which read the runtime's tokens:
  - A token an own root incident holds counts as that incident, not as running: skip the activity
    instance whose `executionId` and `activityId` an own root incident names.
  - A scope holds no token of its own: the history keeps a multi-instance body, an embedded or
    event subprocess or a transaction open while the activities inside it run, the runtime holds
    the token at the inner activity alone, so skip an activity instance of type
    `multiInstanceBody`, `subProcess`, `adHocSubProcess` or `transaction`.
  - An `activityId` with the suffix `#multiInstanceBody` names an activity's body: an incident
    there (one raised before an asynchronous multi-instance activity) counts on the activity, on
    the diagram and in the incidents table alike.
  - Skip an element the diagram does not hold.
  - A token that waits before an asynchronous step has no activity instance yet, so the count
    misses it; say so next to the diagram until
    [#665](https://github.com/Miragon/pulse/issues/665) counts tokens per element.
- **Drawing.** Put the counts into `ElementBadgeData` (`running`, `incidents`,
  `incidentsInCalledInstances`), let `DiagramDecorations.of` make the decorations and draw them
  with `BadgeCluster` over `useBpmnViewer` (`@miragon/pulse-ui/bpmn`). The legend is the
  template's `DiagramLegend`: the blocks' `BadgeLegend` says its badges count one version, the
  page's sum every version.

## Over time

- **Started and ended per day.** Page `engine_query_historic_process_instances` with
  `processDefinitionKey` and `startedAfter` (and once more with `finishedAfter`) for the window,
  then bucket `startTime` and `endTime` by the viewer's local day. Durations come from
  `durationInMillis` of the ended ones (median and P90 through `formatDuration`); `state` tells
  completed from cancelled. A cut read shows its bars as lower bounds and its median and P90 as
  over the rows read.
- **End events reached.** A historic process instance names no end event. Per version, page
  `engine_query_historic_activity_instances` with `processDefinitionId`,
  `activityType: "noneEndEvent"` and `finishedAfter` for the window, keep the rows that ended
  since the chart's first local day, so both sections span the same days, group by `activityId`
  and name each end event from the XML. These are end events reached, not instances: show each
  share over every end event reached. An end event after a non-interrupting branch (a boundary
  event or an event subprocess that does not cancel) is reached while the instance runs on, so it
  says nothing about how an instance ended.

## Lists

- **Open incidents by activity.** The own roots grouped by `activityId`: the count, the latest
  `incidentMessage` and `incidentTimestamp`. The copies go apart, one line per call activity
  under the table: a copy counts in the called process, never as a row of the activity.
- **Open tasks.** Page `engine_list_tasks` with `processDefinitionKey` and group by
  `taskDefinitionKey` (the tool has no filter by it): the count and the oldest `created`.
- **One instance.** `engine_inspect_process_instance` answers where one instance waits and why
  (its root-cause incidents, its called instances), running or ended, in one call.

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

## Calls per load

The example dashboard makes 24 calls per load on the playground today, most of them pages of
incidents, activity instances and historic process instances that the page adds up itself.
[#665](https://github.com/Miragon/pulse/issues/665) brings a process's numbers per day and per
activity, and [#666](https://github.com/Miragon/pulse/issues/666) a screen's JSON form for the
shared blocks, so a dashboard loads with a few calls and its numbers come from the same builder
as the cockpit's.
