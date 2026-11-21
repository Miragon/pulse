/**
 * Every builder renders against this world, so a test can break exactly ONE read (`readOf`). It
 * holds a call chain: the instance `pi-1` (order v1) failed at `charge` (the root incident `inc-1`),
 * and the instance `callerInstanceId` (order v2) that called it waits at its call activity
 * `callActivityId`, where Camunda 7 holds a copy of that incident (`copyIncidentId`). The engine's
 * statistics count it as the engine does: with `rootIncidents=true` the root alone, with
 * `incidents=true` the copy too, so a view that counted copies would show 2 incidents where there
 * is 1.
 */
import type { FakeReply, RecordedRequest } from "./fake-engine.js"

export const WORLD = {
  key: "order",
  latestDefinitionId: "order:2:d2",
  instanceDefinitionId: "order:1:d1",
  instanceId: "pi-1",
  incidentId: "inc-1",
  delegatedIncidentId: "inc-2",
  jobId: "job-1",
  activityId: "charge",
  callerInstanceId: "pi-2",
  callActivityId: "callOrder",
  copyIncidentId: "inc-copy",
} as const

/** The key's diagram, every version's: the world's activity and the call activity the caller waits at. */
const WORLD_XML =
  '<?xml version="1.0"?><definitions><process id="order"><serviceTask id="charge" name="Charge card"/><callActivity id="callOrder" calledElement="order"/></process></definitions>'

const definition = (version: 1 | 2) => ({
  id: `order:${version}:d${version}`,
  key: WORLD.key,
  name: "Order",
  version,
})

const incident = {
  id: WORLD.incidentId,
  processDefinitionId: WORLD.instanceDefinitionId,
  processInstanceId: WORLD.instanceId,
  executionId: WORLD.instanceId,
  activityId: WORLD.activityId,
  failedActivityId: WORLD.activityId,
  incidentType: "failedJob",
  incidentMessage: "card declined",
  incidentTimestamp: "2026-10-10T08:00:00.000+0200",
  configuration: WORLD.jobId,
}

/** A delegated incident (a call activity's failure, propagated): its failure lives on `inc-1`. */
const delegated = {
  ...incident,
  id: WORLD.delegatedIncidentId,
  configuration: null,
  incidentMessage: null,
  rootCauseIncidentId: WORLD.incidentId,
}

/** The copy the caller's call activity holds of the root incident `inc-1`. */
const copy = {
  ...delegated,
  id: WORLD.copyIncidentId,
  processDefinitionId: WORLD.latestDefinitionId,
  processInstanceId: WORLD.callerInstanceId,
  executionId: `${WORLD.callerInstanceId}-call`,
  activityId: WORLD.callActivityId,
  failedActivityId: WORLD.callActivityId,
}

/** The open incidents `/incident` lists and `/incident/count` counts, by the filters it is given. */
function incidentsFor(query: Record<string, string>): unknown[] {
  return [incident, copy].filter(
    (row) =>
      (query.processInstanceId ?? row.processInstanceId) === row.processInstanceId &&
      (query.processDefinitionId ?? row.processDefinitionId) === row.processDefinitionId &&
      (query.activityId ?? row.activityId) === row.activityId &&
      (query.incidentType ?? row.incidentType) === row.incidentType &&
      (query.processDefinitionKeyIn ?? WORLD.key).split(",").includes(WORLD.key),
  )
}

/**
 * Per version: v1 holds the root incident, v2 the copy, which only `incidents=true` (or a type)
 * counts; `rootIncidents=true` counts the root alone.
 */
function definitionStatistics(query: Record<string, string>): unknown[] {
  const copies = query.rootIncidents !== "true"
  return [1, 2].map((v) => ({
    id: definition(v as 1 | 2).id,
    instances: v,
    failedJobs: v === 1 ? 1 : 0,
    incidents:
      v === 1 || copies ? [{ incidentType: "failedJob", incidentCount: 1 }] : ([] as unknown[]),
    definition: definition(v as 1 | 2),
  }))
}

