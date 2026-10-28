/** Every builder renders against this world, so a test can break exactly ONE read (`readOf`). */
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
} as const

export const WORLD_XML =
  '<?xml version="1.0"?><definitions><process id="order"><serviceTask id="charge" name="Charge card"/></process></definitions>'

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

const ROUTES: Record<string, unknown> = {
  "/process-definition": [definition(2)],
  "/process-definition/statistics": [1, 2].map((v) => ({
    id: definition(v as 1 | 2).id,
    instances: v,
    failedJobs: v === 1 ? 1 : 0,
    incidents: v === 1 ? [{ incidentType: "failedJob", incidentCount: 1 }] : [],
    definition: definition(v as 1 | 2),
  })),
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
  "/incident": [incident],
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
  "/history/process-instance": [{ id: WORLD.instanceId, processDefinitionKey: WORLD.key }],
  "/history/activity-instance": [{ id: "h-1", activityId: "start", activityType: "startEvent" }],
}

const XML_BY_ID = /^\/process-definition\/(order:\d:d\d)\/xml$/
const DEFINITION_BY_ID = /^\/process-definition\/order:(\d):d\d$/
const ACTIVITY_STATS = /^\/process-definition\/order:(\d):d\d\/statistics$/

/** Unmapped lists answer `[]`, counts `{count: 1}`. */
export function worldReply(request: RecordedRequest): FakeReply {
  const { path } = request
  if (path.endsWith("/count")) return { body: { count: 1 } }
  if (path in ROUTES) return { body: ROUTES[path] }
  const xml = XML_BY_ID.exec(path)
  if (xml) return { body: { id: xml[1], bpmn20Xml: WORLD_XML } }
  const stats = ACTIVITY_STATS.exec(path)
  if (stats) {
    const v1 = stats[1] === "1"
    return {
      body: [
        {
          id: WORLD.activityId,
          instances: 1,
          failedJobs: v1 ? 1 : 0,
          incidents: v1 ? [{ incidentType: "failedJob", incidentCount: 1 }] : [],
        },
      ],
    }
  }
  const def = DEFINITION_BY_ID.exec(path)
  if (def) return { body: definition(Number(def[1]) as 1 | 2) }
  if (path === `/job/${WORLD.jobId}/stacktrace`) {
    return { contentType: "text/plain", body: "java.lang.IllegalStateException: card declined" }
  }
  return { body: [] }
}

/** Query parameter names only, since values vary (timestamps, page offsets). */
export function readOf(request: Pick<RecordedRequest, "method" | "path" | "query">): string {
  const params = Object.keys(request.query).sort()
  return `${request.method} ${request.path}${params.length > 0 ? `?${params.join("&")}` : ""}`
}

export const ENGINE_FAILURE: FakeReply = {
  status: 500,
  body: { type: "ProcessEngineException", message: "boom" },
}
