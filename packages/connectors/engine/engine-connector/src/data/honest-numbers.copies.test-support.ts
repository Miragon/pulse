/**
 * The honest-numbers table's cases of a call activity's copies (a called instance's incident,
 * copied without a message) and an instance's history: each read that names a copy's root cause,
 * an instance's caller or its start is enrichment, so its failure leaves the build intact; an
 * activity's page at a call activity reads its incidents whole, each page primary.
 */

import { buildActivityIncidentsData } from "./process-incidents-data.js"
import { buildInstanceDetailData } from "./instance-detail-data.js"
import { cibsevenProvider } from "../providers/index.js"
import { WORLD } from "../tools/test-support/engine-world.js"
import type { FakeReply, RecordedRequest } from "../tools/test-support/fake-engine.js"
import type { BuildCase } from "./honest-numbers.test-support.js"

interface EnrichedCase extends BuildCase {
  enrichment: Record<string, (data: never) => unknown>
}

/** An instance's history, its caller and its start: enrichment of the instance's view. */
export const HISTORY_ENRICHMENT = {
  [`GET /history/process-instance/${WORLD.instanceId}`]: (data: {
    callerInstanceId: unknown
    startTime: unknown
  }) => data.callerInstanceId ?? data.startTime,
}

/** A copy's root incident, read by its id. */
const ROOT_READ = `GET /incident/${WORLD.incidentId}`
const rootCauseOfFirst = (data: { incidents: Array<{ rootCause?: unknown }> }) =>
  data.incidents[0]?.rootCause ?? null
const XML = `GET /process-definition/${WORLD.instanceDefinitionId}/xml`

/** `/incident` lists the world's delegated incident, a copy whose root is the world's incident. */
function copies(r: RecordedRequest): FakeReply | undefined {
  if (r.path !== "/incident") return undefined
  return {
    body: [
      {
        id: WORLD.delegatedIncidentId,
        processDefinitionId: WORLD.instanceDefinitionId,
        processInstanceId: WORLD.instanceId,
        activityId: WORLD.activityId,
        incidentType: "failedJob",
        incidentMessage: null,
        incidentTimestamp: "2026-10-10T08:00:00.000+0200",
        configuration: null,
        rootCauseIncidentId: WORLD.incidentId,
      },
    ],
  }
}

const LATEST_XML = `GET /process-definition/${WORLD.latestDefinitionId}/xml`
const CALL_XML = `<?xml version="1.0"?><definitions><process id="${WORLD.key}"><callActivity id="${WORLD.callActivityId}" name="Call order"/></process></definitions>`

/**
 * The caller's call activity, drawn as one on the latest diagram, holding a root incident of its own
 * beside its copy of the called instance's: an activity page there reads its incidents whole.
 */
function atCallActivity(r: RecordedRequest): FakeReply | undefined {
  if (r.path === `/process-definition/${WORLD.latestDefinitionId}/xml`) {
    return { body: { id: WORLD.latestDefinitionId, bpmn20Xml: CALL_XML } }
  }
  if (r.path !== "/incident" || r.query.activityId !== WORLD.callActivityId) return undefined
  const own = {
    id: "inc-own",
    processDefinitionId: WORLD.latestDefinitionId,
    processInstanceId: "pi-3",
    activityId: WORLD.callActivityId,
    incidentType: "failedJob",
    incidentMessage: "async continuation failed",
    incidentTimestamp: "2026-10-10T09:00:00.000+0200",
    configuration: "job-3",
    rootCauseIncidentId: "inc-own",
  }
  return {
    body: [
      own,
      {
        ...own,
        id: WORLD.copyIncidentId,
        configuration: null,
        rootCauseIncidentId: WORLD.incidentId,
      },
    ],
  }
}

export const COPY_CASES: Record<string, EnrichedCase> = {
  "buildInstanceDetailData (a copy of a called instance's incident)": {
    run: (client) =>
      buildInstanceDetailData(client, "fake", { processInstanceId: WORLD.instanceId }),
    world: copies,
    enrichment: {
      [XML]: (data: { diagramDefinitionId: unknown }) => data.diagramDefinitionId,
      ...HISTORY_ENRICHMENT,
      [ROOT_READ]: rootCauseOfFirst,
    },
  },
  "buildActivityIncidentsData (at a call activity)": {
    run: (client, baseUrl) =>
      buildActivityIncidentsData(client, {
        baseUrl,
        provider: cibsevenProvider,
        processDefinitionKey: WORLD.key,
        activityId: WORLD.callActivityId,
      }),
    world: atCallActivity,
    enrichment: {
      "GET /process-instance?maxResults&processInstanceIds": (data: {
        incidents: Array<{ businessKey: unknown }>
      }) => data.incidents[0]?.businessKey,
      // Unread, the page cannot tell the call activity and reads it whole all the same.
      [LATEST_XML]: (data: { incidents: Array<{ activityName: unknown }> }) =>
        data.incidents[0]?.activityName,
    },
  },
}
