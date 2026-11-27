import { describe, expect, it } from "vitest"
import { readStatus } from "./engine-status.js"
import { fakePort, turningTies } from "./testing/fake-port.js"
import { NOW, statistics } from "./testing/status.js"

/** The engine time `seconds` before 11:00 on the status's day. */
const secondsBefore = (seconds: number) =>
  new Date(Date.parse("2026-01-01T11:00:00.000Z") - seconds * 1000)
    .toISOString()
    .replace("Z", "+0000")

/**
 * 1,300 incidents newest first in runs of 7 raised at one instant, their ids scrambled, each at an
 * activity of its own, so each root incident is a group of its own; every tenth a copy.
 */
const tiedIncidents = () =>
  Array.from({ length: 1300 }, (_, index) => {
    const id = `i${String((index * 7919) % 1300).padStart(4, "0")}`
    return {
      id,
      rootCauseIncidentId: index % 10 === 0 ? "elsewhere" : id,
      incidentType: "failedJob",
      activityId: `a-${id}`,
      processDefinitionId: "order:1:x",
      configuration: `j-${id}`,
      incidentMessage: "boom",
      incidentTimestamp: secondsBefore(Math.floor(index / 7)),
    }
  })

describe("readStatus over incidents raised at one instant", () => {
  it("counts each incident once where the engine turns the tied ones on every request", async () => {
    const port = fakePort({
      getRestAPIVersion: () => ({ version: "2.1.0" }),
      getProcessDefinitionStatistics: () => [statistics("order", 1, [1300, 1170, 1170])],
      getIncidents: turningTies(tiedIncidents(), (row) => row.incidentTimestamp),
      getIncidentsCount: () => ({ count: 1300 }),
      getExternalTasks: () => [],
      getExternalTasksCount: () => ({ count: 0 }),
      getJobsCount: () => ({ count: 0 }),
      getJobs: () => [],
      getTasksCount: () => ({ count: 0 }),
      getBatchStatistics: () => [],
      getBatchStatisticsCount: () => ({ count: 0 }),
      getStacktrace: () => "org.x.ProcessEngineException: boom",
    })

    const data = await readStatus({ port, now: () => NOW }, { keys: [] })

    expect(data).toMatchObject({ propagated: 130, incidentsTotal: 1300 })
    expect(data.incidents.map((group) => group.count)).toStrictEqual(Array(10).fill(1))
    expect(data.truncated).toStrictEqual(["incident groups: 10 of 1170 shown"])
  })
})
