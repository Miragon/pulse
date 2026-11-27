/**
 * The status triage's root incidents outside any process (owner decision of 2026-11-26): a batch's
 * or the history cleanup's failed job, which no definition counts, judged with the rest and named
 * apart as `outsideAnyProcess`, a lower bound where the incidents loaded were cut; read for the
 * whole engine alone, as the batches.
 */

import { describe, expect, it } from "vitest"
import { readStatus } from "./engine-status.js"
import { fakePort, type Route } from "./testing/fake-port.js"
import { NOW, statistics } from "./testing/status.js"

/** An open failed job, a root incident at `activityId` of `processDefinitionId` (none: outside). */
function failedJob(id: string, activityId: string, processDefinitionId: string | null) {
  return {
    id,
    rootCauseIncidentId: id,
    incidentType: "failedJob",
    activityId,
    processDefinitionId,
    processInstanceId: processDefinitionId === null ? null : `pi-${id}`,
    configuration: `j-${id}`,
    incidentMessage: `failed ${activityId}`,
    incidentTimestamp: "2026-01-01T11:00:00.000+0000",
  }
}

/** The history cleanup's failed job: no element, instance or version. */
const CLEANUP = failedJob("h1", "historyCleanup", null)

function engine(routes: Readonly<Record<string, Route>>) {
  return fakePort({
    getRestAPIVersion: () => ({ version: "2.1.0" }),
    getProcessDefinitionStatistics: () => [statistics("order", 1, [41, 0, 0])],
    getIncidents: () => [CLEANUP],
    getIncidentsCount: () => ({ count: 1 }),
    getExternalTasks: () => [],
    getExternalTasksCount: () => ({ count: 0 }),
    getJobsCount: () => ({ count: 0 }),
    getJobs: () => [],
    getTasksCount: () => ({ count: 0 }),
    getBatchStatistics: () => [],
    getBatchStatisticsCount: () => ({ count: 0 }),
    getStacktrace: () => "org.x.ProcessEngineException: cleanup failed",
    ...routes,
  })
}

const read = (routes: Readonly<Record<string, Route>> = {}, keys: readonly string[] = []) =>
  readStatus({ port: engine(routes), now: () => NOW }, { keys })

describe("readStatus outside any process", () => {
  it("judges a root incident outside any process and names it apart from the definitions'", async () => {
    const data = await read()
    expect(data).toMatchObject({
      status: "warning",
      rootIncidentsTotal: 1,
      outsideAnyProcess: { count: 1, atLeast: false },
      incidentsTotal: 1,
    })
    // No definition counts it.
    expect(data.definitions.map((definition) => definition.incidents)).toEqual([0])
  })

  it("names none outside any process on a quiet engine, read whole", async () => {
    const data = await read({ getIncidents: () => [], getIncidentsCount: () => ({ count: 0 }) })
    expect(data).toMatchObject({
      status: "ok",
      rootIncidentsTotal: 0,
      outsideAnyProcess: { count: 0, atLeast: false },
    })
  })

  it("counts them as a lower bound where the incidents loaded were cut", async () => {
    // 2,001 open incidents, the newest of them outside any process: the newest 2,000 are loaded.
    const all = Array.from({ length: 2001 }, (_, n) =>
      n < 3 ? failedJob(`b${n}`, "batch", null) : failedJob(`o${n}`, "book", "order:1:x"),
    )
    const data = await read({
      getProcessDefinitionStatistics: () => [statistics("order", 1, [41, 1998, 1998])],
      getIncidents: (input) => {
        const first = Number(input.query.firstResult ?? 0)
        return all.slice(first, first + Number(input.query.maxResults ?? all.length))
      },
      getIncidentsCount: () => ({ count: all.length }),
    })
    expect(data.truncated).toContain("incidents: 2000 of 2001 loaded")
    expect(data).toMatchObject({
      rootIncidentsTotal: 2001,
      outsideAnyProcess: { count: 3, atLeast: true },
    })
  })

  it("reads none for a scope of keys, which holds no incident outside any process", async () => {
    const data = await read(
      {
        getProcessDefinitionStatistics: () => [statistics("order", 1, [41, 1, 1])],
        getIncidents: () => [failedJob("o1", "book", "order:1:x")],
      },
      ["order"],
    )
    expect(data.outsideAnyProcess).toBeUndefined()
    expect(data.rootIncidentsTotal).toBe(1)
  })
})
