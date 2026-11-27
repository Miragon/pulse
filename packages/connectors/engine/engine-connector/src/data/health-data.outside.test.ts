/**
 * The overview's root incidents outside any process over its wire (owner decision of
 * 2026-11-26): the scan's root incidents no process holds (a batch's or the history cleanup's
 * failed job), which the definition statistics never count, judged by the verdict and named
 * apart in the summary, never summed into the processes' `totalIncidents`, their last hour, their
 * affected activities or their causes; a lower bound where the scan stops (`CLUSTER_SCAN_LIMIT`);
 * no read of its own.
 */

import { rootIncidentCounts } from "@miragon/pulse-c7-core"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  clientFor,
  startFakeEngine,
  type FakeEngine,
  type FakeRoutes,
} from "../tools/test-support/fake-engine.js"
import { CLUSTER_SCAN_LIMIT, inAnyProcess } from "./cluster-scan.js"
import { buildEngineHealthData } from "./health-data.js"

const engines: FakeEngine[] = []
afterEach(async () => {
  vi.useRealTimers()
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
      affectedActivities: 0,
      affectedDefinitions: 0,
    })
    expect(data.clusters).toEqual([])
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

  it("counts the last hour, the activities and the causes over the processes' root incidents alone", async () => {
    // Half an hour after both incidents were raised: each is new in the last hour.
    vi.useFakeTimers({ toFake: ["Date"], now: Date.parse("2026-04-01T10:30:00.000Z") })
    const { data } = await healthOf({
      "GET /incident": { body: [incident("b1", null), incident("o1", "order:1:x")] },
      "GET /process-definition/statistics": {
        body: [
          {
            ...QUIET_STATISTICS.body[0],
            incidents: [{ incidentType: "failedJob", incidentCount: 1 }],
          },
        ],
      },
    })
    expect(data.status).toBe("warning")
    expect(data.summary).toMatchObject({
      totalIncidents: 1,
      outsideAnyProcess: { count: 1, atLeast: false },
      lastHourIncidents: 1,
      affectedActivities: 1,
      affectedDefinitions: 1,
    })
    expect(
      data.clusters.map(({ activityId, processDefinitionKeys, incidentCount }) => ({
        activityId,
        processDefinitionKeys,
        incidentCount,
      })),
    ).toEqual([{ activityId: "charge", processDefinitionKeys: ["order"], incidentCount: 1 }])
  })

  it("tells an incident outside any process as c7-core's verdict tells it", () => {
    const rows = [null, "", undefined, "order:1:x"].map((processDefinitionId, n) => ({
      ...incident(`r${String(n)}`, "order:1:x"),
      processDefinitionId,
    }))
    const outside = rootIncidentCounts(0, { items: rows, truncated: false }).outsideAnyProcess
    expect(rows.filter((row) => !inAnyProcess(row))).toHaveLength(outside.count)
    expect(outside.count).toBe(3)
  })
})
