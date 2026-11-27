import { afterEach, describe, expect, it } from "vitest"
import { cibsevenProvider } from "../providers/index.js"
import { WORLD } from "../tools/test-support/engine-world.js"
import { buildActivityStatisticsData } from "./activity-statistics-data.js"
import { buildCockpitDashboardData } from "./cockpit-data.js"
import { buildEngineHealthData } from "./health-data.js"
import { buildIncidentsDashboardData } from "./incidents-dashboard-data.js"
import { buildActivityIncidentsData } from "./activity-incidents-data.js"
import { buildProcessIncidentsData } from "./process-incidents-data.js"
import { build, type BuildCase, closeBuildEngines } from "./honest-numbers.test-support.js"
import type { RecordedRequest } from "../tools/test-support/fake-engine.js"

/**
 * The honest-numbers tables' world holds a call chain: its caller's call activity holds a copy of
 * the root incident of the instance it called. Every incident count of the cockpit is the root
 * incidents' (owner decision D2, amended on 2026-11-19, the chat since 2026-11-21): 1 here, where
 * counting the copy would give 2 (the world's statistics with `incidents=true` count it).
 */

afterEach(closeBuildEngines)

const urls = (baseUrl: string) => ({ baseUrl, provider: cibsevenProvider })

async function ok<T>(run: BuildCase["run"], world?: BuildCase["world"]): Promise<T> {
  const { outcome } = await build({ run, world })
  if (!outcome.ok) throw outcome.error
  return outcome.data as T
}

/** A root incident of the call activity's own (its asynchronous continuation failed). */
const OWN_ROOT = {
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
const COPY = {
  ...OWN_ROOT,
  id: WORLD.copyIncidentId,
  processInstanceId: WORLD.callerInstanceId,
  incidentMessage: null,
  incidentTimestamp: "2026-10-10T08:00:00.000+0200",
  configuration: null,
  rootCauseIncidentId: WORLD.incidentId,
}
const CALL_XML = `<?xml version="1.0"?><definitions><process id="${WORLD.key}"><serviceTask id="${WORLD.activityId}" name="Charge card"/><callActivity id="${WORLD.callActivityId}" name="Call order"/></process></definitions>`

/**
 * The world, its call activity holding a root incident of its own beside the copy, and drawn as a
 * call activity on the latest diagram: `/incident` lists both there, `/incident/count` counts both.
 */
function callActivityWorld(r: RecordedRequest) {
  if (r.path === `/process-definition/${WORLD.latestDefinitionId}/xml`) {
    return { body: { id: WORLD.latestDefinitionId, bpmn20Xml: CALL_XML } }
  }
  if (r.query.activityId !== WORLD.callActivityId) return undefined
  if (r.path === "/incident") return { body: [OWN_ROOT, COPY] }
  if (r.path === "/incident/count") return { body: { count: 2 } }
  return undefined
}

interface ActivityPage {
  totalCount: number
  incidents: Array<{ id: string; activityName: string | null }>
}

describe("the cockpit counts root incidents over a world with a copy at a call activity", () => {
  it("the overview, the health route and the incidents route", async () => {
    const overview = await ok<{ summary: { totalIncidents: number } }>((client) =>
      buildCockpitDashboardData(client, "fake"),
    )
    expect(overview.summary.totalIncidents).toBe(1)
    const health = await ok<{
      summary: { totalIncidents: number; affectedActivities: number; affectedDefinitions: number }
      clusters: Array<{ activityId: string; incidentCount: number }>
    }>((client) => buildEngineHealthData(client, "fake"))
    expect(health.summary).toMatchObject({
      totalIncidents: 1,
      affectedActivities: 1,
      affectedDefinitions: 1,
    })
    expect(health.clusters.map((c) => [c.activityId, c.incidentCount])).toEqual([
      [WORLD.activityId, 1],
    ])
    const incidents = await ok<{
      totalCount: number
      processes: Array<{ incidentCount: number; activities: Array<{ activityId: string }> }>
    }>((client, baseUrl) =>
      buildIncidentsDashboardData(client, { ...urls(baseUrl), processDefinitionKey: WORLD.key }),
    )
    expect(incidents.totalCount).toBe(1)
    expect(incidents.processes.map((p) => p.incidentCount)).toEqual([1])
    // The copy is no row of its own: the call activity's group would list it.
    expect(incidents.processes[0]?.activities.map((a) => a.activityId)).toEqual([WORLD.activityId])
  })

  it("the process route and its flow's Running, the copy apart as an incident in a called instance", async () => {
    const process = await ok<{
      incidentCount: number
      activities: Array<{ activityId: string; incidentCount: number }>
    }>((client, baseUrl) =>
      buildProcessIncidentsData(client, { ...urls(baseUrl), processDefinitionKey: WORLD.key }),
    )
    expect(process.incidentCount).toBe(1)
    expect(process.activities.map((a) => [a.activityId, a.incidentCount])).toEqual([
      [WORLD.activityId, 1],
    ])
    const running = await ok<{
      activities: Array<{
        activityId: string
        running: number
        incidents: number
        incidentsInCalledInstances: number
      }>
    }>((client) =>
      buildActivityStatisticsData(client, { processDefinitionKey: WORLD.key, source: "runtime" }),
    )
    expect(
      running.activities.map((a) => [
        a.activityId,
        a.running,
        a.incidents,
        a.incidentsInCalledInstances,
      ]),
    ).toEqual([
      // v1's token at the element is its root incident's, v2's runs; the caller's token waits.
      [WORLD.activityId, 1, 1, 0],
      [WORLD.callActivityId, 1, 0, 1],
    ])
  })

  it("an activity's incident page: a call activity's root incidents alone, row and total", async () => {
    const page = await ok<ActivityPage>(
      (client, baseUrl) =>
        buildActivityIncidentsData(client, {
          ...urls(baseUrl),
          processDefinitionKey: WORLD.key,
          activityId: WORLD.callActivityId,
        }),
      callActivityWorld,
    )
    // The engine's count says 2: the copy is no row of the call activity and no part of its total.
    expect(page.totalCount).toBe(1)
    expect(page.incidents.map((i) => [i.id, i.activityName])).toEqual([["inc-own", "Call order"]])

    const charge = await ok<ActivityPage>(
      (client, baseUrl) =>
        buildActivityIncidentsData(client, {
          ...urls(baseUrl),
          processDefinitionKey: WORLD.key,
          activityId: WORLD.activityId,
        }),
      callActivityWorld,
    )
    expect(charge.totalCount).toBe(1)
    expect(charge.incidents.map((i) => [i.id, i.activityName])).toEqual([
      [WORLD.incidentId, "Charge card"],
    ])
  })
})
