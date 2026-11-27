import { afterEach, describe, expect, it } from "vitest"
import { toEngineDate } from "@miragon/pulse-c7-core"
import { cibsevenProvider } from "../providers/index.js"
import {
  clientFor,
  startFakeEngine,
  type FakeEngine,
  type FakeRoutes,
} from "../tools/test-support/fake-engine.js"
import { buildEngineHealthData } from "./health-data.js"
import { buildIncidentsDashboardData } from "./incidents-dashboard-data.js"

// The engine-wide incident views over a multi-instance activity (#689 F136): Camunda 7 raises its
// body's own failure (a failed asynchronous body, say) at `<id>#multiInstanceBody`, an id the
// diagram does not draw. A cluster keeps the engine's id, which its detail reads and its fix finds
// the jobs by, so the body's failure is a cluster of its own; it is named by the activity it
// repeats, and the activity counts once among the affected ones.

const engines: FakeEngine[] = []
afterEach(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
})

const KEY = "leasing"
const V1 = "leasing:1:d"
const BODY = "assess#multiInstanceBody"
const XML = `<definitions><process id="${KEY}"><serviceTask id="assess" name="Assess creditworthiness"/></process></definitions>`

const row = (n: number, activityId: string) => ({
  id: `inc-${n}`,
  processDefinitionId: V1,
  processInstanceId: `pi-${n}`,
  activityId,
  incidentType: "failedJob",
  incidentMessage: `${activityId} failed`,
  incidentTimestamp: toEngineDate(new Date(Date.UTC(2026, 9, 10, 12, 0) - n * 60_000)),
  configuration: `job-${n}`,
})

/** An item's incident at the activity and its body's, the key's two root incidents. */
const routes: FakeRoutes = {
  "GET /incident": { body: [row(0, "assess"), row(1, BODY)] },
  "GET /process-definition/statistics": {
    body: [
      {
        id: V1,
        instances: 2,
        incidents: [{ incidentType: "failedJob", incidentCount: 2 }],
        definition: { id: V1, key: KEY, name: "Leasing", version: 1 },
      },
    ],
  },
  [`GET /process-definition/${V1}/xml`]: { body: { id: V1, bpmn20Xml: XML } },
  "GET /history/process-instance/count": { body: { count: 0 } },
}

async function engine() {
  const fake = await startFakeEngine(routes, { body: [] })
  engines.push(fake)
  return fake
}

describe("buildIncidentsDashboardData: a multi-instance body's root incidents", () => {
  it("are a row of their own, named by the activity, which counts once among the affected", async () => {
    const fake = await engine()
    const data = await buildIncidentsDashboardData(clientFor(fake), {
      baseUrl: fake.baseUrl,
      provider: cibsevenProvider,
    })

    const [card] = data.processes
    expect(
      card?.activities.map((a) => [a.activityId, a.activityName, a.scannedIncidentCount]),
    ).toEqual([
      ["assess", "Assess creditworthiness", 1],
      [BODY, "Assess creditworthiness", 1],
    ])
    expect(card?.affectedActivityCount).toBe(1)
    expect(data.affectedActivityCount).toBe(1)
  })
})

describe("buildEngineHealthData: a multi-instance body's root incidents", () => {
  it("are a cause of their own, named by the activity, which counts once among the affected", async () => {
    const fake = await engine()
    const data = await buildEngineHealthData(clientFor(fake), "eng1")

    expect(data.clusters.map((c) => [c.activityId, c.activityName, c.incidentCount])).toEqual([
      ["assess", "Assess creditworthiness", 1],
      [BODY, "Assess creditworthiness", 1],
    ])
    expect(data.summary.affectedActivities).toBe(1)
  })
})
