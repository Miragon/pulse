import { describe, expect, it } from "vitest"
import { readStatus, statusRequests } from "./engine-status.js"
import { fakePort, type Route } from "./testing/fake-port.js"
import { NOW, statistics } from "./testing/status.js"

const OPTIONS = { keys: [], staleAfterMs: 300_000, maxGroups: 10 }
const failedJob = (id: string, activityId: string) => ({
  id,
  rootCauseIncidentId: id,
  incidentType: "failedJob",
  activityId,
  processDefinitionId: "order:1:x",
  processInstanceId: `pi-${id}`,
  configuration: `j-${id}`,
  incidentMessage: "Unknown property used in expression: ${missingBean}",
  incidentTimestamp: "2026-01-01T11:00:00.000+0000",
})

function engine(overrides: Readonly<Record<string, Route>> = {}) {
  return fakePort({
    getRestAPIVersion: () => ({ version: "2.1.0" }),
    getProcessDefinitionStatistics: () => [statistics("order", 1, [41, 3, 3])],
    getIncidents: () => [failedJob("1", "book"), failedJob("2", "book"), failedJob("3", "pay")],
    getIncidentsCount: () => ({ count: 3 }),
    getExternalTasks: () => [
      { id: "e1", topicName: "mail", createTime: "2026-01-01T11:00:00.000+0000" },
    ],
    getExternalTasksCount: () => ({ count: 1 }),
    getJobsCount: () => ({ count: 5 }),
    getJobs: () => [{ id: "j9", dueDate: "2026-01-01T11:40:00.000+0000" }],
    getTasksCount: () => ({ count: 7 }),
    getBatchStatistics: () => [],
    getStacktrace: () =>
      "org.x.ProcessEngineException: outer\nCaused by: org.x.PropertyNotFoundException: Cannot resolve identifier 'missingBean'",
    ...overrides,
  })
}

/** A clock that advances 4 ms per read. */
function clock() {
  let now = NOW
  return () => {
    const current = now
    now += 4
    return current
  }
}

