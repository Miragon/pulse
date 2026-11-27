/**
 * The overview's root incidents outside any process over its wire (owner decision of
 * 2026-11-26): the scan's root incidents no process holds (a batch's or the history cleanup's
 * failed job), which the definition statistics never count, judged by the verdict and named
 * apart in the summary, never summed into the processes' `totalIncidents`; a lower bound where the
 * scan stops (`CLUSTER_SCAN_LIMIT`); no read of its own.
 */

import { afterEach, describe, expect, it } from "vitest"
import {
  clientFor,
  startFakeEngine,
  type FakeEngine,
  type FakeRoutes,
} from "../tools/test-support/fake-engine.js"
import { CLUSTER_SCAN_LIMIT } from "./cluster-scan.js"
import { buildEngineHealthData } from "./health-data.js"

const engines: FakeEngine[] = []
afterEach(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
})

/** An open failed job, a root incident; outside any process without a definition. */
const incident = (id: string, processDefinitionId: string | null) => ({
  id,
  rootCauseIncidentId: id,
  processDefinitionId,
  processInstanceId: processDefinitionId === null ? null : `pi-${id}`,
  activityId: processDefinitionId === null ? null : "charge",
  incidentType: "failedJob",
  incidentMessage: processDefinitionId === null ? "history cleanup failed" : "card declined",
  incidentTimestamp: "2026-04-01T10:00:00.000+0000",
})

/** One process without an open root incident, as the statistics count it. */
const QUIET_STATISTICS = {
  body: [
    {
      id: "order:1:x",
      instances: 3,
      failedJobs: 0,
      incidents: [],
      definition: { id: "order:1:x", key: "order", version: 1, name: "Order" },
    },
  ],
}

async function healthOf(routes: FakeRoutes) {
  const engine = await startFakeEngine(
    { "GET /process-definition/statistics": QUIET_STATISTICS, ...routes },
    { body: [] },
  )
  engines.push(engine)
  return { engine, data: await buildEngineHealthData(clientFor(engine), "fake") }
}

describe("buildEngineHealthData: root incidents outside any process", () => {
  it("judges the history cleanup's failed job and names it apart: 0 in processes, 1 outside", async () => {
    const { engine, data } = await healthOf({ "GET /incident": { body: [incident("h1", null)] } })
    expect(data.status).toBe("warning")
    expect(data.summary).toMatchObject({
      totalIncidents: 0,
      outsideAnyProcess: { count: 1, atLeast: false },
      affectedDefinitions: 0,
    })
    // From the scan the overview reads anyway: no count of every open incident, no second read.
    expect(engine.requests.filter((request) => request.path === "/incident")).toHaveLength(1)
    expect(engine.requests.filter((request) => request.path === "/incident/count")).toEqual([])
  })

  it("counts them as a lower bound where the scan stops at its cap", async () => {
    const scan = Array.from({ length: CLUSTER_SCAN_LIMIT }, (_, n) =>
      incident(`i${n}`, n < 5 ? null : "order:1:x"),
    )
    const { data } = await healthOf({ "GET /incident": { body: scan } })
    expect(data.summary.outsideAnyProcess).toEqual({ count: 5, atLeast: true })
  })

  it("names none outside any process where the scan holds none", async () => {
    const { data } = await healthOf({
      "GET /incident": { body: [incident("o1", "order:1:x")] },
      "GET /process-definition/statistics": {
        body: [
          {
            ...QUIET_STATISTICS.body[0],
            incidents: [{ incidentType: "failedJob", incidentCount: 1 }],
          },
        ],
      },
    })
    expect(data.summary).toMatchObject({
      totalIncidents: 1,
      outsideAnyProcess: { count: 0, atLeast: false },
    })
  })
})