const ROUTES: Record<string, unknown> = {
  // What the engine is (a board's engine strip): its telemetry's product.
  "/telemetry/data": { product: { name: "CIB seven", version: "2.1.0" } },
  [`/process-instance/${WORLD.instanceId}`]: {
    id: WORLD.instanceId,
    definitionId: WORLD.instanceDefinitionId,
    businessKey: "B-1",
    suspended: false,
    ended: false,
  },
  [`/process-instance/${WORLD.instanceId}/activity-instances`]: {
    id: WORLD.instanceId,
    activityId: WORLD.key,
    childActivityInstances: [
      {
        id: "ai-1",
        activityId: WORLD.activityId,
        childActivityInstances: [],
        childTransitionInstances: [],
      },
    ],
    childTransitionInstances: [],
  },
  [`/process-instance/${WORLD.instanceId}/variables`]: {
    amount: { type: "Integer", value: 3, valueInfo: {} },
  },
  "/process-instance": [
    {
      id: WORLD.instanceId,
      definitionId: WORLD.instanceDefinitionId,
      businessKey: "B-1",
      suspended: false,
    },
  ],
  [`/incident/${WORLD.incidentId}`]: incident,
  [`/incident/${WORLD.delegatedIncidentId}`]: delegated,
  "/job": [
    {
      id: WORLD.jobId,
      processInstanceId: WORLD.instanceId,
      processDefinitionId: WORLD.instanceDefinitionId,
      processDefinitionKey: WORLD.key,
      failedActivityId: WORLD.activityId,
      retries: 0,
      exceptionMessage: "card declined",
      suspended: false,
      priority: 0,
    },
  ],
  "/history/process-instance": [
    {
      id: WORLD.instanceId,
      processDefinitionId: WORLD.instanceDefinitionId,
      processDefinitionKey: WORLD.key,
      processDefinitionName: "Order",
      processDefinitionVersion: 1,
      businessKey: "B-1",
      startTime: "2026-10-10T07:55:00.000+0200",
      state: "ACTIVE",
    },
  ],
  "/history/activity-instance": [{ id: "h-1", activityId: "start", activityType: "startEvent" }],
}

const XML_BY_ID = /^\/process-definition\/(order:\d:d\d)\/xml$/
const DEFINITION_BY_ID = /^\/process-definition\/order:(\d):d\d$/
const ACTIVITY_STATS = /^\/process-definition\/order:(\d):d\d\/statistics$/
const HISTORY_STATS = /^\/history\/process-definition\/order:\d:d\d\/statistics$/

/**
 * A version's activity statistics: its token at the world's activity, v1's held by the root
 * incident, and v2's caller waiting at its call activity, where the copy lies; the incidents only
 * where asked (`incidents=true`, which counts the copy too).
 */
function activityStatistics(version: string, query: Record<string, string>): unknown[] {
  const v1 = version === "1"
  const failed = query.incidents === "true" ? [{ incidentType: "failedJob", incidentCount: 1 }] : []
  const charge = {
    id: WORLD.activityId,
    instances: 1,
    failedJobs: v1 ? 1 : 0,
    incidents: v1 ? failed : [],
  }
  if (v1) return [charge]
  return [charge, { id: WORLD.callActivityId, instances: 1, failedJobs: 0, incidents: failed }]
}

/** Every version of the key, newest first, where a read asks for them; else the latest. */
function definitionsFor(query: Record<string, string>): unknown[] {
  const every = query.key !== undefined && query.latestVersion === undefined && !query.deployedAfter
  return every ? [definition(2), definition(1)] : [definition(2)]
}

/** The world's answers that read the request's query. */
const QUERIED: Record<string, (query: Record<string, string>) => unknown> = {
  "/incident": incidentsFor,
  "/incident/count": (query) => ({ count: incidentsFor(query).length }),
  "/process-definition/statistics": definitionStatistics,
  "/process-definition": definitionsFor,
}

