import { readFileSync } from "node:fs"
import path from "node:path"

/**
 * The CHAIN engine of test:web (`/chain/engine-rest`): a CIB seven REST stand-in for the instance
 * screen's journey, a failure that lies in an instance another one called. It replays one Operaton
 * run of the conformance world (fixtures/chain-engine.json, a copy of c7-core's recorded screen
 * engine, held to it by scripts/recorded-engine-copy.test.mjs): DSP-3001 of "Dispatch order" waits
 * at its call activity for the root incident of the "Print label" instance it called, a failed job
 * whose stack trace names its root cause. Beside the recording it answers what the page reads
 * around it: the incident by its id (the row the recording's incident list holds), the process's
 * instance list the cockpit shows embedded, an ended instance of the process (DSP-2999, from the
 * history alone), and nothing for any other instance, as an engine answers an instance it does not
 * know.
 */

export const CHAIN_PREFIX = "/chain"

const ROOT = "/engine-rest"

/** An answer of the recording: the request it answered and the JSON or text it answered with. */
interface RecordedAnswer {
  readonly method: string
  readonly path: string
  readonly query?: Readonly<Record<string, string>>
  readonly body?: unknown
  readonly answer?: unknown
  readonly text?: string
  readonly contentType?: string
}

interface Reply {
  status: number
  body: unknown
  contentType?: string
}

const RECORDING = JSON.parse(
  readFileSync(path.join(import.meta.dirname, "fixtures", "chain-engine.json"), "utf8"),
) as { answers: RecordedAnswer[] }

/** The calling instance and the one it called, as the recording names them. */
export const CHAIN = {
  dispatch: "02884da0-e4fa-11f1-a98a-a2a764d20660",
  label: "02895f16-e4fa-11f1-a98a-a2a764d20660",
  rootIncident: "0291c39a-e4fa-11f1-a98a-a2a764d20660",
  copyIncident: "0291c39b-e4fa-11f1-a98a-a2a764d20660",
  /** An ended instance of "Dispatch order", which the history alone holds. */
  ended: "7f0c0eb3-e4fa-11f1-a98a-a2a764d20660",
} as const

const DISPATCH_V1 = "pulse-dispatch:1:0256b623-e4fa-11f1-a98a-a2a764d20660"

/** A JSON value as text, the keys of each of its objects in order, so two spellings compare equal. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_, entry: unknown) =>
    entry !== null && typeof entry === "object" && !Array.isArray(entry)
      ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : entry,
  )
}

function keyOf(method: string, route: string, query: Iterable<[string, string]>, body: unknown) {
  const sorted = [...query].map((pair) => JSON.stringify(pair)).sort()
  return JSON.stringify([method, route, sorted, body === undefined ? null : canonical(body)])
}

const REPLIES = new Map(
  RECORDING.answers.map((recorded) => [
    keyOf(recorded.method, recorded.path, Object.entries(recorded.query ?? {}), recorded.body),
    recorded.text === undefined
      ? { status: 200, body: recorded.answer }
      : { status: 200, body: recorded.text, contentType: recorded.contentType ?? "text/plain" },
  ]),
)

/** The recording's answers of `route`, whatever their query. */
const answersAt = (route: string): unknown[] =>
  RECORDING.answers
    .filter((recorded) => recorded.method === "GET" && recorded.path === route)
    .map((recorded) => recorded.answer)

/** The incidents the recording's incident lists hold. */
const INCIDENTS = answersAt(`${ROOT}/incident`).flat() as Array<Record<string, unknown>>

/** The recording's history of DSP-3001, the shape of every historic instance of the process. */
const DISPATCH_HISTORY = answersAt(
  `${ROOT}/history/process-instance/${CHAIN.dispatch}`,
)[0] as Record<string, unknown>

/** DSP-2999: an instance of "Dispatch order" that completed, its history all there is of it. */
const ENDED_HISTORY = {
  ...DISPATCH_HISTORY,
  id: CHAIN.ended,
  businessKey: "DSP-2999",
  rootProcessInstanceId: CHAIN.ended,
  startTime: "2026-11-20T10:02:00.120+0000",
  endTime: "2026-11-20T10:02:01.480+0000",
  durationInMillis: 1360,
  state: "COMPLETED",
}

/** The path DSP-2999 took: its start event, its call activity and its end event, all done. */
const ENDED_PATH = [
  [
    "Event_DispatchRequested",
    "startEvent",
    "2026-11-20T10:02:00.120+0000",
    "2026-11-20T10:02:00.121+0000",
  ],
  [
    "Activity_PrintShippingLabel",
    "callActivity",
    "2026-11-20T10:02:00.122+0000",
    "2026-11-20T10:02:01.470+0000",
  ],
  [
    "Event_DispatchDone",
    "noneEndEvent",
    "2026-11-20T10:02:01.471+0000",
    "2026-11-20T10:02:01.480+0000",
  ],
].map(([activityId, activityType, startTime, endTime], index) => ({
  id: `${activityId}:ended-${String(index)}`,
  parentActivityInstanceId: CHAIN.ended,
  activityId,
  activityName: null,
  activityType,
  processDefinitionKey: "pulse-dispatch",
  processDefinitionId: DISPATCH_V1,
  processInstanceId: CHAIN.ended,
  executionId: CHAIN.ended,
  taskId: null,
  calledProcessInstanceId: null,
  calledCaseInstanceId: null,
  assignee: null,
  startTime,
  endTime,
  durationInMillis: Date.parse(endTime ?? "") - Date.parse(startTime ?? ""),
  canceled: false,
  completeScope: activityType === "noneEndEvent",
  tenantId: null,
  removalTime: null,
  rootProcessInstanceId: CHAIN.ended,
}))

