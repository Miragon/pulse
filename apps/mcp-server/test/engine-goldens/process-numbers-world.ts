import type { EngineAnswer, EngineReply, SentRequest } from "./fake-engines.js"

/**
 * The engine the process numbers' goldens read (`engine_process_stats`, `engine_activity_counts`):
 * the process `order` in two versions, three instances that ended in the last 14 days (two on v2
 * at its end event `Event_Shipped`, one on v1 at `Event_Rejected`, which only v1 has) and `pi-1`,
 * which waits at the user task `approve` while its asynchronous `charge` failed for good. Its
 * history answers each count by its filters, both bounds inclusive as the engine's are, and its
 * rows in the engine's order by duration. The CLI has no twin of these tools, so the world is the
 * server's alone (the shared one, world.ts, stays the CLI's copy).
 */

const V1 = "order:1:5e0d79"
const V2 = "order:2:6f1e8a"

const definitions = [
  { id: V2, key: "order", name: "Order", version: 2, historyTimeToLive: null },
  { id: V1, key: "order", name: "Order", version: 1, historyTimeToLive: 180 },
]

const diagram = (ends: string) =>
  '<?xml version="1.0" encoding="UTF-8"?><bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">' +
  '<bpmn:process id="order" name="Order"><bpmn:startEvent id="Event_Received"/>' +
  '<bpmn:userTask id="approve" name="Approve order"/><bpmn:serviceTask id="charge" name="Charge card"/>' +
  `${ends}</bpmn:process></bpmn:definitions>`

const XML: Readonly<Record<string, string>> = {
  [V2]: diagram('<bpmn:endEvent id="Event_Shipped" name="Shipped"/>'),
  [V1]: diagram(
    '<bpmn:endEvent id="Event_Shipped" name="Shipped"/><bpmn:endEvent id="Event_Rejected" name="Rejected"/>',
  ),
}

interface HistoricInstance {
  id: string
  definitionId: string
  start: string
  end?: string
  reached?: string
}

const HISTORY: readonly HistoricInstance[] = [
  {
    id: "hist-3",
    definitionId: V1,
    start: "2026-09-30T12:00:00Z",
    end: "2026-10-01T12:00:00Z",
    reached: "Event_Rejected",
  },
  {
    id: "hist-1",
    definitionId: V2,
    start: "2026-10-08T09:00:00Z",
    end: "2026-10-08T09:05:00Z",
    reached: "Event_Shipped",
  },
  {
    id: "hist-2",
    definitionId: V2,
    start: "2026-10-09T08:00:00Z",
    end: "2026-10-09T10:00:00Z",
    reached: "Event_Shipped",
  },
  { id: "pi-1", definitionId: V2, start: "2026-10-09T13:38:15.430Z" },
]

const incident = {
  id: "inc-1",
  rootCauseIncidentId: "inc-1",
  incidentType: "failedJob",
  activityId: "charge",
  processInstanceId: "pi-1",
  processDefinitionId: V2,
  executionId: "pi-1",
  configuration: "job-1",
  incidentMessage: "Card declined: insufficient funds (order B-7)",
  incidentTimestamp: "2026-10-09T13:40:02.112+0000",
}

/** An engine date or an ISO 8601 one as an instant. */
const instant = (value: string) => Date.parse(value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"))

function within(value: string | undefined, after: string | null, before: string | null): boolean {
  if (after === null && before === null) return true
  if (value === undefined) return false
  return (
    (after === null || instant(value) >= instant(after)) &&
    (before === null || instant(value) <= instant(before))
  )
}

function historyFor(query: URLSearchParams): HistoricInstance[] {
  return HISTORY.filter(
    (row) =>
      (query.get("processDefinitionKey") ?? "order") === "order" &&
      (query.get("processDefinitionId") ?? row.definitionId) === row.definitionId &&
      within(row.start, query.get("startedAfter"), query.get("startedBefore")) &&
      within(row.end, query.get("finishedAfter"), query.get("finishedBefore")) &&
      (query.get("executedActivityIdIn") ?? row.reached) === row.reached,
  )
}

const durationOf = (row: HistoricInstance) =>
  row.end === undefined ? null : instant(row.end) - instant(row.start)

function historyRows(query: URLSearchParams): EngineReply {
  const rows = historyFor(query)
    .map((row) => ({ id: row.id, durationInMillis: durationOf(row) }))
    .sort((a, b) => (a.durationInMillis ?? 0) - (b.durationInMillis ?? 0))
  const first = Number(query.get("firstResult") ?? 0)
  return { body: rows.slice(first, first + Number(query.get("maxResults") ?? rows.length)) }
}

const elementStatistics: Readonly<Record<string, unknown[]>> = {
  [V2]: [
    { id: "approve", instances: 1, failedJobs: 0, incidents: [] },
    {
      id: "charge",
      instances: 1,
      failedJobs: 1,
      incidents: [{ incidentType: "failedJob", incidentCount: 1 }],
    },
  ],
  [V1]: [],
}

const ROUTES: Readonly<Record<string, (query: URLSearchParams) => EngineReply>> = {
  "/process-definition": () => ({ body: definitions }),
  "/process-definition/statistics": () => ({
    body: [
      {
        id: V2,
        instances: 1,
        failedJobs: 1,
        incidents: [{ incidentType: "failedJob", incidentCount: 1 }],
        definition: definitions[0],
      },
    ],
  }),
  "/process-instance/count": () => ({ body: { count: 1 } }),
  "/job/count": () => ({ body: { count: 1 } }),
  "/task/count": (query) => ({
    body: { count: (query.get("taskDefinitionKey") ?? "approve") === "approve" ? 1 : 0 },
  }),
  "/task": () => ({ body: [{ id: "task-1", created: "2026-10-09T13:38:15.498+0000" }] }),
  "/incident": () => ({ body: [incident] }),
  "/history/process-instance/count": (query) => ({ body: { count: historyFor(query).length } }),
  "/history/process-instance": historyRows,
}

/** The world's answer to a read below `/engine-rest`; anything else is a 404 NotFoundException. */
export const processNumbersAnswer: EngineAnswer = (request: SentRequest) => {
  const url = new URL(request.target, "http://engine")
  const path = url.pathname.replace(/^\/engine-rest/, "")
  const route = ROUTES[path]
  if (route) return route(url.searchParams)
  const definition = /^\/process-definition\/([^/]+)\/(xml|statistics)$/.exec(path)
  const id = decodeURIComponent(definition?.[1] ?? "")
  if (definition?.[2] === "xml" && XML[id]) return { body: { id, bpmn20Xml: XML[id] } }
  if (definition?.[2] === "statistics" && elementStatistics[id]) {
    return { body: elementStatistics[id] }
  }
  return undefined
}