/** Unmapped lists answer `[]`, counts `{count: 1}`. */
export function worldReply(request: RecordedRequest): FakeReply {
  const { path, query } = request
  const queried = QUERIED[path]
  if (queried) return { body: queried(query) }
  if (path.endsWith("/count")) return { body: { count: 1 } }
  if (path in ROUTES) return { body: ROUTES[path] }
  const xml = XML_BY_ID.exec(path)
  if (xml) return { body: { id: xml[1], bpmn20Xml: WORLD_XML } }
  const stats = ACTIVITY_STATS.exec(path)
  if (stats) return { body: activityStatistics(stats[1] ?? "", query) }
  if (HISTORY_STATS.test(path)) {
    return { body: [{ id: WORLD.activityId, instances: 1, finished: 3, canceled: 1 }] }
  }
  const def = DEFINITION_BY_ID.exec(path)
  if (def) return { body: definition(Number(def[1]) as 1 | 2) }
  if (path === `/job/${WORLD.jobId}/stacktrace`) {
    return { contentType: "text/plain", body: "java.lang.IllegalStateException: card declined" }
  }
  return { body: [] }
}

/** Past 64 chars the engine stores a bare id that names no key; the definition's row names it. */
export const BARE_DEFINITION_ID = "6f1c2a9e-0b7d-4c33-9a51-3d2e8f40b7aa"
const BARE_KEY = "customerOnboardingApprovalProcess"
const BARE_DEFINITION = {
  id: BARE_DEFINITION_ID,
  key: BARE_KEY,
  name: "Customer onboarding",
  version: 1,
}
const BARE_ID_STATS: FakeReply = {
  body: [
    {
      id: BARE_DEFINITION_ID,
      instances: 1,
      incidents: [{ incidentType: "failedJob", incidentCount: 1 }],
      definition: BARE_DEFINITION,
    },
  ],
}
/** The bare version's diagram, which names its process and the world's activity. */
const BARE_XML = `<?xml version="1.0"?><definitions><process id="${BARE_KEY}" name="Customer onboarding"><serviceTask id="${WORLD.activityId}" name="Charge card"/></process></definitions>`

/**
 * Overrides of the world: `path` answers `body` on the bare id, with its statistics, its row of
 * `GET /process-definition?processDefinitionIdIn` and its diagram.
 */
export function onBareDefinitionId(
  path: string,
  body: unknown,
): (request: RecordedRequest) => FakeReply | undefined {
  return (r) =>
    r.path === path
      ? { body }
      : r.path === "/process-definition/statistics"
        ? BARE_ID_STATS
        : r.path === "/process-definition" &&
            r.query.processDefinitionIdIn?.split(",").includes(BARE_DEFINITION_ID)
          ? { body: [BARE_DEFINITION] }
          : r.path === `/process-definition/${BARE_DEFINITION_ID}/xml`
            ? { body: { id: BARE_DEFINITION_ID, bpmn20Xml: BARE_XML } }
            : undefined
}

/**
 * Parameter names only, since values vary (timestamps, page offsets): a query's, and a JSON body's
 * fields, so two counts that differ only in their POST filters are two reads.
 */
export function readOf(
  request: Pick<RecordedRequest, "method" | "path" | "query" | "body">,
): string {
  const { body } = request
  const params = Object.keys(request.query).sort()
  const fields =
    body !== null && typeof body === "object" && !Array.isArray(body)
      ? Object.keys(body).sort()
      : []
  const query = params.length > 0 ? `?${params.join("&")}` : ""
  const filters = fields.length > 0 ? ` {${fields.join(",")}}` : ""
  return `${request.method} ${request.path}${query}${filters}`
}

export const ENGINE_FAILURE: FakeReply = {
  status: 500,
  body: { type: "ProcessEngineException", message: "boom" },
}