const NOT_FOUND: Reply = {
  status: 404,
  body: { type: "InvalidRequestException", message: "No such instance or resource" },
}

/** The ids every list read of the instance tree names, from a request's query or body. */
function namedIds(url: URL, body: unknown): string[] {
  const listed = [...url.searchParams.entries()]
    .filter(([name]) =>
      /[Ii]nstanceIds?(?:In)?$|^processInstanceId$|^superProcessInstance$/.test(name),
    )
    .flatMap(([, value]) => value.split(","))
  const inBody = (body as { processInstanceIds?: unknown } | undefined)?.processInstanceIds
  return [...listed, ...(Array.isArray(inBody) ? inBody.map(String) : [])]
}

/** What the engine answers of DSP-2999, which only its history holds; null for another request. */
function endedRoute(route: string, url: URL, body: unknown): Reply | null {
  if (route === `${ROOT}/process-instance/${CHAIN.ended}`) return NOT_FOUND
  if (route === `${ROOT}/history/process-instance/${CHAIN.ended}`) {
    return { status: 200, body: ENDED_HISTORY }
  }
  if (!namedIds(url, body).includes(CHAIN.ended)) return null
  if (route === `${ROOT}/history/activity-instance`) return { status: 200, body: ENDED_PATH }
  if (route === `${ROOT}/history/process-instance`) return { status: 200, body: [ENDED_HISTORY] }
  return { status: 200, body: [] }
}

/** The incident by its id: the row the recording's incident lists hold, else none. */
function incidentRoute(route: string): Reply | null {
  const byId = new RegExp(`^${ROOT}/incident/([^/]+)$`).exec(route)
  if (!byId) return null
  const incident = INCIDENTS.find(({ id }) => id === decodeURIComponent(byId[1]))
  return incident === undefined ? NOT_FOUND : { status: 200, body: incident }
}

/** The versions the recording names: its process definitions' rows. */
const DEFINITIONS = answersAt(`${ROOT}/process-definition`).flat() as Array<Record<string, unknown>>

/** A version by its id, and the versions of a key (the latest alone where asked). */
function definitionRoute(route: string, url: URL): Reply | null {
  const byId = new RegExp(`^${ROOT}/process-definition/([^/]+)$`).exec(route)
  if (byId) {
    const definition = DEFINITIONS.find(({ id }) => id === byId[1])
    return definition === undefined ? NOT_FOUND : { status: 200, body: definition }
  }
  const key = url.searchParams.get("key")
  if (route !== `${ROOT}/process-definition` || key === null) return null
  const unique = new Map(DEFINITIONS.map((definition) => [definition.id, definition]))
  return { status: 200, body: [...unique.values()].filter((definition) => definition.key === key) }
}

/** The running instances of the recording, as the runtime lists them. */
const RUNNING = [
  answersAt(`${ROOT}/process-instance/${CHAIN.dispatch}`)[0],
  answersAt(`${ROOT}/process-instance/${CHAIN.label}`)[0],
] as Array<Record<string, unknown>>

/** The histories the recording holds of its running instances. */
const HISTORIES = [CHAIN.dispatch, CHAIN.label].map(
  (id) => answersAt(`${ROOT}/history/process-instance/${id}`)[0] as Record<string, unknown>,
)

/**
 * The process instances a list of the cockpit asks for: by process, the runtime's rows (none of them
 * suspended), and their histories by their ids.
 */
function instanceListRoute(method: string, route: string, body: unknown): Reply | null {
  const filter = (body ?? {}) as { processDefinitionKey?: unknown; suspended?: unknown }
  const rows = RUNNING.filter(
    (row) =>
      filter.suspended !== true &&
      (filter.processDefinitionKey === undefined ||
        row.definitionKey === filter.processDefinitionKey),
  )
  if (method === "POST" && route === `${ROOT}/history/process-instance`) {
    const ids = new Set(namedIds(new URL("http://chain"), body))
    return { status: 200, body: HISTORIES.filter(({ id }) => ids.has(String(id))) }
  }
  if (method === "POST" && route === `${ROOT}/process-instance/count`) {
    return { status: 200, body: { count: rows.length } }
  }
  if (method === "POST" && route === `${ROOT}/process-instance`) return { status: 200, body: rows }
  return null
}

/** A count no row of this world fills, and a list of a query the recording did not make. */
function emptyRoute(method: string, route: string): Reply | null {
  if (route.endsWith("/count")) return { status: 200, body: { count: 0 } }
  if (
    method === "GET" &&
    /^\/engine-rest\/(?:process-instance|history\/[^/]+|incident|job|task|external-task|event-subscription|variable-instance|process-definition)$/.test(
      route,
    )
  ) {
    return { status: 200, body: [] }
  }
  return null
}

/**
 * The chain engine's answer to a request under {@link CHAIN_PREFIX}, or null for any other: the
 * recording's where it holds one, else this world's around it, else what an engine answers an
 * instance or a resource it does not hold.
 */
export function chainRoute(method: string, url: URL, body: unknown): Reply | null {
  if (!url.pathname.startsWith(CHAIN_PREFIX)) return null
  const route = decodeURIComponent(url.pathname.slice(CHAIN_PREFIX.length))
  const recorded = REPLIES.get(keyOf(method, route, url.searchParams.entries(), body))
  if (recorded !== undefined) return recorded
  return (
    endedRoute(route, url, body) ??
    incidentRoute(route) ??
    definitionRoute(route, url) ??
    instanceListRoute(method, route, body) ??
    emptyRoute(method, route) ??
    NOT_FOUND
  )
}
