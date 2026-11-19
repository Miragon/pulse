/**
 * The honest-numbers table's cases of a call activity's copies (a called instance's incident,
 * copied without a message) and an instance's history: each read that names a copy's root cause,
 * an instance's caller or its start is enrichment, so its failure leaves the build intact.
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
  "buildActivityIncidentsData (copies of a called instance's incident)": {
    run: (client, baseUrl) =>
      buildActivityIncidentsData(client, {
        baseUrl,
        provider: cibsevenProvider,
        processDefinitionKey: WORLD.key,
        activityId: WORLD.activityId,
      }),
    world: copies,
    enrichment: {
      "GET /process-instance?maxResults&processInstanceIds": (data: {
        incidents: Array<{ businessKey: unknown }>
      }) => data.incidents[0]?.businessKey,
      [ROOT_READ]: rootCauseOfFirst,
      [XML]: (data: { incidents: Array<{ rootCause?: { activityName: unknown } | null }> }) =>
        data.incidents[0]?.rootCause?.activityName ?? null,
    },
  },
}