describe("readStatus", () => {
  it("triages the engine: findings, groups with their root cause, topics, jobs and counts", async () => {
    const port = engine()
    const data = await readStatus({ port, now: clock() }, OPTIONS)
    expect(data.engine).toEqual({ version: "2.1.0", latencyMs: 4 })
    expect(data.status).toBe("critical")
    expect(data.findings.map((finding) => finding.code)).toEqual([
      "JOBS_OVERDUE",
      "INCIDENTS",
      "INCIDENTS",
      "NO_WORKER",
    ])
    expect(data.incidents[0]).toMatchObject({
      activityId: "book",
      count: 2,
      rootCause: "PropertyNotFoundException: Cannot resolve identifier 'missingBean'",
      next: { action: "retryActivity", processDefinitionKey: "order", activityId: "book" },
    })
    expect(data).toMatchObject({
      incidentsTotal: 3,
      propagated: 0,
      jobs: { executable: 5, overdue: 1, oldestReadySince: "2026-01-01T11:40:00.000+0000" },
      tasks: { open: 7 },
      batches: { running: 0, withFailures: 0 },
    })
    expect(data.truncated).toBeUndefined()
    const jobs = port.calls.find((call) => call.operationId === "getJobs")
    expect(jobs?.input.query).toEqual({
      executable: "true",
      active: "true",
      createTimes: "lt_2026-01-01T11:55:00.000+0000",
      maxResults: "1000",
      processDefinitionKey: undefined,
    })
  })

  it("reads per key, skips the batches and names every cut", async () => {
    const port = engine({
      getIncidents: (input) =>
        Array.from({ length: Number(input.query.maxResults) }, (_, index) =>
          failedJob(String(index), `a${index % 12}`),
        ),
      getExternalTasks: (input) =>
        Array.from({ length: Number(input.query.maxResults) }, (_, index) => ({
          id: `e${index}`,
          topicName: "mail",
        })),
      getJobs: () =>
        Array.from({ length: 1000 }, () => ({ dueDate: "2026-01-01T11:00:00.000+0000" })),
    })
    const data = await readStatus(
      { port, now: clock() },
      { keys: ["order", "nope"], staleAfterMs: 300_000, maxGroups: 3 },
    )
    expect(data.truncated).toEqual([
      "incidents: 2000 of 3 loaded",
      "externalTasks: 2000 of 1 loaded",
      "jobs: the first 1000 overdue candidates loaded",
      "incident groups: 3 of 12 shown",
    ])
    expect(data.batches).toBeUndefined()
    expect(data.incidents).toHaveLength(3)
    expect(data.findings.some((finding) => finding.code === "UNKNOWN_KEY")).toBe(true)
    const operations = port.calls.map((call) => call.operationId)
    expect(operations).not.toContain("getBatchStatistics")
    expect(operations.filter((id) => id === "getJobsCount")).toHaveLength(2)
    const incidents = port.calls.find((call) => call.operationId === "getIncidents")
    expect(incidents?.input.query.processDefinitionKeyIn).toBe("order,nope")
  })

  it("names the overdue-job cut when one key's page is full, whatever the other keys hold", async () => {
    const port = engine({
      getJobs: (input) =>
        input.query.processDefinitionKey === "order"
          ? Array.from({ length: 1000 }, () => ({ dueDate: "2026-01-01T11:00:00.000+0000" }))
          : [],
    })
    const data = await readStatus({ port, now: clock() }, { ...OPTIONS, keys: ["order", "pay"] })
    expect(data.jobs.overdue).toBe(1000)
    expect(data.truncated).toEqual(["jobs: the first 1000 overdue candidates loaded"])
  })

  it("counts batches with failed jobs and keeps their incidents out of the groups", async () => {
    const data = await readStatus(
      {
        port: engine({
          getBatchStatistics: () => [
            { id: "b1", type: "migration", failedJobs: 1, batchJobDefinitionId: "jd-b" },
            { id: "b2", type: "migration", failedJobs: 0 },
          ],
          getIncidents: () => [{ ...failedJob("1", "x"), jobDefinitionId: "jd-b" }],
          getRestAPIVersion: () => ({}),
        }),
        now: clock(),
      },
      OPTIONS,
    )
    expect(data.batches).toEqual({ running: 2, withFailures: 1 })
    expect(data.incidents).toEqual([])
    expect(data.engine.version).toBeNull()
  })
})

describe("statusRequests", () => {
  it("previews round one with the first page of the lists", () => {
    const requests = statusRequests({ ...OPTIONS, keys: ["order"] }, NOW)
    expect(requests.map((request) => request.operationId)).toEqual([
      "getRestAPIVersion",
      "getProcessDefinitionStatistics",
      "getIncidents",
      "getIncidentsCount",
      "getExternalTasks",
      "getExternalTasksCount",
      "getJobsCount",
      "getJobs",
      "getTasksCount",
    ])
    expect(statusRequests(OPTIONS, NOW).at(-1)?.operationId).toBe("getBatchStatistics")
  })

  it("waits 5 minutes and shows 10 incident groups unless told otherwise", async () => {
    expect(statusRequests({ keys: [] }, NOW)).toEqual(statusRequests(OPTIONS, NOW))
    const incidents = Array.from({ length: 11 }, (_, index) =>
      failedJob(String(index), `a${String(index).padStart(2, "0")}`),
    )
    const data = await readStatus(
      {
        port: engine({ getIncidents: () => incidents, getIncidentsCount: () => ({ count: 11 }) }),
        now: clock(),
      },
      { keys: [] },
    )
    expect(data.incidents).toHaveLength(10)
    expect(data.truncated).toEqual(["incident groups: 10 of 11 shown"])
    expect(data.findings[0]?.message).toContain("waited longer than 5m")
  })
})
