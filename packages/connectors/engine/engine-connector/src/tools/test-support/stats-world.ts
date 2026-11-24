import type { FakeReply, RecordedRequest } from "./fake-engine.js"

/**
 * The world of `engine_process_stats`'s wire tests: a fake engine whose history answers each count
 * by its filters, both bounds inclusive as the engine's are, and its rows in the engine's order by
 * duration, beside a runtime with instances running.
 */

export const NOW = Date.parse("2026-11-24T12:00:00.000Z")
export const MINUTE = 60_000
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR

/** An engine date as an instant: the engine writes its offset without a colon. */
const instant = (value: string | undefined) =>
  value === undefined ? undefined : Date.parse(value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"))

export interface Instance {
  id: string
  definitionId: string
  start: number
  end?: number
  /** The end events it reached. */
  reached?: string[]
}

export const V1 = "order:1:d1"
export const V2 = "order:2:d2"

export const at = (iso: string) => Date.parse(iso)

/** The history of the stats world: started and ended around the default 14 days. */
export const INSTANCES: Instance[] = [
  {
    id: "a",
    definitionId: V2,
    start: at("2026-11-24T08:00:00Z"),
    end: at("2026-11-24T08:00:10Z"),
    reached: ["shipped"],
  },
  // Ends at midnight exactly: the 24th's, never the 23rd's too.
  {
    id: "b",
    definitionId: V2,
    start: at("2026-11-23T10:00:00Z"),
    end: at("2026-11-24T00:00:00Z"),
    reached: ["shipped"],
  },
  {
    id: "c",
    definitionId: V1,
    start: at("2026-11-20T00:00:00Z"),
    end: at("2026-11-20T01:00:00Z"),
    reached: ["rejected"],
  },
  { id: "d", definitionId: V2, start: at("2026-11-23T23:59:59.999Z") },
  {
    id: "e",
    definitionId: V2,
    start: at("2026-11-01T00:00:00Z"),
    end: at("2026-11-12T05:00:00Z"),
    reached: ["shipped"],
  },
  {
    id: "f",
    definitionId: V2,
    start: at("2026-11-24T09:00:00Z"),
    end: at("2026-11-24T09:30:00Z"),
    reached: ["shipped", "notified"],
  },
]

const xmlOf = (ends: string[], extra = "") =>
  `<?xml version="1.0"?><bpmn:definitions><bpmn:process id="order" name="Order">` +
  `<bpmn:startEvent id="start"/>${ends.map((id) => `<bpmn:endEvent id="${id}" name="${id.toUpperCase()}"/>`).join("")}` +
  `<bpmn:subProcess id="inner"><bpmn:endEvent id="innerEnd"/></bpmn:subProcess>${extra}` +
  `</bpmn:process></bpmn:definitions>`

const XML: Record<string, string> = {
  [V2]: xmlOf(["shipped", "notified"]),
  [V1]: xmlOf(["shipped", "rejected"]),
}

export function versions(ttl: { v1: number | null; v2: number | null }) {
  return [
    { id: V2, key: "order", name: null, version: 2, historyTimeToLive: ttl.v2 },
    { id: V1, key: "order", name: null, version: 1, historyTimeToLive: ttl.v1 },
  ]
}

/** The instances a history query's filters find, its bounds inclusive as the engine's. */
function historyFor(query: Record<string, string>, instances: readonly Instance[]): Instance[] {
  const within = (value: number | undefined, after?: string, before?: string) =>
    (after === undefined || (value !== undefined && value >= instant(after)!)) &&
    (before === undefined || (value !== undefined && value <= instant(before)!))
  const executed = query.executedActivityIdIn?.split(",")
  return instances.filter(
    (row) =>
      (query.unfinished !== "true" || row.end === undefined) &&
      (query.processDefinitionKey === undefined || query.processDefinitionKey === "order") &&
      (query.processDefinitionId === undefined || query.processDefinitionId === row.definitionId) &&
      within(row.start, query.startedAfter, query.startedBefore) &&
      (query.finishedAfter === undefined && query.finishedBefore === undefined
        ? true
        : within(row.end, query.finishedAfter, query.finishedBefore)) &&
      (executed === undefined || executed.some((id) => row.reached?.includes(id))),
  )
}

const duration = (row: Instance) => (row.end === undefined ? null : row.end - row.start)

/** What runs now: four instances (one with an incident), three failed jobs, five open tasks. */
const RUNTIME: Readonly<Record<string, (query: Record<string, string>) => FakeReply>> = {
  "/process-definition/statistics": () => ({
    body: [
      {
        id: V2,
        instances: 1,
        failedJobs: 0,
        incidents: [{ incidentType: "failedJob", incidentCount: 2 }],
        definition: { id: V2, key: "order", version: 2 },
      },
    ],
  }),
  "/process-instance/count": (query) => ({ body: { count: query.withIncident ? 1 : 4 } }),
  "/process-instance": () => ({ body: [{ id: "running-1" }] }),
  "/job/count": () => ({ body: { count: 3 } }),
  "/task/count": () => ({ body: { count: 5 } }),
}

export function statsWorld(
  options: {
    ttl?: { v1: number | null; v2: number | null }
    instances?: Instance[]
    versions?: ReturnType<typeof versions>
  } = {},
) {
  const instances = options.instances ?? INSTANCES
  return (request: RecordedRequest): FakeReply => {
    const { path, query } = request
    if (path === "/process-definition")
      return { body: options.versions ?? versions(options.ttl ?? { v1: 30, v2: null }) }
    const xml = /^\/process-definition\/(.+)\/xml$/.exec(path)
    if (xml) return { body: { id: xml[1], bpmn20Xml: XML[xml[1] ?? ""] } }
    if (path === "/history/process-instance/count") {
      return { body: { count: historyFor(query, instances).length } }
    }
    if (path === "/history/process-instance") {
      const rows = historyFor(query, instances)
        .map((row) => ({ id: row.id, durationInMillis: duration(row) }))
        .sort((x, y) => (x.durationInMillis ?? 0) - (y.durationInMillis ?? 0))
      const first = Number(query.firstResult ?? 0)
      return { body: rows.slice(first, first + Number(query.maxResults ?? rows.length)) }
    }
    const runtime = RUNTIME[path]
    if (runtime) return runtime(query)
    return { status: 404, body: { type: "NotFoundException", message: `no ${path}` } }
  }
}
